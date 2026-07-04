from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from rocky_training.model_spec import ModelSpec, load_model_spec
from rocky_training.train_sft import (
    TrainSftError,
    resolve_lora_exclude_modules,
    resolve_lora_target_modules,
    resolve_train_base_model,
)
from rocky_training.trainer_jsonl import write_json


class TrainDpoError(Exception):
    pass


@dataclass(frozen=True)
class PreferenceRow:
    id: str
    prompt: str
    chosen: str
    rejected: str


@dataclass(frozen=True)
class DpoTrainingResult:
    adapter_dir: str
    train_loss: float | None
    global_step: int


def load_preference_jsonl(path: str | Path, *, max_rows: int = 0) -> list[PreferenceRow]:
    rows: list[PreferenceRow] = []
    file_path = Path(path)
    for line_number, line in enumerate(file_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as error:
            raise TrainDpoError(f"line {line_number}: invalid json") from error
        if not isinstance(parsed, dict):
            raise TrainDpoError(f"line {line_number}: row must be an object")
        row_id = parsed.get("id")
        prompt = parsed.get("prompt")
        chosen = parsed.get("chosen")
        rejected = parsed.get("rejected")
        if not isinstance(row_id, str) or not row_id:
            raise TrainDpoError(f"line {line_number}: id must be a non-empty string")
        for field_name, value in (("prompt", prompt), ("chosen", chosen), ("rejected", rejected)):
            if not isinstance(value, str) or not value:
                raise TrainDpoError(f"line {line_number}: {field_name} must be a non-empty string")
        if chosen == rejected:
            raise TrainDpoError(f"line {line_number}: chosen and rejected must differ")
        rows.append(PreferenceRow(id=row_id, prompt=prompt, chosen=chosen, rejected=rejected))
        if max_rows > 0 and len(rows) >= max_rows:
            break
    if not rows:
        raise TrainDpoError("preference dataset contains no rows")
    return rows


def build_preference_dataset_rows(rows: list[PreferenceRow]) -> list[dict[str, str]]:
    return [
        {"id": row.id, "prompt": row.prompt, "chosen": row.chosen, "rejected": row.rejected}
        for row in rows
    ]


def _require_dpo_dependencies() -> None:
    missing: list[str] = []
    for module in ("datasets", "peft", "torch", "transformers", "trl"):
        try:
            __import__(module)
        except ModuleNotFoundError:
            missing.append(module)
    if missing:
        raise TrainDpoError(
            "missing DPO dependencies: "
            + ", ".join(missing)
            + ". Install with: pip install -e 'training/.[train]'"
        )


def _metric_from_history(history: list[dict[str, Any]], key: str) -> float | None:
    values = [entry[key] for entry in history if isinstance(entry.get(key), (int, float))]
    return float(values[-1]) if values else None


def run_dpo_training(
    *,
    spec: ModelSpec,
    base_model: str,
    rows: list[PreferenceRow],
    output_dir: Path,
    beta: float,
    learning_rate: float,
) -> DpoTrainingResult:
    _require_dpo_dependencies()

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForMultimodalLM, AutoProcessor, BitsAndBytesConfig
    from trl import DPOConfig, DPOTrainer

    processor = AutoProcessor.from_pretrained(base_model)
    tokenizer = getattr(processor, "tokenizer", None)
    if tokenizer is None:
        raise TrainDpoError("Gemma 4 processor did not expose a tokenizer")
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    compute_dtype = torch.bfloat16 if spec.train_precision == "bf16" else torch.float16
    quantization_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type=spec.quantization.train,
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForMultimodalLM.from_pretrained(
        base_model,
        quantization_config=quantization_config,
        dtype=compute_dtype,
        device_map="auto",
    )
    peft_config = LoraConfig(
        r=spec.adapter.rank,
        lora_alpha=spec.adapter.alpha,
        target_modules=resolve_lora_target_modules(base_model, spec),
        lora_dropout=spec.adapter.dropout,
        bias="none",
        task_type="CAUSAL_LM",
        exclude_modules=resolve_lora_exclude_modules(base_model),
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    adapter_dir = output_dir / "adapter"
    training_args = DPOConfig(
        output_dir=str(output_dir / "checkpoints"),
        beta=beta,
        learning_rate=learning_rate,
        per_device_train_batch_size=1,
        gradient_accumulation_steps=max(1, spec.optimizer.effective_batch_size),
        num_train_epochs=1,
        bf16=spec.train_precision == "bf16",
        fp16=spec.train_precision == "fp16",
        logging_steps=10,
        save_strategy="epoch",
        report_to=[],
    )
    trainer = DPOTrainer(
        model=model,
        args=training_args,
        train_dataset=Dataset.from_list(build_preference_dataset_rows(rows)),
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    output = trainer.train()
    trainer.save_model(str(adapter_dir))
    tokenizer.save_pretrained(adapter_dir)
    train_loss = _metric_from_history(trainer.state.log_history, "loss")
    if train_loss is None and isinstance(output.metrics.get("train_loss"), (int, float)):
        train_loss = float(output.metrics["train_loss"])
    return DpoTrainingResult(
        adapter_dir=str(adapter_dir),
        train_loss=train_loss,
        global_step=int(trainer.state.global_step),
    )


def run_train_dpo(
    *,
    spec_path: Path,
    dataset_path: Path,
    output_dir: Path,
    base_model: str | None = None,
    max_rows: int = 0,
    beta: float = 0.1,
    learning_rate: float = 1e-5,
    dry_run: bool = False,
) -> dict[str, Any]:
    spec = load_model_spec(spec_path)
    try:
        resolved_base_model = resolve_train_base_model(spec, base_model)
    except TrainSftError as error:
        raise TrainDpoError(str(error)) from error
    rows = load_preference_jsonl(dataset_path, max_rows=max_rows)

    training: DpoTrainingResult | None = None
    if not dry_run:
        training = run_dpo_training(
            spec=spec,
            base_model=resolved_base_model,
            rows=rows,
            output_dir=output_dir,
            beta=beta,
            learning_rate=learning_rate,
        )

    manifest = {
        "kind": "train-dpo",
        "dryRun": dry_run,
        "specId": spec.id,
        "baseModel": resolved_base_model,
        "datasetPath": str(dataset_path),
        "preferenceRowCount": len(rows),
        "beta": beta,
        "learningRate": learning_rate,
        "adapterDir": training.adapter_dir if training else str(output_dir / "adapter"),
        "trainLoss": training.train_loss if training else None,
        "globalStep": training.global_step if training else 0,
        "finishedAt": datetime.now(UTC).replace(microsecond=0).isoformat(),
    }
    write_json(output_dir / "manifest.json", manifest)
    return manifest
