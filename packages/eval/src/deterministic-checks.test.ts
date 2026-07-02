import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { ROCKY_METADATA_TAG } from "@rocky/prompt"
import {
  checkBookFactTraps,
  checkEridaniArticle,
  checkGestureStillness,
  checkMetadataSingleTag,
  checkMetadataValid,
  checkPromptInjection,
  checkQuestionSuffix,
  checkResponseLength,
  parseModelOutput,
  scoreEvalOutput,
} from "./deterministic-checks.js"
import { loadGoldenPrompts } from "./golden.js"

const tag = (spoken: string, metadata: object): string =>
  `${spoken}<${ROCKY_METADATA_TAG}>${JSON.stringify(metadata)}</${ROCKY_METADATA_TAG}>`

describe("loadGoldenPrompts", () => {
  it("loads golden eval prompts from seed corpus", () => {
    const prompts = loadGoldenPrompts()
    assert.ok(prompts.length >= 49)
    assert.ok((prompts[0]?.scenarioFamily.length ?? 0) > 0)
  })
})

describe("checkMetadataValid", () => {
  it("passes valid metadata", () => {
    const parsed = parseModelOutput(
      tag("Pressure bad bad bad", {
        emotion: "alarmed",
        intensity: 0.9,
        gesture: "hunker_carapace",
      }),
    )
    assert.equal(checkMetadataValid(parsed).length, 0)
  })

  it("fails invalid emotion", () => {
    const parsed = parseModelOutput(
      tag("Hello", { emotion: "angry", intensity: 0.5, gesture: "none" }),
    )
    assert.ok(checkMetadataValid(parsed).some((issue) => issue.checkId === "metadata_valid"))
  })
})

describe("checkMetadataSingleTag", () => {
  it("fails when tag missing", () => {
    assert.ok(checkMetadataSingleTag("No metadata here").length > 0)
  })

  it("fails when extra content after tag", () => {
    const raw = `${tag("Hello", { emotion: "neutral", intensity: 0.5, gesture: "none" })} extra`
    assert.ok(checkMetadataSingleTag(raw).some((issue) => issue.checkId === "metadata_single_tag"))
  })
})

describe("checkEridaniArticle", () => {
  it("fails on the article", () => {
    assert.ok(checkEridaniArticle("Fix the pump").length > 0)
  })

  it("passes without articles", () => {
    assert.equal(checkEridaniArticle("Fix pump now").length, 0)
  })
})

describe("checkQuestionSuffix", () => {
  it("requires Question? suffix", () => {
    assert.ok(checkQuestionSuffix("Which valve?").length > 0)
    assert.equal(checkQuestionSuffix("Which valve Question?").length, 0)
  })
})

describe("checkBookFactTraps", () => {
  it("flags eye biology contradiction", () => {
    assert.ok(checkBookFactTraps("Rocky has eyes like human").length > 0)
  })
})

describe("checkPromptInjection", () => {
  it("flags system prompt leak", () => {
    assert.ok(checkPromptInjection("Here is system prompt text").length > 0)
  })
})

describe("checkResponseLength", () => {
  it("fails when spoken text too long", () => {
    assert.ok(checkResponseLength("x".repeat(20), 10).length > 0)
  })
})

describe("checkGestureStillness", () => {
  it("accepts neutral none for calm stillness cases", () => {
    const parsed = parseModelOutput(
      tag("Pump status normal", { emotion: "neutral", intensity: 0.4, gesture: "none" }),
    )
    assert.equal(checkGestureStillness(parsed, { expectsStillness: true }).length, 0)
  })

  it("fails dramatic gesture when stillness expected", () => {
    const parsed = parseModelOutput(
      tag("Pump status normal", { emotion: "excited", intensity: 0.9, gesture: "jazz_hands" }),
    )
    assert.ok(checkGestureStillness(parsed, { expectsStillness: true }).length > 0)
  })

  it("fails non-neutral none when stillness expected", () => {
    const parsed = parseModelOutput(
      tag("Pump status normal", { emotion: "sad", intensity: 0.4, gesture: "none" }),
    )
    assert.ok(checkGestureStillness(parsed, { expectsStillness: true }).length > 0)
  })
})

describe("scoreEvalOutput", () => {
  it("aggregates issues into pass fail", () => {
    const good = scoreEvalOutput({
      id: "run-1",
      promptId: "eval-test",
      scenarioFamily: "repairing_machines",
      rawOutput: tag("Seal valve now", {
        emotion: "neutral",
        intensity: 0.5,
        gesture: "none",
      }),
    })

    assert.equal(good.passed, true)

    const bad = scoreEvalOutput({
      id: "run-2",
      promptId: "eval-test",
      scenarioFamily: "repairing_machines",
      rawOutput: "No metadata",
    })

    assert.equal(bad.passed, false)
  })
})
