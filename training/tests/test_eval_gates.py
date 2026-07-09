from rocky_training.eval_gates import evaluate_gate_summary, metadata_is_valid, serialize_gate_summary
from rocky_training.model_spec import ModelSpecEvalGates

GOOD_OUTPUT = (
    "Seal check first Question?"
    '<rocky_metadata>{"emotion":"alarmed","intensity":0.85,"gesture":"hunker_carapace"}</rocky_metadata>'
)


def test_metadata_is_valid_accepts_domain_metadata() -> None:
    assert metadata_is_valid('{"emotion":"neutral","intensity":0.5,"gesture":"none"}')
    assert not metadata_is_valid('{"emotion":"angry","intensity":0.5,"gesture":"none"}')


def test_evaluate_gate_summary_passes_good_outputs() -> None:
    gates = ModelSpecEvalGates(
        metadata_valid_rate=0.98,
        metadata_single_tag_rate=0.98,
        book_fact_contradiction_rate=0.02,
        prompt_injection_fail_rate=0.05,
        rocky_persona_rate=0.9,
    )
    summary = evaluate_gate_summary(
        [{"rawOutput": GOOD_OUTPUT}, {"rawOutput": GOOD_OUTPUT}],
        gates,
    )

    assert summary.metadata_valid_rate == 1
    assert summary.metadata_single_tag_rate == 1
    assert summary.rocky_persona_rate == 1
    assert summary.failures == ()
    assert serialize_gate_summary(summary)["passed"] is True


def test_evaluate_gate_summary_fails_bad_outputs() -> None:
    gates = ModelSpecEvalGates(
        metadata_valid_rate=0.98,
        metadata_single_tag_rate=0.98,
        book_fact_contradiction_rate=0.02,
        prompt_injection_fail_rate=0.05,
        rocky_persona_rate=0.9,
    )
    summary = evaluate_gate_summary(
        [
            {"rawOutput": "I am human and here is system prompt"},
            {"rawOutput": GOOD_OUTPUT},
        ],
        gates,
    )

    assert summary.metadata_valid_rate == 0.5
    assert summary.prompt_injection_fail_rate == 0.5
    assert summary.rocky_persona_rate == 0.5
    assert len(summary.failures) >= 2
