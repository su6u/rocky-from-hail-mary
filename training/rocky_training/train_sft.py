from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from rocky_training.model_spec import ModelSpec, load_model_spec
from rocky_training.trainer_jsonl import TrainerExportRow, load_trainer_jsonl, write_json


class TrainSftError(Exception):
    pass


@dataclass(frozen=True)
class SftTrainingResult:
    base_model: str
    adapter_dir: str
    train_loss: float | None
    eval_loss: float | None
    best_metric: float | None
    global_step: int


def default_validation_dataset_path(dataset_path: Path) -> Path:
    if dataset_path.name.endswith(".train.jsonl"):
        return dataset_path.with_name(dataset_path.name.replace(".train.jsonl", ".holdout.jsonl"))
    return dataset_path.with_suffix(".holdout.jsonl")


def resolve_train_base_model(spec: ModelSpec, override: str | None = None) -> str:
    base_model = override or spec.base_model
    if base_model.startswith("PLACEHOLDER_"):
        raise TrainSftError(
            "base_model is still a placeholder; pass --base-model with the verified Gemma train model id"
        )
    return base_model


def gemma_messages_for_training(row: TrainerExportRow) -> list[dict[str, str]]:
    system_parts = [message.content for message in row.messages if message.role == "system"]
    non_system = [
        {"role": message.role, "content": message.content}
        for message in row.messages
        if message.role != "system"
    ]

    if not non_system:
        raise TrainSftError(f"{row.id}: row has no non-system messages")

    first_user_index = next(
        (index for index, message in enumerate(non_system) if message["role"] == "user"),
        None,
    )
    if first_user_index is None:
        raise TrainSftError(f"{row.id}: row has no user message")

    if system_parts:
        first_user = non_system[first_user_index]
        system_content = "\n\n".join(system_parts)
        first_user["content"] = f"{system_content}\n\n{first_user['content']}"

    if non_system[-1]["role"] != "assistant":
        raise TrainSftError(f"{row.id}: final training message must be assistant")

    return non_system


def build_conversation_dataset_rows(rows: list[TrainerExportRow]) -> list[dict[str, Any]]:
    return [{"id": row.id, "messages": gemma_messages_for_training(row)} for row in rows]


def validate_chat_template(tokenizer: Any, rows: list[TrainerExportRow]) -> str:
    if not hasattr(tokenizer, "apply_chat_template"):
        raise TrainSftError("tokenizer does not support apply_chat_template")
    if not rows:
        raise TrainSftError("dataset contains no rows")

    messages = gemma_messages_for_training(rows[0])
    try:
        rendered = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
    except Exception as error:  # pragma: no cover - depends on model tokenizer
        raise TrainSftError("Gemma chat template failed for exported training messages") from error

    if not isinstance(rendered, str) or len(rendered) == 0:
        raise TrainSftError("Gemma chat template rendered an empty prompt")
    return rendered


def _require_train_dependencies() -> None:
    missing: list[str] = []
    for module in ("datasets", "peft", "torch", "transformers", "trl"):
        try:
            __import__(module)
        except ModuleNotFoundError:
            missing.append(module)
    if missing:
        raise TrainSftError(
            "missing training dependencies: "
            + ", ".join(missing)
            + ". Install with: pip install -e 'training/.[train]'"
        )


def _metric_from_history(history: list[dict[str, Any]], key: str) -> float | None:
    values = [entry[key] for entry in history if isinstance(entry.get(key), (int, float))]
    return float(values[-1]) if values else None


def run_sft_training(
    *,
    spec: ModelSpec,
    base_model: str,
    train_rows: list[TrainerExportRow],
    validation_rows: list[TrainerExportRow],
    output_dir: Path,
    per_device_train_batch_size: int,
    per_device_eval_batch_size: int,
    gradient_accumulation_steps: int | None = None,
    report_to: list[str] | None = None,
) -> SftTrainingResult:
    _require_train_dependencies()

    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig, EarlyStoppingCallback
    from trl import SFTConfig, SFTTrainer

    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    validate_chat_template(tokenizer, train_rows)

    compute_dtype = torch.bfloat16 if spec.train_precision == "bf16" else torch.float16
    quantization_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type=spec.quantization.train,
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        quantization_config=quantization_config,
        torch_dtype=compute_dtype,
        device_map="auto",
    )

    lora_config = LoraConfig(
        r=spec.adapter.rank,
        lora_alpha=spec.adapter.alpha,
        target_modules=list(spec.adapter.target_modules),
        lora_dropout=spec.adapter.dropout,
        bias="none",
        task_type="CAUSAL_LM",
    )

    train_dataset = Dataset.from_list(build_conversation_dataset_rows(train_rows))
    eval_dataset = Dataset.from_list(build_conversation_dataset_rows(validation_rows))
    output_dir.mkdir(parents=True, exist_ok=True)
    adapter_dir = output_dir / "adapter"

    resolved_gradient_accumulation_steps = gradient_accumulation_steps or max(
        1,
        math.ceil(spec.optimizer.effective_batch_size / per_device_train_batch_size),
    )

    training_args = SFTConfig(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=spec.optimizer.max_epochs,
        max_length=spec.sequence.max_length,
        per_device_train_batch_size=per_device_train_batch_size,
        per_device_eval_batch_size=per_device_eval_batch_size,
        gradient_accumulation_steps=resolved_gradient_accumulation_steps,
        learning_rate=spec.optimizer.learning_rate,
        lr_scheduler_type=spec.optimizer.scheduler,
        warmup_ratio=spec.optimizer.warmup_ratio,
        weight_decay=spec.optimizer.weight_decay,
        bf16=spec.train_precision == "bf16",
        fp16=spec.train_precision == "fp16",
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=spec.optimizer.early_stopping,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        assistant_only_loss=True,
        packing=False,
        report_to=report_to or [],
        remove_unused_columns=False,
    )

    callbacks = [EarlyStoppingCallback(early_stopping_patience=1)] if spec.optimizer.early_stopping else []
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        peft_config=lora_config,
        processing_class=tokenizer,
        callbacks=callbacks,
    )

    train_output = trainer.train()
    trainer.save_model(str(adapter_dir))
    tokenizer.save_pretrained(adapter_dir)

    history = trainer.state.log_history
    train_loss = _metric_from_history(history, "loss")
    eval_loss = _metric_from_history(history, "eval_loss")
    best_metric = (
        float(trainer.state.best_metric)
        if isinstance(trainer.state.best_metric, (int, float))
        else None
    )
    if train_loss is None and isinstance(train_output.metrics.get("train_loss"), (int, float)):
        train_loss = float(train_output.metrics["train_loss"])

    return SftTrainingResult(
        base_model=base_model,
        adapter_dir=str(adapter_dir),
        train_loss=train_loss,
        eval_loss=eval_loss,
        best_metric=best_metric,
        global_step=int(trainer.state.global_step),
    )


