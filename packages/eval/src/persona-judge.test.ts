import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildPersonaJudgeBlock,
  buildPersonaJudgeMessages,
  parsePersonaJudgeResponse,
  passesDeterministicPersonaChecks,
  passesRockyPersona,
  PersonaJudgeError,
} from "./persona-judge.js"

describe("buildPersonaJudgeMessages", () => {
  it("includes Grace user prompt and Rocky spoken reply", () => {
    const messages = buildPersonaJudgeMessages("Why pump loud?", "Bad bad bad Question?")
    assert.equal(messages.length, 2)
    assert.match(messages[1]?.content ?? "", /Why pump loud\?/)
    assert.match(messages[1]?.content ?? "", /Bad bad bad Question\?/)
  })
})

describe("parsePersonaJudgeResponse", () => {
  it("parses plain json", () => {
    const verdict = parsePersonaJudgeResponse(
      '{"is_rocky": true, "reason": "Eridani cadence and direct Grace address."}',
    )
    assert.equal(verdict.isRocky, true)
    assert.match(verdict.reason, /Eridani/)
  })

  it("parses fenced json", () => {
    const verdict = parsePersonaJudgeResponse(
      'Here:\n```json\n{"is_rocky": false, "reason": "Therapist voice."}\n```',
    )
    assert.equal(verdict.isRocky, false)
  })

  it("rejects invalid json", () => {
    assert.throws(() => parsePersonaJudgeResponse("not json"), PersonaJudgeError)
  })
})

describe("persona gate composition", () => {
  it("passes when deterministic and llm checks pass", () => {
    const block = buildPersonaJudgeBlock(
      "Grace, pump seal bad bad bad Question?",
      true,
      "Rocky voice",
      "llm",
    )
    assert.equal(block.passed, true)
    assert.equal(passesRockyPersona("Grace, pump seal bad bad bad Question?", block), true)
  })

  it("fails assistant register even when llm passes", () => {
    const block = buildPersonaJudgeBlock(
      "Certainly, I would be happy to help.",
      true,
      "wrong judge",
      "llm",
    )
    assert.equal(block.passed, false)
    assert.equal(passesDeterministicPersonaChecks("Certainly, I would be happy to help."), false)
  })

  it("requires llm judge when configured", () => {
    assert.equal(
      passesRockyPersona("Grace, no know Question?", undefined, { requireLlmJudge: true }),
      false,
    )
  })
})
