import json
from pathlib import Path

from rocky_training.golden_prompts import load_golden_prompts
from rocky_training.metadata_parse import parse_model_output
from rocky_training.paths import default_system_prompt_path
from rocky_training.run_eval import load_system_prompt, run_eval

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE_OUTPUT = (
    "Seal check first Question?"
    '<rocky_metadata>{"emotion":"alarmed","intensity":0.85,"gesture":"hunker_carapace"}</rocky_metadata>'
)


def test_parse_model_output_extracts_metadata() -> None:
    parsed = parse_model_output(SAMPLE_OUTPUT)
    assert parsed.spoken == "Seal check first Question?"
    assert parsed.metadata_json is not None
    assert "hunker_carapace" in parsed.metadata_json


def test_load_golden_prompts_respects_limit() -> None:
    prompts = load_golden_prompts(FIXTURES / "golden.eval.jsonl", limit=1)
    assert len(prompts) == 1
    assert prompts[0].id == "eval-repairing_machines"


def test_run_eval_writes_deterministic_results(tmp_path: Path) -> None:
    calls: list[str] = []

    def fake_chat(**kwargs: object) -> str:
        messages = kwargs["messages"]
        assert isinstance(messages, list)
        user = messages[1]["content"]
        calls.append(str(user))
        return SAMPLE_OUTPUT

    output_path = tmp_path / "candidate-eval.json"
    payload = run_eval(
        host="http://localhost:11434",
        model="rocky:v1",
        output_path=output_path,
        golden_path=FIXTURES / "golden.eval.jsonl",
        system_prompt_path=default_system_prompt_path(),
        limit=2,
        label="candidate:rocky:v1",
        chat_caller=fake_chat,
        baseline_path=tmp_path / "base.results.json",
    )

    assert len(payload["results"]) == 2
    assert payload["results"][0]["promptId"] == "eval-eridian_concepts"
    assert payload["results"][1]["promptId"] == "eval-repairing_machines"
    assert payload["baselinePath"] == str(tmp_path / "base.results.json")
    assert payload["stop"] == ["<turn|>"]
    assert payload["gateSummary"]["passed"] is True

    array_path = output_path.with_name("candidate-eval.results.json")
    assert array_path.is_file()
    rows = json.loads(array_path.read_text(encoding="utf-8"))
    assert isinstance(rows, list)
    assert rows[0]["promptId"] == "eval-eridian_concepts"
    assert rows[0]["uncertaintyPatterns"] == ["\\bSeal\\b"]
    assert rows[0]["bookFactForbiddenPatterns"] == ["\\bwe both breathe oxygen\\b"]


def test_system_prompt_file_matches_repo_default() -> None:
    prompt = load_system_prompt(default_system_prompt_path())
    assert "Eridian engineer" in prompt
    assert "rocky_metadata" in prompt
