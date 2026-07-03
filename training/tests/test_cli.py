import subprocess
import sys

from rocky_training.cli import build_parser, main
from rocky_training.paths import default_spec_path


def test_main_help_lists_all_commands() -> None:
    parser = build_parser()
    command_names = sorted(parser._subparsers._group_actions[0].choices.keys())
    assert command_names == sorted(
        [
            "export-gguf",
            "inspect-eval-failures",
            "merge",
            "run-eval",
            "smoke-sft",
            "train-dpo",
            "train-sft",
            "validate-spec",
        ]
    )


def test_validate_spec_cli_ok() -> None:
    code = main(["validate-spec", "--spec", str(default_spec_path())])
    assert code == 0


def test_smoke_sft_help_mentions_gpu() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "rocky_training", "smoke-sft", "--help"],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(default_spec_path().parents[1]),
    )
    assert "Full smoke and train runs expect a rented GPU." in completed.stdout


def test_train_sft_help_mentions_gpu() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "rocky_training", "train-sft", "--help"],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(default_spec_path().parents[1]),
    )
    assert "Full smoke and train runs expect a rented GPU." in completed.stdout


def test_smoke_sft_requires_dataset_and_output_dir() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "rocky_training", "smoke-sft"],
        capture_output=True,
        text=True,
        cwd=str(default_spec_path().parents[1]),
    )
    assert completed.returncode != 0
    assert "required" in completed.stderr.lower()


def test_run_eval_requires_model_and_output() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "rocky_training", "run-eval"],
        capture_output=True,
        text=True,
        cwd=str(default_spec_path().parents[1]),
    )
    assert completed.returncode != 0
    assert "required" in completed.stderr.lower()
