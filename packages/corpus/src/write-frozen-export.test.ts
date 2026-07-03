import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"

import {
  defaultGoldenEvalPath,
  defaultHandAuthoredPath,
  defaultTrainingSeedPath,
  loadTrainingCorpus,
  loadTrainingJsonl,
} from "./seed-loader.js"
import { writeFrozenTrainerExport } from "./write-frozen-export.js"

describe("writeFrozenTrainerExport", () => {
  it("writes train export and manifest with scenario family counts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rocky-export-"))
    const trainExportPath = join(tempDir, "rocky-v1.train.jsonl")
    const holdoutExportPath = join(tempDir, "rocky-v1.holdout.jsonl")
    const manifestPath = join(tempDir, "rocky-v1.manifest.json")

    try {
      const result = writeFrozenTrainerExport({
        seedPath: defaultTrainingSeedPath(),
        handAuthoredPath: defaultHandAuthoredPath(),
        goldenPath: defaultGoldenEvalPath(),
        trainExportPath,
        holdoutExportPath,
        manifestPath,
        exportedAt: "2026-07-02T00:00:00.000Z",
      })

      assert.ok(result.manifest.rowCount >= 400)
      assert.ok(result.manifest.scenarioFamilyCounts.length > 0)
      assert.ok(result.manifest.seedCorpus.keptInSeedFile > 0)
      assert.ok(result.manifest.goldenTrainCoverage.length > 0)
      assert.ok(result.manifest.goldenTrainCoverage.every((entry) => entry.meetsMinimum))
      assert.ok(readFileSync(trainExportPath, "utf8").includes("rocky_metadata"))
      assert.ok(readFileSync(trainExportPath, "utf8").includes('"id"'))
      assert.ok(readFileSync(holdoutExportPath, "utf8").includes("rocky_metadata"))
      assert.ok(readFileSync(holdoutExportPath, "utf8").includes('"id"'))
      assert.ok(readFileSync(manifestPath, "utf8").includes("goldenTrainCoverage"))
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("builds seed manifest stats from the live dedupe report", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rocky-export-"))
    const seedPath = join(tempDir, "seed.jsonl")
    const trainExportPath = join(tempDir, "rocky-v1.train.jsonl")
    const holdoutExportPath = join(tempDir, "rocky-v1.holdout.jsonl")
    const manifestPath = join(tempDir, "rocky-v1.manifest.json")

    const seedRows = [
      {
        id: "seed-good",
        source: "seed",
        messages: [
          { role: "user", content: "Grace ask status" },
          {
            role: "assistant",
            content: "Good good friend Grace",
            metadata: { emotion: "happy", intensity: 0.6, gesture: "none" },
          },
        ],
      },
      {
        id: "seed-dupe",
        source: "seed",
        messages: [
          { role: "user", content: "Grace ask again" },
          {
            role: "assistant",
            content: "Good good friend Grace",
            metadata: { emotion: "happy", intensity: 0.6, gesture: "none" },
          },
        ],
      },
      {
        id: "seed-non-rocky",
        source: "seed",
        messages: [
          { role: "user", content: "Who answer?" },
          {
            role: "assistant",
            content: "Call me Bob,",
            metadata: { emotion: "neutral", intensity: 0.5, gesture: "none" },
          },
        ],
      },
    ]

    try {
      writeFileSync(seedPath, `${seedRows.map((row) => JSON.stringify(row)).join("\n")}\n`)

      const result = writeFrozenTrainerExport({
        seedPath,
        handAuthoredPath: defaultHandAuthoredPath(),
        goldenPath: defaultGoldenEvalPath(),
        trainExportPath,
        holdoutExportPath,
        manifestPath,
        exportedAt: "2026-07-02T00:00:00.000Z",
      })

      assert.equal(result.manifest.seedCorpus.originalOcrRowCount, 3)
      assert.equal(result.manifest.seedCorpus.keptInSeedFile, 1)
      assert.equal(result.manifest.seedCorpus.droppedNonRocky, 1)
      assert.equal(result.manifest.seedCorpus.droppedDuplicates, 1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("loadTrainingCorpus", () => {
  it("merges seed and hand-authored rows", () => {
    const seed = loadTrainingJsonl(defaultTrainingSeedPath())
    const corpus = loadTrainingCorpus()

    assert.ok(corpus.rows.length > seed.rows.length)
    assert.ok(corpus.rows.some((row) => row.source === "hand-authored"))
    assert.ok(corpus.rows.every((row) => row.scenarioFamily !== undefined))
  })
})
