import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  collectModelSpecWarnings,
  defaultModelSpecPath,
  MODEL_SPEC_BASE_MODEL_WARNING,
  MODEL_SPEC_EXPORT_QUANT_WARNING,
  validateModelSpec,
  validateModelSpecFile,
} from "./model-spec.js"

describe("validateModelSpecFile", () => {
  it("validates checked-in rocky gemma spec", () => {
    const result = validateModelSpecFile(defaultModelSpecPath())

    assert.equal(result.ok, true, JSON.stringify(result.issues))
    assert.equal(result.spec?.id, "rocky-gemma-e4b-v1")
    assert.equal(result.spec?.quantization.export, "q4_k_m")
    assert.ok(result.warnings.some((warning) => warning.includes(MODEL_SPEC_EXPORT_QUANT_WARNING)))
    assert.ok(result.warnings.some((warning) => warning.includes(MODEL_SPEC_BASE_MODEL_WARNING)))
  })
})

describe("validateModelSpec", () => {
  it("rejects invalid adapter rank", () => {
    const result = validateModelSpec({
      id: "bad",
      base_model: "org/model",
      base_model_fallback: "org/fallback",
      chat_template: "gemma",
      train_precision: "bf16",
      quantization: { train: "nf4", export: "q4_k_m" },
      sequence: { max_length: 4096 },
      adapter: {
        method: "qlora",
        rank: 0,
        alpha: 32,
        dropout: 0.05,
        target_modules: ["q_proj"],
      },
      optimizer: {
        learning_rate: 0.0001,
        scheduler: "cosine",
        warmup_ratio: 0.03,
        weight_decay: 0.01,
        effective_batch_size: 16,
        max_epochs: 3,
        early_stopping: true,
      },
      inference: { temperature: 0.7, top_p: 0.9, num_ctx: 4096, stop: ["</rocky_metadata>"] },
      artifacts: {
        adapter_dir: "a",
        merged_dir: "m",
        gguf_path: "g",
        modelfile_path: "f",
      },
      eval_gates: {
        metadata_valid_rate: 0.98,
        metadata_single_tag_rate: 0.98,
        book_fact_contradiction_rate: 0.02,
        prompt_injection_fail_rate: 0.05,
      },
    })

    assert.ok(result.issues.some((issue) => issue.path === "adapter.rank"))
  })

  it("warns on placeholder base model ids", () => {
    const spec = validateModelSpec({
      id: "rocky-gemma-e4b-v1",
      base_model: "PLACEHOLDER_VERIFY_UPSTREAM_GEMMA_E4B_IT",
      base_model_fallback: "org/fallback",
      chat_template: "gemma",
      train_precision: "bf16",
      quantization: { train: "nf4", export: "q4_k_m" },
      sequence: { max_length: 4096 },
      adapter: {
        method: "qlora",
        rank: 16,
        alpha: 32,
        dropout: 0.05,
        target_modules: ["q_proj"],
      },
      optimizer: {
        learning_rate: 0.0001,
        scheduler: "cosine",
        warmup_ratio: 0.03,
        weight_decay: 0.01,
        effective_batch_size: 16,
        max_epochs: 3,
        early_stopping: true,
      },
      inference: { temperature: 0.7, top_p: 0.9, num_ctx: 4096, stop: ["</rocky_metadata>"] },
      artifacts: {
        adapter_dir: "a",
        merged_dir: "m",
        gguf_path: "g",
        modelfile_path: "f",
      },
      eval_gates: {
        metadata_valid_rate: 0.98,
        metadata_single_tag_rate: 0.98,
        book_fact_contradiction_rate: 0.02,
        prompt_injection_fail_rate: 0.05,
      },
    }).spec

    assert.ok(spec)
    assert.ok(collectModelSpecWarnings(spec).some((warning) => warning.includes("PLACEHOLDER_")))
  })
})
