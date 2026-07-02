from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GoldenPrompt:
    id: str
    scenario_family: str
    user: str


class GoldenPromptError(Exception):
    pass


def load_golden_prompts(path: str | Path, *, limit: int = 0) -> list[GoldenPrompt]:
    prompts: list[GoldenPrompt] = []
    file_path = Path(path)

    for line_number, line in enumerate(file_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as error:
            raise GoldenPromptError(f"line {line_number}: invalid json") from error

        if not isinstance(parsed, dict):
            raise GoldenPromptError(f"line {line_number}: row must be an object")

        prompt_id = parsed.get("id")
        scenario_family = parsed.get("scenarioFamily")
        user = parsed.get("user")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise GoldenPromptError(f"line {line_number}: id must be a non-empty string")
        if not isinstance(scenario_family, str) or not scenario_family:
            raise GoldenPromptError(
                f"line {line_number}: scenarioFamily must be a non-empty string"
            )
        if not isinstance(user, str) or not user:
            raise GoldenPromptError(f"line {line_number}: user must be a non-empty string")

        prompts.append(
            GoldenPrompt(id=prompt_id, scenario_family=scenario_family, user=user)
        )
        if limit > 0 and len(prompts) >= limit:
            break

    if len(prompts) == 0:
        raise GoldenPromptError("golden prompt file contains no rows")
    return prompts
