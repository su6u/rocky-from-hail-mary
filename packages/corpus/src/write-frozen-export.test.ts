import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
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
