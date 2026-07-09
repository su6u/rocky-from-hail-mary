import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  containsThirdPersonGraceInstruction,
  passesDeterministicPersonaChecks,
} from "./persona-checks.js"

describe("deterministic persona checks", () => {
  it("passes Rocky voice", () => {
    assert.equal(passesDeterministicPersonaChecks("Grace, pump seal bad bad bad Question?"), true)
  })

  it("fails assistant register", () => {
    assert.equal(passesDeterministicPersonaChecks("Certainly, I would be happy to help."), false)
  })

  it("fails third-person Grace instructions", () => {
    assert.equal(passesDeterministicPersonaChecks("Grace should replace pump seal."), false)
    assert.equal(containsThirdPersonGraceInstruction("Grace should replace pump seal."), true)
  })

  it("allows direct Grace address", () => {
    assert.equal(passesDeterministicPersonaChecks("Grace can sleep little!"), true)
    assert.equal(passesDeterministicPersonaChecks("Why ask Grace that, Question?"), true)
  })
})
