import assert from "node:assert/strict"
import { resolve } from "node:path"
import { describe, it } from "node:test"

import {
  assertTrainerExportSafe,
  isTrainerExportEligible,
  partitionTrainerExportSources,
  TrainerExportGuardError,
} from "./ocr-source.js"
import {
  defaultProjectHailMaryOcrManifestPath,
  defaultSourceManifestsDir,
  isUnderRawPath,
  listSourceManifests,
  loadAllSourceManifests,
  loadSourceManifest,
  summarizeSourceManifest,
  validateSourceManifest,
  validateSourceManifestFile,
} from "./source-manifest.js"

const repoRoot = resolve(import.meta.dirname, "../../..")

describe("isUnderRawPath", () => {
  it("detects raw/ paths", () => {
    assert.equal(isUnderRawPath("raw/data/phm.txt"), true)
    assert.equal(isUnderRawPath("./raw/data/phm.txt"), true)
    assert.equal(isUnderRawPath("../raw/data/phm.txt"), true)
    assert.equal(isUnderRawPath("research/seed-corpus/project-hail-mary.seed.jsonl"), false)
  })

  it("rejects trainer_export for relative raw bypass paths", () => {
    const result = validateSourceManifest({
      sourceId: "bad-raw",
      title: "Bad raw source",
      filePath: "../raw/data/phm.txt",
      localOnly: false,
      allowedPipelineUse: ["trainer_export"],
    })

    assert.ok(result.issues.some((issue) => issue.path === "localOnly"))
    assert.ok(result.issues.some((issue) => issue.path === "allowedPipelineUse"))
  })
})

describe("validateSourceManifest", () => {
  it("accepts the project hail mary OCR manifest shape", () => {
    const result = validateSourceManifest({
      sourceId: "project-hail-mary-ocr",
      title: "Project Hail Mary (OCR text)",
      filePath: "raw/data/phm.txt",
      localOnly: true,
      sourceNotes: "OCR source only",
      allowedPipelineUse: ["scene_extraction", "provenance_reference", "review_queue"],
    })

    assert.equal(result.issues.length, 0)
    assert.equal(result.value?.sourceId, "project-hail-mary-ocr")
  })

  it("requires localOnly for raw paths", () => {
    const result = validateSourceManifest({
      sourceId: "bad-raw",
      title: "Bad raw source",
      filePath: "raw/data/phm.txt",
      localOnly: false,
      allowedPipelineUse: ["scene_extraction"],
    })

    assert.ok(result.issues.some((issue) => issue.path === "localOnly"))
  })

  it("rejects trainer_export on raw source material", () => {
    const result = validateSourceManifest({
      sourceId: "bad-raw",
      title: "Bad raw source",
      filePath: "raw/data/phm.txt",
      localOnly: true,
      allowedPipelineUse: ["trainer_export"],
    })

    assert.ok(result.issues.some((issue) => issue.path === "allowedPipelineUse"))
  })
})

describe("listSourceManifests", () => {
  it("lists committed manifest files without reading OCR source text", () => {
    const manifests = listSourceManifests()
    assert.ok(manifests.some((path) => path.endsWith("project-hail-mary-ocr.json")))
    assert.equal(manifests.length, loadAllSourceManifests().length)
  })

  it("validates checked-in manifest files", () => {
    for (const manifestPath of listSourceManifests(defaultSourceManifestsDir())) {
      const result = validateSourceManifestFile(manifestPath)
      assert.equal(result.issues.length, 0, manifestPath)
    }
  })
})

describe("summarizeSourceManifest", () => {
  it("stats OCR source without loading file contents", () => {
    const summary = summarizeSourceManifest(defaultProjectHailMaryOcrManifestPath(), repoRoot)

    assert.equal(summary.manifest.sourceId, "project-hail-mary-ocr")
    assert.equal(summary.manifest.filePath, "raw/data/phm.txt")
    assert.equal(summary.sourceFileExists, true)
    assert.ok((summary.sourceFileBytes ?? 0) > 0)
  })
})

describe("trainer export guardrails", () => {
  it("rejects local OCR manifest from trainer export", () => {
    const manifest = loadSourceManifest(defaultProjectHailMaryOcrManifestPath())

    assert.equal(isTrainerExportEligible(manifest), false)

    const partitioned = partitionTrainerExportSources([manifest])
    assert.equal(partitioned.eligible.length, 0)
    assert.equal(partitioned.rejected.length, 1)
    assert.match(partitioned.rejected[0]?.reason ?? "", /localOnly/)
  })

  it("throws when asserting trainer export on OCR source", () => {
    const manifest = loadSourceManifest(defaultProjectHailMaryOcrManifestPath())

    assert.throws(() => assertTrainerExportSafe(manifest), TrainerExportGuardError)
  })

  it("allows trainer export only for explicit non-raw manifests", () => {
    const eligible = validateSourceManifest({
      sourceId: "curated-seed",
      title: "Curated seed JSONL",
      filePath: "research/seed-corpus/project-hail-mary.seed.jsonl",
      localOnly: false,
      allowedPipelineUse: ["trainer_export", "provenance_reference"],
    }).value

    assert.ok(eligible)
    assert.equal(isTrainerExportEligible(eligible), true)
  })
})
