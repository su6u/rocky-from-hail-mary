from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from rocky_training.model_spec import ModelSpec, load_model_spec
from rocky_training.trainer_jsonl import write_json


class ExportGgufError(Exception):
    pass


@dataclass(frozen=True)
class ExportGgufResult:
    merged_dir: str
    output_path: str
    outtype: str
    convert_script: str


def resolve_convert_script(explicit: Path | None) -> Path:
    if explicit is not None:
        if not explicit.is_file():
            raise ExportGgufError(f"convert script not found: {explicit}")
        return explicit

    env_path = __import__("os").environ.get("LLAMA_CPP_CONVERT_SCRIPT")
    if env_path:
        path = Path(env_path)
        if path.is_file():
            return path

    raise ExportGgufError(
        "llama.cpp convert script required; pass --convert-script or set LLAMA_CPP_CONVERT_SCRIPT"
    )


def export_merged_to_gguf(
    *,
    spec: ModelSpec,
    merged_dir: Path,
    output_path: Path,
    convert_script: Path,
    outtype: str | None = None,
) -> ExportGgufResult:
    if not merged_dir.is_dir():
        raise ExportGgufError(f"merged model directory not found: {merged_dir}")
    if not (merged_dir / "config.json").is_file():
        raise ExportGgufError(f"merged model missing config.json: {merged_dir}")

    resolved_outtype = outtype or spec.quantization.export
    output_path.parent.mkdir(parents=True, exist_ok=True)

    completed = subprocess.run(
        [
            sys.executable,
            str(convert_script),
            str(merged_dir),
            "--outfile",
            str(output_path),
            "--outtype",
            resolved_outtype,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.strip() or completed.stdout.strip() or "unknown error"
        raise ExportGgufError(f"gguf export failed: {stderr}")

    if not output_path.is_file():
        raise ExportGgufError(f"gguf export did not create output file: {output_path}")

    return ExportGgufResult(
        merged_dir=str(merged_dir),
        output_path=str(output_path),
        outtype=resolved_outtype,
        convert_script=str(convert_script),
    )


def build_export_gguf_manifest(
    *,
    spec: ModelSpec,
    merged_dir: Path,
    output_path: Path,
    export: ExportGgufResult | None,
    dry_run: bool,
    convert_script: Path | None,
) -> dict[str, Any]:
    return {
        "kind": "export-gguf",
        "dryRun": dry_run,
        "specId": spec.id,
        "mergedDir": str(merged_dir),
        "outputPath": str(output_path),
        "outtype": export.outtype if export else spec.quantization.export,
        "convertScript": export.convert_script if export else (str(convert_script) if convert_script else None),
        "modelfilePath": spec.artifacts.modelfile_path,
        "finishedAt": datetime.now(UTC).replace(microsecond=0).isoformat(),
    }


def run_export_gguf(
    *,
    spec_path: Path,
    merged_dir: Path,
    output_path: Path,
    convert_script: Path | None = None,
    outtype: str | None = None,
    dry_run: bool = False,
    export_runner: Callable[..., ExportGgufResult] | None = None,
) -> dict[str, Any]:
    spec = load_model_spec(spec_path)
    resolved_convert_script = None if dry_run else resolve_convert_script(convert_script)

    export: ExportGgufResult | None = None
    if not dry_run:
        if resolved_convert_script is None:
            raise ExportGgufError("convert script is required for export")
        runner = export_runner or export_merged_to_gguf
        export = runner(
            spec=spec,
            merged_dir=merged_dir,
            output_path=output_path,
            convert_script=resolved_convert_script,
            outtype=outtype,
        )

    manifest = build_export_gguf_manifest(
        spec=spec,
        merged_dir=merged_dir,
        output_path=output_path,
        export=export,
        dry_run=dry_run,
        convert_script=resolved_convert_script,
    )
    write_json(output_path.parent / "export-gguf.manifest.json", manifest)
    return manifest
