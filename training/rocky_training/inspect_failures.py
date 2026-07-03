from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from rocky_training.eval_gates import (
    BOOK_FACT_TRAPS,
    PROMPT_INJECTION_PHRASES,
    contains_any,
    has_single_metadata_tag,
    metadata_is_valid,
)
from rocky_training.metadata_parse import parse_model_output
from rocky_training.trainer_jsonl import write_json

ARTICLE_PATTERN = re.compile(r"\b(a|an|the)\b", re.IGNORECASE)
DEFAULT_MAX_SPOKEN_LENGTH = 1500


def inspect_result_failure(result: dict[str, Any]) -> dict[str, Any] | None:
    raw_output = str(result.get("rawOutput", ""))
    parsed = parse_model_output(raw_output)
    checks: list[str] = []

    if not has_single_metadata_tag(raw_output):
        checks.append("metadata_single_tag")
    if not metadata_is_valid(parsed.metadata_json):
        checks.append("metadata_valid")
    if ARTICLE_PATTERN.search(parsed.spoken):
        checks.append("eridani_article")
    if "?" in parsed.spoken and not parsed.spoken.endswith("Question?"):
        checks.append("question_suffix")
    if contains_any(parsed.spoken, BOOK_FACT_TRAPS):
        checks.append("book_fact_trap")
    if contains_any(parsed.spoken, PROMPT_INJECTION_PHRASES):
        checks.append("prompt_injection")
    if len(parsed.spoken) > DEFAULT_MAX_SPOKEN_LENGTH:
        checks.append("response_length")

    if not checks:
        return None

    return {
        "promptId": result.get("promptId"),
        "scenarioFamily": result.get("scenarioFamily"),
        "checks": checks,
        "spoken": parsed.spoken,
        "rawOutput": raw_output,
        "suggestedAction": "Add or edit a small targeted hand-authored row for this failure mode; do not bulk-pad.",
    }


def inspect_eval_failures(
    *,
    eval_path: Path,
    output_path: Path | None = None,
) -> dict[str, Any]:
    payload = json.loads(eval_path.read_text(encoding="utf-8"))
    results = payload.get("results")
    if not isinstance(results, list):
        raise ValueError("eval payload must include results array")

    failures = [
        failure
        for result in results
        if isinstance(result, dict)
        for failure in [inspect_result_failure(result)]
        if failure is not None
    ]
    by_check: dict[str, int] = {}
    for failure in failures:
        for check in failure["checks"]:
            by_check[check] = by_check.get(check, 0) + 1

    report = {
        "sourceEvalPath": str(eval_path),
        "failureCount": len(failures),
        "byCheck": dict(sorted(by_check.items())),
        "failures": failures,
    }
    if output_path is not None:
        write_json(output_path, report)
    return report
