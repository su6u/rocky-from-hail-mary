import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SYSTEM_PROMPT } from "@rocky/prompt"

import { loadModelSpec } from "./model-spec.js"
import {
  assertCanonicalSystemPrompt,
  generateModelfile,
  MODELFILE_GENERATED_MARKER,
  ModelfileError,
  resolveModelfileGgufFrom,
} from "./modelfile.js"
import { promptHash } from "./trainer-export.js"

describe("generateModelfile", () => {
  it("generates modelfile from spec and canonical prompt", () => {
    const spec = loadModelSpec()
    const output = generateModelfile({ spec })

    assert.match(output, new RegExp(`^# ${MODELFILE_GENERATED_MARKER}`))
    assert.match(output, /# prompt_hash: [a-f0-9]{64}/)
    assert.ok(output.includes(`FROM ${resolveModelfileGgufFrom(spec.artifacts.gguf_path)}`))
    assert.match(output, /PARAMETER temperature 0\.7/)
    assert.match(output, /PARAMETER top_p 0\.9/)
    assert.match(output, /PARAMETER num_ctx 4096/)
    assert.ok(output.includes('STOP "</rocky_metadata>"'))
    assert.ok(output.includes(`SYSTEM """${SYSTEM_PROMPT}"""`))
    assert.ok(output.includes(`# prompt_hash: ${promptHash()}`))
  })

  it("rejects non-canonical system prompt", () => {
    const spec = loadModelSpec()

    assert.throws(
      () => generateModelfile({ spec, systemPrompt: "wrong prompt" }),
      (error: unknown) => error instanceof ModelfileError,
    )
    assert.throws(() => assertCanonicalSystemPrompt("wrong prompt"), ModelfileError)
  })
})