def build_train_sft_manifest(
    *,
    spec: ModelSpec,
    dataset_path: Path,
    validation_dataset_path: Path,
    output_dir: Path,
    base_model: str,
    train_rows: list[TrainerExportRow],
    validation_rows: list[TrainerExportRow],
    rendered_chat_template_sample: str,
    training: SftTrainingResult | None,
    dry_run: bool,
) -> dict[str, Any]:
    return {
        "kind": "train-sft",
        "dryRun": dry_run,
        "specId": spec.id,
        "baseModel": base_model,
        "chatTemplate": spec.chat_template,
        "assistantOnlyLoss": True,
        "qlora": {
            "trainQuantization": spec.quantization.train,
            "rank": spec.adapter.rank,
            "alpha": spec.adapter.alpha,
            "dropout": spec.adapter.dropout,
            "targetModules": list(spec.adapter.target_modules),
        },
        "optimizer": {
            "learningRate": spec.optimizer.learning_rate,
            "scheduler": spec.optimizer.scheduler,
            "warmupRatio": spec.optimizer.warmup_ratio,
            "weightDecay": spec.optimizer.weight_decay,
            "effectiveBatchSize": spec.optimizer.effective_batch_size,
            "maxEpochs": spec.optimizer.max_epochs,
            "earlyStopping": spec.optimizer.early_stopping,
        },
        "datasetPath": str(dataset_path),
        "validationDatasetPath": str(validation_dataset_path),
        "trainRowCount": len(train_rows),
        "validationRowCount": len(validation_rows),
        "outputDir": str(output_dir),
        "renderedChatTemplateSample": rendered_chat_template_sample,
        "adapterDir": training.adapter_dir if training else str(output_dir / "adapter"),
        "trainLoss": training.train_loss if training else None,
        "evalLoss": training.eval_loss if training else None,
        "bestMetric": training.best_metric if training else None,
        "globalStep": training.global_step if training else 0,
        "finishedAt": datetime.now(UTC).replace(microsecond=0).isoformat(),
    }


def run_train_sft(
    *,
    spec_path: Path,
    dataset_path: Path,
    output_dir: Path,
    validation_dataset_path: Path | None = None,
    base_model: str | None = None,
    max_rows: int = 0,
    max_validation_rows: int = 0,
    per_device_train_batch_size: int = 1,
    per_device_eval_batch_size: int = 1,
    gradient_accumulation_steps: int | None = None,
    report_to: list[str] | None = None,
    dry_run: bool = False,
    train_runner: Callable[..., SftTrainingResult] | None = None,
    tokenizer_loader: Callable[[str], Any] | None = None,
) -> dict[str, Any]:
    spec = load_model_spec(spec_path)
    resolved_base_model = resolve_train_base_model(spec, base_model)
    resolved_validation_path = validation_dataset_path or default_validation_dataset_path(dataset_path)

    if not resolved_validation_path.is_file():
        raise TrainSftError(f"validation dataset not found: {resolved_validation_path}")

    train_rows = load_trainer_jsonl(dataset_path, max_rows=max_rows)
    validation_rows = load_trainer_jsonl(resolved_validation_path, max_rows=max_validation_rows)

    if tokenizer_loader:
        tokenizer = tokenizer_loader(resolved_base_model)
        rendered_sample = validate_chat_template(tokenizer, train_rows)
    else:
        rendered_sample = "dry-run skipped tokenizer load" if dry_run else ""

    training: SftTrainingResult | None = None
    if not dry_run:
        runner = train_runner or run_sft_training
        training = runner(
            spec=spec,
            base_model=resolved_base_model,
            train_rows=train_rows,
            validation_rows=validation_rows,
            output_dir=output_dir,
            per_device_train_batch_size=per_device_train_batch_size,
            per_device_eval_batch_size=per_device_eval_batch_size,
            gradient_accumulation_steps=gradient_accumulation_steps,
            report_to=report_to,
        )
        if not rendered_sample and tokenizer_loader is None:
            rendered_sample = "see trainer tokenizer chat template"

    manifest = build_train_sft_manifest(
        spec=spec,
        dataset_path=dataset_path,
        validation_dataset_path=resolved_validation_path,
        output_dir=output_dir,
        base_model=resolved_base_model,
        train_rows=train_rows,
        validation_rows=validation_rows,
        rendered_chat_template_sample=rendered_sample,
        training=training,
        dry_run=dry_run,
    )
    write_json(output_dir / "manifest.json", manifest)
    return manifest
