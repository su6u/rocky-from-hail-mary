from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class EndpointError(Exception):
    pass


def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise EndpointError(f"request failed: {error.code} {detail}") from error
    except urllib.error.URLError as error:
        raise EndpointError(f"request failed: {error.reason}") from error

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as error:
        raise EndpointError("response was not valid json") from error

    if not isinstance(parsed, dict):
        raise EndpointError("response must be an object")
    return parsed


def call_ollama_chat(
    *,
    host: str,
    model: str,
    messages: list[dict[str, str]],
    stop: list[str] | None = None,
) -> str:
    url = f"{host.rstrip('/')}/api/chat"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "think": False,
    }
    if stop:
        payload["options"] = {"stop": stop}
    parsed = _post_json(url, payload)
    message = parsed.get("message")
    if not isinstance(message, dict):
        raise EndpointError("ollama response missing message")
    content = message.get("content")
    if not isinstance(content, str):
        raise EndpointError("ollama response missing message.content")
    return content


def call_llama_cpp_chat(
    *,
    host: str,
    model: str,
    messages: list[dict[str, str]],
    stop: list[str] | None = None,
) -> str:
    url = f"{host.rstrip('/')}/v1/chat/completions"
    payload: dict[str, Any] = {"model": model, "messages": messages, "stream": False}
    if stop:
        payload["stop"] = stop
    parsed = _post_json(url, payload)
    choices = parsed.get("choices")
    if not isinstance(choices, list) or len(choices) == 0:
        raise EndpointError("llama.cpp response missing choices")
    first = choices[0]
    if not isinstance(first, dict):
        raise EndpointError("llama.cpp choice must be an object")
    message = first.get("message")
    if not isinstance(message, dict):
        raise EndpointError("llama.cpp response missing message")
    content = message.get("content")
    if not isinstance(content, str):
        raise EndpointError("llama.cpp response missing message.content")
    return content
