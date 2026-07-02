from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

MODEL_SPEC_EXPORT_QUANT_WARNING = (
    "final export target is q4_k_m gguf for serving — do not use q4_k_m gguf as qlora train base"
)
MODEL_SPEC_BASE_MODEL_WARNING = (
    "verify exact upstream gemma e4b trainable model id before full training"
)

ADAPTER_METHODS = ("qlora",)
TRAIN_PRECISIONS = ("bf16", "fp16")
TRAIN_QUANTS = ("nf4",)
EXPORT_QUANTS = ("q4_k_m",)
CHAT_TEMPLATES = ("gemma",)
SCHEDULERS = ("cosine", "linear")
TARGET_MODULES = (
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
)


@dataclass(frozen=True)
class ValidationIssue:
    line: int
    path: str
    message: str


@dataclass(frozen=True)
class ModelSpecQuantization:
    train: str
    export: str


@dataclass(frozen=True)
class ModelSpecSequence:
    max_length: int


@dataclass(frozen=True)
class ModelSpecAdapter:
    method: str
    rank: int
    alpha: int
    dropout: float
    target_modules: tuple[str, ...]


@dataclass(frozen=True)
class ModelSpecOptimizer:
    learning_rate: float
    scheduler: str
    warmup_ratio: float
    weight_decay: float
    effective_batch_size: int
    max_epochs: int
    early_stopping: bool


@dataclass(frozen=True)
class ModelSpecInference:
    temperature: float
    top_p: float
    num_ctx: int
    stop: tuple[str, ...]


@dataclass(frozen=True)
class ModelSpecArtifacts:
    adapter_dir: str
    merged_dir: str
    gguf_path: str
    modelfile_path: str


@dataclass(frozen=True)
class ModelSpecEvalGates:
    metadata_valid_rate: float
    metadata_single_tag_rate: float
    book_fact_contradiction_rate: float
    prompt_injection_fail_rate: float


@dataclass(frozen=True)
class ModelSpec:
    id: str
    base_model: str
    base_model_fallback: str
    chat_template: str
    train_precision: str
    quantization: ModelSpecQuantization
    sequence: ModelSpecSequence
    adapter: ModelSpecAdapter
    optimizer: ModelSpecOptimizer
    inference: ModelSpecInference
    artifacts: ModelSpecArtifacts
    eval_gates: ModelSpecEvalGates


@dataclass(frozen=True)
class ModelSpecValidationResult:
    file_path: str
    spec: ModelSpec | None
    issues: tuple[ValidationIssue, ...]
    warnings: tuple[str, ...]
    ok: bool


class ModelSpecError(Exception):
    def __init__(self, file_path: str, message: str) -> None:
        super().__init__(message)
        self.file_path = file_path


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and len(value) > 0


def _in_list(value: str, allowed: tuple[str, ...]) -> bool:
    return value in allowed


def collect_model_spec_warnings(spec: ModelSpec) -> list[str]:
    warnings = [MODEL_SPEC_EXPORT_QUANT_WARNING, MODEL_SPEC_BASE_MODEL_WARNING]
    if spec.base_model.startswith("PLACEHOLDER_"):
        warnings.append(f"base_model is placeholder: {spec.base_model}")
    if spec.base_model_fallback.startswith("PLACEHOLDER_"):
        warnings.append(f"base_model_fallback is placeholder: {spec.base_model_fallback}")
    if spec.quantization.export != "q4_k_m":
        warnings.append("export quantization should be q4_k_m for rocky serving target")
    return warnings


