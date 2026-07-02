from __future__ import annotations

import argparse
import sys

from rocky_training.model_spec import validate_model_spec_file
from rocky_training.paths import default_spec_path

GPU_RUN_HELP = (
    "Full smoke and train runs expect a rented GPU. "
    "Local smoke may use CPU or a small GPU subset."
)


class CLIError(Exception):
    pass


def _add_gpu_note(parser: argparse.ArgumentParser) -> None:
    parser.epilog = GPU_RUN_HELP


def _cmd_validate_spec(args: argparse.Namespace) -> int:
    result = validate_model_spec_file(args.spec)
    for issue in result.issues:
        print(f"{issue.path}: {issue.message}", file=sys.stderr)
    for warning in result.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if result.ok:
        print(f"ok: {result.file_path}")
        return 0
    return 1


def _cmd_not_implemented(name: str) -> int:
    print(f"{name} is not implemented yet", file=sys.stderr)
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rocky_training")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_spec = subparsers.add_parser("validate-spec", help="validate a ModelSpec yaml file")
    validate_spec.add_argument("--spec", type=str, default=str(default_spec_path()))
    validate_spec.set_defaults(handler=_cmd_validate_spec)

    smoke_sft = subparsers.add_parser("smoke-sft", help="run tiny qlora smoke training")
    _add_gpu_note(smoke_sft)
    smoke_sft.add_argument("--spec", type=str, default=str(default_spec_path()))
    smoke_sft.add_argument("--dataset", type=str, required=True)
    smoke_sft.add_argument("--output-dir", type=str, required=True)
    smoke_sft.set_defaults(handler=lambda _args: _cmd_not_implemented("smoke-sft"))

    train_sft = subparsers.add_parser("train-sft", help="run full sft training")
    _add_gpu_note(train_sft)
    train_sft.add_argument("--spec", type=str, default=str(default_spec_path()))
    train_sft.add_argument("--dataset", type=str, required=True)
    train_sft.add_argument("--output-dir", type=str, required=True)
    train_sft.set_defaults(handler=lambda _args: _cmd_not_implemented("train-sft"))

    train_dpo = subparsers.add_parser("train-dpo", help="run dpo training")
    _add_gpu_note(train_dpo)
    train_dpo.add_argument("--spec", type=str, default=str(default_spec_path()))
    train_dpo.add_argument("--dataset", type=str, required=True)
    train_dpo.add_argument("--output-dir", type=str, required=True)
    train_dpo.set_defaults(handler=lambda _args: _cmd_not_implemented("train-dpo"))

    merge = subparsers.add_parser("merge", help="merge adapter into base weights")
    merge.add_argument("--spec", type=str, default=str(default_spec_path()))
    merge.add_argument("--adapter-dir", type=str, required=True)
    merge.add_argument("--output-dir", type=str, required=True)
    merge.set_defaults(handler=lambda _args: _cmd_not_implemented("merge"))

    export_gguf = subparsers.add_parser("export-gguf", help="export merged weights to gguf")
    export_gguf.add_argument("--spec", type=str, default=str(default_spec_path()))
    export_gguf.add_argument("--merged-dir", type=str, required=True)
    export_gguf.add_argument("--output-path", type=str, required=True)
    export_gguf.set_defaults(handler=lambda _args: _cmd_not_implemented("export-gguf"))

    run_eval = subparsers.add_parser("run-eval", help="run baseline eval against a model endpoint")
    run_eval.add_argument("--host", type=str, default="http://localhost:11434")
    run_eval.add_argument("--model", type=str, required=True)
    run_eval.add_argument("--output", type=str, required=True)
    run_eval.add_argument("--limit", type=int, default=0)
    run_eval.set_defaults(handler=lambda _args: _cmd_not_implemented("run-eval"))

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except CLIError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
