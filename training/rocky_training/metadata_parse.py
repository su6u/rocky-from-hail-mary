from __future__ import annotations

import json
import re
from dataclasses import dataclass


METADATA_TAG = "rocky_metadata"
OPEN_TAG = f"<{METADATA_TAG}>"
CLOSE_TAG = f"</{METADATA_TAG}>"


@dataclass(frozen=True)
class ParsedModelOutput:
    spoken: str
    metadata_json: str | None


def parse_model_output(raw_output: str) -> ParsedModelOutput:
    start = raw_output.find(OPEN_TAG)
    if start == -1:
        return ParsedModelOutput(spoken=raw_output.strip(), metadata_json=None)

    end = raw_output.find(CLOSE_TAG, start + len(OPEN_TAG))
    if end == -1:
        return ParsedModelOutput(spoken=raw_output.strip(), metadata_json=None)

    spoken = raw_output[:start].strip()
    metadata_json = raw_output[start + len(OPEN_TAG) : end].strip()
    if metadata_json.startswith("{") and metadata_json.endswith("}"):
        try:
            json.loads(metadata_json)
        except json.JSONDecodeError:
            metadata_json = None
    else:
        metadata_json = None

    return ParsedModelOutput(spoken=spoken, metadata_json=metadata_json)


def slugify_label(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip())
    return cleaned.strip("-") or "model"
