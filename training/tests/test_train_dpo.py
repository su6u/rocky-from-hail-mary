from pathlib import Path

import pytest

from rocky_training.paths import DEFAULT_GEMMA_E4B_IT, default_spec_path
from rocky_training.model_spec import load_model_spec
from rocky_training.train_dpo import (
    TrainDpoError,
    build_preference_dataset_rows,
    load_preference_jsonl,
    run_train_dpo,
)


def test_load_preference_jsonl_requires_distinct_chosen_rejected(tmp_path: Path) -> None:
    path = tmp_path / "prefs.jsonl"
    path.write_text(
        '{"id":"pref-1","prompt":"Pump leaks","chosen":"Fix seal","rejected":"Fix seal"}\n',
        encoding="utf-8",
    )

    with pytest.raises(TrainDpoError):
        load_preference_jsonl(path)


def test_run_train_dpo_dry_run_writes_manifest(tmp_path: Path) -> None:
    path = tmp_path / "prefs.jsonl"
    path.write_text(
        '{"id":"pref-1","prompt":"Pump leaks","chosen":"Seal bad. Replace seal.<rocky_metadata>{\\"emotion\\":\\"neutral\\",\\"intensity\\":0.5,\\"gesture\\":\\"none\\"}</rocky_metadata>","rejected":"The pump appears to be leaking, so you should replace the seal."}\n',
        encoding="utf-8",
    )

    manifest = run_train_dpo(
        spec_path=default_spec_path(),
        dataset_path=path,
        output_dir=tmp_path / "dpo",
        base_model=DEFAULT_GEMMA_E4B_IT,
        dry_run=True,
    )

    assert manifest["kind"] == "train-dpo"
    assert manifest["dryRun"] is True
    assert manifest["preferenceRowCount"] == 1
    assert manifest["sftAdapterDir"].endswith("runs/rocky-gemma-e4b-v2/adapter")
    assert (tmp_path / "dpo" / "manifest.json").is_file()


def test_build_preference_dataset_rows_renders_gemma4_prompt(tmp_path: Path) -> None:
    path = tmp_path / "prefs.jsonl"
    path.write_text(
        '{"id":"pref-1","prompt":"Pump leaks","chosen":"Seal bad.<rocky_metadata>{\\"emotion\\":\\"neutral\\",\\"intensity\\":0.5,\\"gesture\\":\\"none\\"}</rocky_metadata>","rejected":"Certainly, replace the seal."}\n',
        encoding="utf-8",
    )
    rows = load_preference_jsonl(path)
    spec = load_model_spec(default_spec_path())

    rendered = build_preference_dataset_rows(rows, spec=spec, system_prompt="You are Rocky.")

    assert rendered[0]["prompt"].startswith("<|turn>system\nYou are Rocky.<turn|>")
    assert "<|turn>user\nPump leaks<turn|>" in rendered[0]["prompt"]
    assert rendered[0]["prompt"].endswith("<|turn>model\n")
    assert rendered[0]["chosen"].endswith("<turn|>")
    assert rendered[0]["rejected"].endswith("<turn|>")
