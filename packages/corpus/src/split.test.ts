import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  defaultGoldenEvalPath,
  defaultTrainingSeedPath,
  loadGoldenJsonl,
  loadTrainingJsonl,
} from "./seed-loader.js"
import {
  assertGoldenEvalNotInTrainExport,
  assertSplitRegistry,
  assignTrainingSplit,
  buildSplitRegistry,
  buildSplitReport,
  DEFAULT_SPLIT_SEED,
  findSplitLeakage,
  formatSplitReport,
  hashSplitBucket,
} from "./split.js"

describe("assignTrainingSplit", () => {
  it("is deterministic for the same id and seed", () => {
    const first = assignTrainingSplit("seed-project-hail-mary-0001", DEFAULT_SPLIT_SEED, 0.1)
    const second = assignTrainingSplit("seed-project-hail-mary-0001", DEFAULT_SPLIT_SEED, 0.1)

    assert.equal(first, second)
  })

  it("changes when seed changes", () => {
    const buckets = new Set<string>()

    for (let seed = 0; seed < 20; seed += 1) {
      buckets.add(assignTrainingSplit("seed-project-hail-mary-0042", seed, 0.5))
    }

    assert.ok(buckets.size > 1)
  })
})

describe("buildSplitRegistry", () => {
  it("keeps golden eval ids out of train export", () => {
    const training = loadTrainingJsonl(defaultTrainingSeedPath())
    const golden = loadGoldenJsonl(defaultGoldenEvalPath())
    const registry = buildSplitRegistry({
      trainingRows: training.rows,
      goldenEvalIds: golden.rows.map((row) => row.id),
    })

    assertSplitRegistry(registry)
    assertGoldenEvalNotInTrainExport(
      registry,
      golden.rows.map((row) => row.id),
    )

    const evalIds = registry.entries
      .filter((entry) => entry.split === "eval")
      .map((entry) => entry.id)
    assert.ok(evalIds.length >= golden.rows.length)
  })

  it("detects duplicate split assignments", () => {
    const registry = buildSplitRegistry({
      trainingRows: [
        {
          id: "row-a",
          source: "seed",
          messages: [
            {
              role: "assistant",
              content: "Hello",
              metadata: { emotion: "neutral", intensity: 0.5, gesture: "none" },
            },
          ],
        },
      ],
      goldenEvalIds: [],
    })

    const broken = {
      ...registry,
      entries: [...registry.entries, { id: "row-a", split: "holdout" as const }],
    }

    const issues = findSplitLeakage(broken)
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.id, "row-a")
  })

  it("prints row counts by source and split", () => {
    const training = loadTrainingJsonl(defaultTrainingSeedPath())
    const registry = buildSplitRegistry({
      trainingRows: training.rows.slice(0, 20),
      goldenEvalIds: [],
      seed: 7,
      holdoutFraction: 0.25,
    })

    const report = formatSplitReport(buildSplitReport(registry, training.rows.slice(0, 20)))
    assert.match(report, /^split\tsource\tscenarioFamily\tcount/m)
    assert.match(report, /train/)
  })
})

describe("hashSplitBucket", () => {
  it("returns a stable fraction", () => {
    const first = hashSplitBucket("seed-project-hail-mary-0100", 42)
    const second = hashSplitBucket("seed-project-hail-mary-0100", 42)

    assert.equal(first, second)
    assert.ok(first >= 0 && first < 1)
  })
})
