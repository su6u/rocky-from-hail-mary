from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from rocky_training.endpoint_client import call_llama_cpp_chat, call_ollama_chat
from rocky_training.eval_gates import evaluate_gate_summary, serialize_gate_summary
from rocky_training.golden_prompts import GoldenPrompt, load_golden_prompts
from rocky_training.metadata_parse import parse_model_output, slugify_label
from rocky_training.model_spec import load_model_spec
from rocky_training.paths import default_golden_eval_path, default_spec_path, default_system_prompt_path
from rocky_training.trainer_jsonl import write_json


@dataclass(frozen=True)
class EvalResultRow:
    id: str
    prompt_id: str
    scenario_family: str
    raw_output: str
    spoken: str
    metadata_json: str | None
    grounding_patterns: tuple[str, ...] = ()
    uncertainty_patterns: tuple[str, ...] = ()
    roleplay_forbidden_patterns: tuple[str, ...] = ()
    book_fact_forbidden_patterns: tuple[str, ...] = ()


ChatCaller = Callable[..., str]


def load_system_prompt(path: str | Path | None = None) -> str:
    prompt_path = Path(path) if path is not None else default_system_prompt_path()
    if not prompt_path.is_file():
        raise FileNotFoundError(f"system prompt file not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def build_eval_messages(system_prompt: str, user_prompt: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]


def make_result_row(label: str, prompt: GoldenPrompt, raw_output: str) -> EvalResultRow:
    parsed = parse_model_output(raw_output)
    slug = slugify_label(label)
    return EvalResultRow(
        id=f"{slug}-{prompt.id}",
        prompt_id=prompt.id,
        scenario_family=prompt.scenario_family,
        raw_output=raw_output,
        spoken=parsed.spoken,
        metadata_json=parsed.metadata_json,
        grounding_patterns=prompt.grounding_patterns,
        uncertainty_patterns=prompt.uncertainty_patterns,
        roleplay_forbidden_patterns=prompt.roleplay_forbidden_patterns,
        book_fact_forbidden_patterns=prompt.book_fact_forbidden_patterns,
    )


def serialize_eval_results(rows: list[EvalResultRow]) -> list[dict[str, Any]]:
    sorted_rows = sorted(rows, key=lambda row: row.prompt_id)
    result_rows: list[dict[str, Any]] = []
    for row in sorted_rows:
        result: dict[str, Any] = {
            "id": row.id,
            "promptId": row.prompt_id,
            "scenarioFamily": row.scenario_family,
            "rawOutput": row.raw_output,
        }
        if row.grounding_patterns:
            result["groundingPatterns"] = list(row.grounding_patterns)
        if row.uncertainty_patterns:
            result["uncertaintyPatterns"] = list(row.uncertainty_patterns)
        if row.roleplay_forbidden_patterns:
            result["roleplayForbiddenPatterns"] = list(row.roleplay_forbidden_patterns)
        if row.book_fact_forbidden_patterns:
            result["bookFactForbiddenPatterns"] = list(row.book_fact_forbidden_patterns)
        result_rows.append(result)
    return result_rows


def build_eval_run_payload(
    *,
    label: str,
    model: str,
    host: str,
    backend: str,
    results: list[EvalResultRow],
    baseline_path: str | None = None,
) -> dict[str, Any]:
    return {
        "label": label,
        "model": model,
        "host": host,
        "backend": backend,
        "generatedAt": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "baselinePath": baseline_path,
        "results": serialize_eval_results(results),
    }


def select_chat_caller(backend: str) -> ChatCaller:
    if backend == "ollama":
        return call_ollama_chat
    if backend == "llama-cpp":
        return call_llama_cpp_chat
    raise ValueError(f"unsupported backend: {backend}")


def run_eval(
    *,
    host: str,
    model: str,
    output_path: Path,
    golden_path: Path | None = None,
    system_prompt_path: Path | None = None,
    spec_path: Path | None = None,
    limit: int = 0,
    label: str | None = None,
    backend: str = "ollama",
    baseline_path: Path | None = None,
    chat_caller: ChatCaller | None = None,
) -> dict[str, Any]:
    resolved_label = label or f"{backend}:{model}"
    prompts = load_golden_prompts(golden_path or default_golden_eval_path(), limit=limit)
    system_prompt = load_system_prompt(system_prompt_path)
    spec = load_model_spec(spec_path or default_spec_path())
    stop_tokens = list(spec.inference.stop)
    caller = chat_caller or select_chat_caller(backend)

    rows: list[EvalResultRow] = []
    for prompt in prompts:
        messages = build_eval_messages(system_prompt, prompt.user)
        raw_output = caller(host=host, model=model, messages=messages, stop=stop_tokens)
        rows.append(make_result_row(resolved_label, prompt, raw_output))

    payload = build_eval_run_payload(
        label=resolved_label,
        model=model,
        host=host,
        backend=backend,
        results=rows,
        baseline_path=str(baseline_path) if baseline_path is not None else None,
    )
    payload["stop"] = stop_tokens
    payload["results"] = serialize_eval_results(rows)
    gate_summary = evaluate_gate_summary(payload["results"], spec.eval_gates)
    payload["gateSummary"] = serialize_gate_summary(gate_summary)
    write_json(output_path, payload)
    array_path = output_path.with_name(f"{output_path.stem}.results.json")
    array_path.write_text(
        json.dumps(payload["results"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return payload
