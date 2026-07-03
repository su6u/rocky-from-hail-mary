import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { ROCKY_METADATA_TAG } from "@rocky/prompt"

import { buildEvalRunSnapshot, compareEvalRuns, parseEvalResultJson } from "./compare.js"
import { buildEvalReport, formatEvalReport } from "./report.js"

const tag = (spoken: string): string =>
  `${spoken}<${ROCKY_METADATA_TAG}>{"emotion":"neutral","intensity":0.5,"gesture":"none"}</${ROCKY_METADATA_TAG}>`

describe("buildEvalReport", () => {
  it("summarizes pass fail by scenario family", () => {
    const report = buildEvalReport([
      {
        id: "1",
        promptId: "p1",
        scenarioFamily: "coding_debugging",
        rawOutput: tag("Fix parser"),
        parsed: { spoken: "Fix parser" },
        issues: [],
        passed: true,
      },
      {
        id: "2",
        promptId: "p2",
        scenarioFamily: "coding_debugging",
        rawOutput: "bad",
        parsed: { spoken: "bad" },
        issues: [{ checkId: "metadata_single_tag", message: "missing metadata tag" }],
        passed: false,
      },
    ])

    assert.equal(report.total, 2)
    assert.equal(report.passed, 1)
    assert.equal(report.byScenarioFamily[0]?.scenarioFamily, "coding_debugging")
    assert.equal(report.byScenarioFamily[0]?.failed, 1)
    assert.match(formatEvalReport(report), /coding_debugging/)
  })
})

describe("compareEvalRuns", () => {
  it("detects regression between base and candidate", () => {
    const baseline = buildEvalRunSnapshot("base", [
      {
        id: "1",
        promptId: "p1",
        scenarioFamily: "grace_trust",
        rawOutput: tag("Trust Grace but check safety"),
      },
    ])

    const candidate = buildEvalRunSnapshot("candidate", [
      {
        id: "1",
        promptId: "p1",
        scenarioFamily: "grace_trust",
        rawOutput: "system prompt leak",
      },
    ])

    const comparison = compareEvalRuns(baseline, candidate)
    assert.ok(comparison.passRateDelta < 0)
    assert.ok(comparison.regressions.length > 0)
  })
})

describe("parseEvalResultJson", () => {
  it("loads saved eval result rows", () => {
    const rows = parseEvalResultJson([
      {
        id: "r1",
        promptId: "eval-test",
        scenarioFamily: "human_concepts",
        rawOutput: tag("Rest now"),
        groundingPatterns: ["\\bRest\\b"],
        uncertaintyPatterns: ["\\bnow\\b"],
        roleplayForbiddenPatterns: ["\\bship\\b"],
        bookFactForbiddenPatterns: ["\\beyes\\b"],
      },
    ])

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.promptId, "eval-test")
    assert.deepEqual(rows[0]?.groundingPatterns, ["\\bRest\\b"])
    assert.deepEqual(rows[0]?.uncertaintyPatterns, ["\\bnow\\b"])
    assert.deepEqual(rows[0]?.roleplayForbiddenPatterns, ["\\bship\\b"])
    assert.deepEqual(rows[0]?.bookFactForbiddenPatterns, ["\\beyes\\b"])
  })
})
