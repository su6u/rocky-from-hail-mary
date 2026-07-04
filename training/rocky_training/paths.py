from pathlib import Path

DEFAULT_GEMMA_E4B_IT = "google/gemma-4-E4B-it"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def training_root() -> Path:
    return Path(__file__).resolve().parents[1]


def default_spec_path() -> Path:
    return training_root() / "specs" / "rocky-gemma-e4b-v2.yaml"


def default_golden_eval_path() -> Path:
    return repo_root() / "research" / "seed-corpus" / "evaluation-golden-v2.jsonl"


def default_persona_eval_path() -> Path:
    return repo_root() / "research" / "seed-corpus" / "evaluation-persona-holdout.jsonl"


def default_preference_dataset_path() -> Path:
    return repo_root() / "research" / "seed-corpus" / "preferences" / "rocky-v2.persona-dpo.jsonl"


def default_system_prompt_path() -> Path:
    return training_root() / "prompts" / "rocky-system.txt"


def default_persona_judge_prompt_path() -> Path:
    return training_root() / "prompts" / "persona-judge.txt"


def default_persona_judge_model() -> str:
    return DEFAULT_GEMMA_E4B_IT
