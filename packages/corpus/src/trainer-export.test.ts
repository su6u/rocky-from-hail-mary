import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SYSTEM_PROMPT } from "@rocky/prompt"

import {
  defaultGoldenEvalPath,
  defaultTrainingSeedPath,
  loadGoldenJsonl,
  loadTrainingJsonl,
} from "./seed-loader.js"
import { defaultProjectHailMaryOcrManifestPath, loadSourceManifest } from "./source-manifest.js"
import { buildSplitRegistry } from "./split.js"
import {
  buildTrainerExport,
  convertTrainingExampleToTrainerRows,
  countMetadataTags,
  decodeAssistantLabel,
  extractMetadataTag,
  formatAssistantTrainerContent,
  promptHash,
} from "./trainer-export.js"

describe("formatAssistantTrainerContent", () => {
  it("appends exactly one metadata tag", () => {
    const content = formatAssistantTrainerContent("Pressure bad bad bad", {
      emotion: "alarmed",
      intensity: 0.9,
      gesture: "hunker_carapace",
    })

    assert.equal(countMetadataTags(content), 1)
    assert.match(extractMetadataTag(content) ?? "", /hunker_carapace/)
  })
})

describe("convertTrainingExampleToTrainerRows", () => {
  it("uses canonical system prompt and only the final assistant turn", () => {
    const rows = convertTrainingExampleToTrainerRows({
      id: "example-1",
      source: "seed",
      messages: [
        { role: "system", content: "Scene note from book" },
        { role: "user", content: "First user line" },
        {
          role: "assistant",
          content: "Intermediate reply",
          metadata: { emotion: "neutral", intensity: 0.5, gesture: "none" },
        },
        { role: "user", content: "Second user line" },
        {
          role: "assistant",
          content: "Final reply",
          metadata: { emotion: "curious", intensity: 0.6, gesture: "cock_carapace" },
        },
      ],
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.messages[0]?.content, SYSTEM_PROMPT)
    assert.match(rows[0]?.messages[1]?.content ?? "", /Scene note from book/)
    assert.match(rows[0]?.messages[1]?.content ?? "", /Second user line/)
    assert.match(rows[0]?.messages[2]?.content ?? "", /Final reply/)
    assert.doesNotMatch(rows[0]?.messages[2]?.content ?? "", /Intermediate reply/)
  })
})

describe("buildTrainerExport", () => {
  it("exports train split rows with manifest metadata", () => {
    const training = loadTrainingJsonl(defaultTrainingSeedPath())
    const golden = loadGoldenJsonl(defaultGoldenEvalPath())
    const registry = buildSplitRegistry({
      trainingRows: training.rows,
      goldenEvalIds: golden.rows.map((row) => row.id),
      seed: 42,
    })

    const result = buildTrainerExport({
      trainingRows: training.rows,
      goldenEvalIds: golden.rows.map((row) => row.id),
      splitRegistry: registry,
      exportedAt: "2026-01-01T00:00:00.000Z",
    })

    assert.ok(result.rows.length > 0)
    assert.equal(result.manifest.promptHash, promptHash())
    assert.equal(result.manifest.domainVersion, "0.0.0")
    assert.ok(result.manifest.sourceIds.includes("seed"))
    assert.equal(result.manifest.rowCount, result.rows.length)
    assert.ok(result.manifest.neutralNoneCount > 0)

    const firstAssistant = result.rows[0]?.messages.find((message) => message.role === "assistant")
    assert.ok(firstAssistant)

    const decoded = decodeAssistantLabel(firstAssistant.content)
    assert.ok(decoded)
    assert.ok(decoded.spoken.length > 0)
    assert.doesNotThrow(() => JSON.parse(decoded.metadataJson))
  })

  it("rejects incomplete custom split registries", () => {
    const training = loadTrainingJsonl(defaultTrainingSeedPath())
    const golden = loadGoldenJsonl(defaultGoldenEvalPath())
    const registry = buildSplitRegistry({
      trainingRows: training.rows.slice(0, 2),
      goldenEvalIds: [],
    })

    assert.throws(() =>
      buildTrainerExport({
        trainingRows: training.rows.slice(0, 5),
        goldenEvalIds: golden.rows.map((row) => row.id),
        splitRegistry: registry,
        exportedAt: "2026-01-01T00:00:00.000Z",
      }),
    )
  })

  it("rejects OCR source manifests from export", () => {
    const training = loadTrainingJsonl(defaultTrainingSeedPath())
    const golden = loadGoldenJsonl(defaultGoldenEvalPath())
    const ocrManifest = loadSourceManifest(defaultProjectHailMaryOcrManifestPath())

    assert.throws(() =>
      buildTrainerExport({
        trainingRows: training.rows.slice(0, 3),
        goldenEvalIds: golden.rows.map((row) => row.id),
        sourceManifests: [ocrManifest],
        exportedAt: "2026-01-01T00:00:00.000Z",
      }),
    )
  })
})
