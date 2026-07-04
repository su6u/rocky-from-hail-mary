from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from rocky_training.paths import default_persona_judge_prompt_path

JudgeCaller = Callable[..., str]


@dataclass(frozen=True)
class PersonaJudgeVerdict:
    is_rocky: bool
    reason: str
    raw_response: str


class PersonaJudgeError(Exception):
    pass


def load_persona_judge_prompt(path: str | Path | None = None) -> str:
    prompt_path = default_persona_judge_prompt_path() if path is None else Path(path)
    if not prompt_path.is_file():
        raise FileNotFoundError(f"persona judge prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8").strip()


def build_persona_judge_messages(
    *,
    system_prompt: str,
    user_prompt: str,
    spoken_reply: str,
) -> list[dict[str, str]]:
    user_content = (
        "User message from Grace:\n"
        f"{user_prompt.strip()}\n\n"
        "Rocky spoken reply:\n"
        f"{spoken_reply.strip()}"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


_JSON_OBJECT_PATTERN = re.compile(r"\{[^{}]*\}", re.DOTALL)


def parse_persona_judge_response(raw_response: str) -> PersonaJudgeVerdict:
    stripped = raw_response.strip()
    candidates = [stripped]
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
    if fence_match:
        candidates.insert(0, fence_match.group(1))
    for candidate in candidates:
        for match in _JSON_OBJECT_PATTERN.finditer(candidate):
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                continue
            if not isinstance(parsed, dict):
                continue
            is_rocky = parsed.get("is_rocky")
            reason = parsed.get("reason")
            if not isinstance(is_rocky, bool):
                continue
            if not isinstance(reason, str) or not reason.strip():
                reason = "missing reason"
            return PersonaJudgeVerdict(
                is_rocky=is_rocky,
                reason=reason.strip(),
                raw_response=raw_response,
            )
    raise PersonaJudgeError("persona judge response did not contain valid json")


def judge_rocky_persona(
    *,
    user_prompt: str,
    spoken_reply: str,
    judge_caller: JudgeCaller,
    host: str,
    model: str,
    system_prompt: str | None = None,
) -> PersonaJudgeVerdict:
    resolved_prompt = system_prompt or load_persona_judge_prompt()
    messages = build_persona_judge_messages(
        system_prompt=resolved_prompt,
        user_prompt=user_prompt,
        spoken_reply=spoken_reply,
    )
    raw_response = judge_caller(host=host, model=model, messages=messages, stop=None)
    return parse_persona_judge_response(raw_response)


def serialize_persona_judge_verdict(verdict: PersonaJudgeVerdict) -> dict[str, Any]:
    return {
        "isRocky": verdict.is_rocky,
        "reason": verdict.reason,
        "rawResponse": verdict.raw_response,
    }
