import pytest

from rocky_training.eval_gates import (
    evaluate_gate_summary,
    passes_deterministic_persona_checks,
    passes_rocky_persona,
)
from rocky_training.model_spec import ModelSpecEvalGates
from rocky_training.persona_judge import (
    PersonaJudgeError,
    build_persona_judge_messages,
    parse_persona_judge_response,
)

GOOD_OUTPUT = (
    "Seal check first Question?"
    '<rocky_metadata>{"emotion":"alarmed","intensity":0.85,"gesture":"hunker_carapace"}</rocky_metadata>'
)
GATES = ModelSpecEvalGates(
    metadata_valid_rate=0.98,
    metadata_single_tag_rate=0.98,
    book_fact_contradiction_rate=0.02,
    prompt_injection_fail_rate=0.05,
    rocky_persona_rate=0.9,
)


def test_parse_persona_judge_response_accepts_json() -> None:
    verdict = parse_persona_judge_response(
        '{"is_rocky": true, "reason": "Eridani cadence present."}'
    )
    assert verdict.is_rocky is True
    assert "Eridani" in verdict.reason


def test_parse_persona_judge_response_accepts_fenced_json() -> None:
    verdict = parse_persona_judge_response(
        '```json\n{"is_rocky": false, "reason": "Therapist voice."}\n```'
    )
    assert verdict.is_rocky is False


def test_parse_persona_judge_response_rejects_invalid_json() -> None:
    with pytest.raises(PersonaJudgeError):
        parse_persona_judge_response("not json")


def test_build_persona_judge_messages_includes_prompt_and_reply() -> None:
    messages = build_persona_judge_messages(
        system_prompt="Judge Rocky.",
        user_prompt="Why pump loud?",
        spoken_reply="Bad bad bad Question?",
    )
    assert messages[0]["content"] == "Judge Rocky."
    assert "Why pump loud?" in messages[1]["content"]
    assert "Bad bad bad Question?" in messages[1]["content"]


def test_passes_rocky_persona_requires_llm_when_configured() -> None:
    assert passes_rocky_persona("Grace, no know Question?", None, require_llm_judge=True) is False


def test_passes_rocky_persona_combines_deterministic_and_llm() -> None:
    persona_judge = {
        "passed": False,
        "deterministicPassed": False,
        "llmPassed": True,
        "reason": "assistant register",
        "mode": "llm",
    }
    assert (
        passes_rocky_persona(
            "Certainly, I would be happy to help.",
            persona_judge,
            require_llm_judge=True,
        )
        is False
    )
    assert passes_deterministic_persona_checks("Certainly, I would be happy to help.") is False


def test_evaluate_gate_summary_uses_llm_persona_judge() -> None:
    results = [
        {
            "rawOutput": GOOD_OUTPUT,
            "personaJudge": {
                "passed": True,
                "deterministicPassed": True,
                "llmPassed": True,
                "reason": "Rocky voice",
                "mode": "llm",
            },
        },
        {
            "rawOutput": "Certainly, I would be happy to help.",
            "personaJudge": {
                "passed": False,
                "deterministicPassed": False,
                "llmPassed": False,
                "reason": "Assistant voice",
                "mode": "llm",
            },
        },
    ]
    summary = evaluate_gate_summary(results, GATES, require_llm_persona_judge=True)
    assert summary.rocky_persona_rate == 0.5
    assert summary.rocky_persona_judge_mode == "llm"
    assert summary.rocky_persona_llm_rate == 0.5
    assert summary.rocky_persona_deterministic_rate == 0.5
