import subprocess
import sys

from rocky_training.model_spec import (
    MODEL_SPEC_BASE_MODEL_WARNING,
    MODEL_SPEC_EXPORT_QUANT_WARNING,
    validate_model_spec,
    validate_model_spec_file,
)
from rocky_training.paths import default_spec_path


def test_validate_model_spec_file_accepts_checked_in_spec() -> None:
    result = validate_model_spec_file(default_spec_path())
    assert result.ok, [f"{issue.path}: {issue.message}" for issue in result.issues]
    assert result.spec is not None
    assert result.spec.id == "rocky-gemma-e4b-v1"
    assert MODEL_SPEC_EXPORT_QUANT_WARNING in result.warnings
    assert MODEL_SPEC_BASE_MODEL_WARNING in result.warnings


def test_validate_model_spec_rejects_invalid_adapter_rank() -> None:
    result = validate_model_spec(
        {
            "id": "bad",
            "base_model": "org/model",
            "base_model_fallback": "org/fallback",
            "chat_template": "gemma",
            "train_precision": "bf16",
            "quantization": {"train": "nf4", "export": "q4_k_m"},
            "sequence": {"max_length": 4096},
            "adapter": {
                "method": "qlora",
                "rank": 0,
                "alpha": 32,
                "dropout": 0.05,
                "target_modules": ["q_proj"],
            },
            "optimizer": {
                "learning_rate": 0.0001,
                "scheduler": "cosine",
                "warmup_ratio": 0.03,
                "weight_decay": 0.01,
                "effective_batch_size": 16,
                "max_epochs": 3,
                "early_stopping": True,
            },
            "inference": {
                "temperature": 0.7,
                "top_p": 0.9,
                "num_ctx": 4096,
                "stop": ["</rocky_metadata>"],
            },
            "artifacts": {
                "adapter_dir": "a",
                "merged_dir": "m",
                "gguf_path": "g",
                "modelfile_path": "f",
            },
            "eval_gates": {
                "metadata_valid_rate": 0.98,
                "metadata_single_tag_rate": 0.98,
                "book_fact_contradiction_rate": 0.02,
                "prompt_injection_fail_rate": 0.05,
            },
        }
    )
    assert any(issue.path == "adapter.rank" for issue in result.issues)


def test_module_help_works() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "rocky_training", "--help"],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(default_spec_path().parents[1]),
    )
    assert "validate-spec" in completed.stdout
    assert "smoke-sft" in completed.stdout
    assert "run-eval" in completed.stdout