def validate_model_spec(raw: Any, line: int = 0) -> ModelSpecValidationResult:
    issues: list[ValidationIssue] = []

    if not isinstance(raw, dict):
        return ModelSpecValidationResult(
            file_path="",
            spec=None,
            issues=(ValidationIssue(line, "$", "model spec must be an object"),),
            warnings=(),
            ok=False,
        )

    if not _is_non_empty_string(raw.get("id")):
        issues.append(ValidationIssue(line, "id", "id must be a non-empty string"))
    if not _is_non_empty_string(raw.get("base_model")):
        issues.append(ValidationIssue(line, "base_model", "base_model must be a non-empty string"))
    if not _is_non_empty_string(raw.get("base_model_fallback")):
        issues.append(
            ValidationIssue(
                line,
                "base_model_fallback",
                "base_model_fallback must be a non-empty string",
            )
        )

    chat_template = raw.get("chat_template")
    if not _is_non_empty_string(chat_template) or not _in_list(chat_template, CHAT_TEMPLATES):
        issues.append(ValidationIssue(line, "chat_template", "chat_template must be gemma"))

    train_precision = raw.get("train_precision")
    if not _is_non_empty_string(train_precision) or not _in_list(train_precision, TRAIN_PRECISIONS):
        issues.append(
            ValidationIssue(line, "train_precision", "train_precision must be bf16 or fp16")
        )

    quantization: ModelSpecQuantization | None = None
    quant_raw = raw.get("quantization")
    if not isinstance(quant_raw, dict):
        issues.append(ValidationIssue(line, "quantization", "quantization must be an object"))
    else:
        train_quant = quant_raw.get("train")
        export_quant = quant_raw.get("export")
        if not _is_non_empty_string(train_quant) or not _in_list(train_quant, TRAIN_QUANTS):
            issues.append(
                ValidationIssue(line, "quantization.train", "quantization.train must be nf4")
            )
        if not _is_non_empty_string(export_quant) or not _in_list(export_quant, EXPORT_QUANTS):
            issues.append(
                ValidationIssue(
                    line,
                    "quantization.export",
                    "quantization.export must be q4_k_m",
                )
            )
        if (
            _is_non_empty_string(train_quant)
            and _is_non_empty_string(export_quant)
            and _in_list(train_quant, TRAIN_QUANTS)
            and _in_list(export_quant, EXPORT_QUANTS)
        ):
            quantization = ModelSpecQuantization(train=train_quant, export=export_quant)

    sequence: ModelSpecSequence | None = None
    sequence_raw = raw.get("sequence")
    if not isinstance(sequence_raw, dict):
        issues.append(ValidationIssue(line, "sequence", "sequence must be an object"))
    elif not isinstance(sequence_raw.get("max_length"), (int, float)) or sequence_raw["max_length"] <= 0:
        issues.append(
            ValidationIssue(
                line,
                "sequence.max_length",
                "sequence.max_length must be a positive number",
            )
        )
    else:
        sequence = ModelSpecSequence(max_length=int(sequence_raw["max_length"]))

    adapter: ModelSpecAdapter | None = None
    adapter_raw = raw.get("adapter")
    if not isinstance(adapter_raw, dict):
        issues.append(ValidationIssue(line, "adapter", "adapter must be an object"))
    else:
        method = adapter_raw.get("method")
        rank = adapter_raw.get("rank")
        alpha = adapter_raw.get("alpha")
        dropout = adapter_raw.get("dropout")
        target_modules = adapter_raw.get("target_modules")

        if not _is_non_empty_string(method) or not _in_list(method, ADAPTER_METHODS):
            issues.append(ValidationIssue(line, "adapter.method", "adapter.method must be qlora"))
        if not isinstance(rank, (int, float)) or rank <= 0:
            issues.append(ValidationIssue(line, "adapter.rank", "adapter.rank must be positive"))
        if not isinstance(alpha, (int, float)) or alpha <= 0:
            issues.append(ValidationIssue(line, "adapter.alpha", "adapter.alpha must be positive"))
        if not isinstance(dropout, (int, float)) or dropout < 0 or dropout > 1:
            issues.append(
                ValidationIssue(
                    line,
                    "adapter.dropout",
                    "adapter.dropout must be between 0 and 1",
                )
            )
        if not isinstance(target_modules, list) or len(target_modules) == 0:
            issues.append(
                ValidationIssue(
                    line,
                    "adapter.target_modules",
                    "adapter.target_modules must be a non-empty array",
                )
            )
        else:
            for index, module in enumerate(target_modules):
                if not _is_non_empty_string(module) or not _in_list(module, TARGET_MODULES):
                    issues.append(
                        ValidationIssue(
                            line,
                            f"adapter.target_modules[{index}]",
                            f"target module must be one of: {', '.join(TARGET_MODULES)}",
                        )
                    )

        if (
            _is_non_empty_string(method)
            and _in_list(method, ADAPTER_METHODS)
            and isinstance(rank, (int, float))
            and isinstance(alpha, (int, float))
            and isinstance(dropout, (int, float))
            and isinstance(target_modules, list)
            and all(_is_non_empty_string(module) and _in_list(module, TARGET_MODULES) for module in target_modules)
        ):
            adapter = ModelSpecAdapter(
                method=method,
                rank=int(rank),
                alpha=int(alpha),
                dropout=float(dropout),
                target_modules=tuple(str(module) for module in target_modules),
            )

    optimizer: ModelSpecOptimizer | None = None
    optimizer_raw = raw.get("optimizer")
    if not isinstance(optimizer_raw, dict):
        issues.append(ValidationIssue(line, "optimizer", "optimizer must be an object"))
    else:
        learning_rate = optimizer_raw.get("learning_rate")
        scheduler = optimizer_raw.get("scheduler")
        warmup_ratio = optimizer_raw.get("warmup_ratio")
        weight_decay = optimizer_raw.get("weight_decay")
        effective_batch_size = optimizer_raw.get("effective_batch_size")
        max_epochs = optimizer_raw.get("max_epochs")
        early_stopping = optimizer_raw.get("early_stopping")

        if not isinstance(learning_rate, (int, float)) or learning_rate <= 0:
            issues.append(
                ValidationIssue(line, "optimizer.learning_rate", "learning_rate must be positive")
            )
        if not _is_non_empty_string(scheduler) or not _in_list(scheduler, SCHEDULERS):
            issues.append(
                ValidationIssue(line, "optimizer.scheduler", "scheduler must be cosine or linear")
            )
        if not isinstance(warmup_ratio, (int, float)) or warmup_ratio < 0 or warmup_ratio > 1:
            issues.append(
                ValidationIssue(line, "optimizer.warmup_ratio", "warmup_ratio must be 0-1")
            )
        if not isinstance(weight_decay, (int, float)) or weight_decay < 0:
            issues.append(
                ValidationIssue(line, "optimizer.weight_decay", "weight_decay must be >= 0")
            )
        if not isinstance(effective_batch_size, (int, float)) or effective_batch_size <= 0:
            issues.append(
                ValidationIssue(
                    line,
                    "optimizer.effective_batch_size",
                    "effective_batch_size must be positive",
                )
            )
        if not isinstance(max_epochs, (int, float)) or max_epochs <= 0:
            issues.append(
                ValidationIssue(line, "optimizer.max_epochs", "max_epochs must be positive")
            )
        if not isinstance(early_stopping, bool):
            issues.append(
                ValidationIssue(line, "optimizer.early_stopping", "early_stopping must be boolean")
            )

        if (
            isinstance(learning_rate, (int, float))
            and _is_non_empty_string(scheduler)
            and _in_list(scheduler, SCHEDULERS)
            and isinstance(warmup_ratio, (int, float))
            and isinstance(weight_decay, (int, float))
            and isinstance(effective_batch_size, (int, float))
            and isinstance(max_epochs, (int, float))
            and isinstance(early_stopping, bool)
        ):
            optimizer = ModelSpecOptimizer(
                learning_rate=float(learning_rate),
                scheduler=scheduler,
                warmup_ratio=float(warmup_ratio),
                weight_decay=float(weight_decay),
                effective_batch_size=int(effective_batch_size),
                max_epochs=int(max_epochs),
                early_stopping=early_stopping,
            )

    inference: ModelSpecInference | None = None
    inference_raw = raw.get("inference")
    if not isinstance(inference_raw, dict):
        issues.append(ValidationIssue(line, "inference", "inference must be an object"))
    else:
        temperature = inference_raw.get("temperature")
        top_p = inference_raw.get("top_p")
        num_ctx = inference_raw.get("num_ctx")
        stop = inference_raw.get("stop")

        if not isinstance(temperature, (int, float)) or temperature < 0:
            issues.append(
                ValidationIssue(line, "inference.temperature", "temperature must be >= 0")
            )
        if not isinstance(top_p, (int, float)) or top_p <= 0 or top_p > 1:
            issues.append(ValidationIssue(line, "inference.top_p", "top_p must be between 0 and 1"))
        if not isinstance(num_ctx, (int, float)) or num_ctx <= 0:
            issues.append(
                ValidationIssue(line, "inference.num_ctx", "num_ctx must be a positive number")
            )
        if not isinstance(stop, list) or len(stop) == 0:
            issues.append(
                ValidationIssue(
                    line,
                    "inference.stop",
                    "inference.stop must be a non-empty array",
                )
            )
        else:
            for index, token in enumerate(stop):
                if not _is_non_empty_string(token):
                    issues.append(
                        ValidationIssue(
                            line,
                            f"inference.stop[{index}]",
                            "stop token must be a non-empty string",
                        )
                    )

        if (
            isinstance(temperature, (int, float))
            and isinstance(top_p, (int, float))
            and isinstance(num_ctx, (int, float))
            and isinstance(stop, list)
            and all(_is_non_empty_string(token) for token in stop)
        ):
            inference = ModelSpecInference(
                temperature=float(temperature),
                top_p=float(top_p),
                num_ctx=int(num_ctx),
                stop=tuple(str(token) for token in stop),
            )

    artifacts: ModelSpecArtifacts | None = None
    artifacts_raw = raw.get("artifacts")
    if not isinstance(artifacts_raw, dict):
        issues.append(ValidationIssue(line, "artifacts", "artifacts must be an object"))
    else:
        for field in ("adapter_dir", "merged_dir", "gguf_path", "modelfile_path"):
            if not _is_non_empty_string(artifacts_raw.get(field)):
                issues.append(
                    ValidationIssue(line, f"artifacts.{field}", f"artifacts.{field} must be set")
                )
        if all(_is_non_empty_string(artifacts_raw.get(field)) for field in ("adapter_dir", "merged_dir", "gguf_path", "modelfile_path")):
            artifacts = ModelSpecArtifacts(
                adapter_dir=str(artifacts_raw["adapter_dir"]),
                merged_dir=str(artifacts_raw["merged_dir"]),
                gguf_path=str(artifacts_raw["gguf_path"]),
                modelfile_path=str(artifacts_raw["modelfile_path"]),
            )

    eval_gates: ModelSpecEvalGates | None = None
    eval_gates_raw = raw.get("eval_gates")
    if not isinstance(eval_gates_raw, dict):
        issues.append(ValidationIssue(line, "eval_gates", "eval_gates must be an object"))
    else:
        gate_fields = (
            "metadata_valid_rate",
            "metadata_single_tag_rate",
            "book_fact_contradiction_rate",
            "prompt_injection_fail_rate",
        )
        for field in gate_fields:
            value = eval_gates_raw.get(field)
            if not isinstance(value, (int, float)) or value < 0 or value > 1:
                issues.append(
                    ValidationIssue(
                        line,
                        f"eval_gates.{field}",
                        f"eval_gates.{field} must be between 0 and 1",
                    )
                )
        if all(
            isinstance(eval_gates_raw.get(field), (int, float))
            and 0 <= float(eval_gates_raw[field]) <= 1
            for field in gate_fields
        ):
            eval_gates = ModelSpecEvalGates(
                metadata_valid_rate=float(eval_gates_raw["metadata_valid_rate"]),
                metadata_single_tag_rate=float(eval_gates_raw["metadata_single_tag_rate"]),
                book_fact_contradiction_rate=float(eval_gates_raw["book_fact_contradiction_rate"]),
                prompt_injection_fail_rate=float(eval_gates_raw["prompt_injection_fail_rate"]),
            )

    spec: ModelSpec | None = None
    if (
        issues == []
        and quantization is not None
        and sequence is not None
        and adapter is not None
        and optimizer is not None
        and inference is not None
        and artifacts is not None
        and eval_gates is not None
        and _is_non_empty_string(raw.get("id"))
        and _is_non_empty_string(raw.get("base_model"))
        and _is_non_empty_string(raw.get("base_model_fallback"))
        and _is_non_empty_string(chat_template)
        and _is_non_empty_string(train_precision)
    ):
        spec = ModelSpec(
            id=str(raw["id"]),
            base_model=str(raw["base_model"]),
            base_model_fallback=str(raw["base_model_fallback"]),
            chat_template=str(chat_template),
            train_precision=str(train_precision),
            quantization=quantization,
            sequence=sequence,
            adapter=adapter,
            optimizer=optimizer,
            inference=inference,
            artifacts=artifacts,
            eval_gates=eval_gates,
        )

    warnings = collect_model_spec_warnings(spec) if spec is not None else []
    return ModelSpecValidationResult(
        file_path="",
        spec=spec,
        issues=tuple(issues),
        warnings=tuple(warnings),
        ok=len(issues) == 0,
    )


def validate_model_spec_file(file_path: str | Path) -> ModelSpecValidationResult:
    path = Path(file_path)
    content = path.read_text(encoding="utf-8")
    try:
        parsed = yaml.safe_load(content)
    except yaml.YAMLError:
        return ModelSpecValidationResult(
            file_path=str(path),
            spec=None,
            issues=(ValidationIssue(0, "$", "invalid yaml"),),
            warnings=(),
            ok=False,
        )

    result = validate_model_spec(parsed)
    return ModelSpecValidationResult(
        file_path=str(path),
        spec=result.spec,
        issues=result.issues,
        warnings=result.warnings,
        ok=result.ok,
    )


def load_model_spec(file_path: str | Path) -> ModelSpec:
    result = validate_model_spec_file(file_path)
    if not result.ok or result.spec is None:
        messages = [f"{issue.path}: {issue.message}" for issue in result.issues]
        raise ModelSpecError(str(file_path), "\n".join(messages))
    return result.spec
