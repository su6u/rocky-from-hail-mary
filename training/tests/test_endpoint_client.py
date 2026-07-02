from unittest.mock import patch

from rocky_training.endpoint_client import call_ollama_chat


def test_call_ollama_chat_passes_stop_tokens() -> None:
    with patch("rocky_training.endpoint_client._post_json") as post_json:
        post_json.return_value = {"message": {"content": "ok"}}
        call_ollama_chat(
            host="http://localhost:11434",
            model="rocky:v1",
            messages=[{"role": "user", "content": "hi"}],
            stop=["</rocky_metadata>"],
        )

    payload = post_json.call_args.args[1]
    assert payload["options"]["stop"] == ["</rocky_metadata>"]
