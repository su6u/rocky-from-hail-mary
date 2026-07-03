import { createHash } from "node:crypto"

import { ROCKY_METADATA_TAG, SYSTEM_PROMPT } from "@rocky/prompt"
import type { GoldenTrainCoverageEntry } from "./golden-train-coverage.js"
import { isTrainerExportEligible } from "./ocr-source.js"
import type { CorpusMessage, TrainingExample } from "./schema.js"
import type { SourceManifest } from "./source-manifest.js"
import {
  assertGoldenEvalNotInTrainExport,
  assertSplitRegistry,
  assertTrainingRowsCoveredByRegistry,
  buildSplitRegistry,
  type SplitRegistry,
  trainExportIds,
} from "./split.js"

export interface TrainerExportMessage {
  readonly role: "system" | "user" | "assistant"
  readonly content: string
}

export interface TrainerExportRow {
  readonly id: string
  readonly messages: ReadonlyArray<TrainerExportMessage>
}

export interface SeedCorpusManifestSummary {
  readonly originalOcrRowCount: number
  readonly keptInSeedFile: number
  readonly inTrainExport: number
  readonly inHoldout: number
  readonly droppedNonRocky: number
  readonly droppedDuplicates: number
  readonly strippedOcrSystemContexts: number
  readonly trainMixPercent: number
}

export interface TrainerExportManifestCore {
  readonly promptHash: string
  readonly domainVersion: string
  readonly rowCount: number
  readonly trainingRowCount: number
  readonly neutralNoneCount: number
  readonly sourceIds: ReadonlyArray<string>
  readonly sourceCounts: ReadonlyArray<{ readonly source: string; readonly count: number }>
  readonly scenarioFamilyCounts: ReadonlyArray<{
    readonly scenarioFamily: string
    readonly count: number
  }>
  readonly splitSeed: number
  readonly exportedAt: string
}

export interface TrainerExportManifest extends TrainerExportManifestCore {
  readonly seedCorpus: SeedCorpusManifestSummary
  readonly goldenTrainCoverage: ReadonlyArray<GoldenTrainCoverageEntry>
}

export interface TrainerExportResult {
  readonly rows: ReadonlyArray<TrainerExportRow>
  readonly manifest: TrainerExportManifestCore
  readonly jsonl: string
}

export const DOMAIN_VERSION = "0.0.0"

const parseTaggedMetadata = (
  metadataJson: string,
): { emotion?: string; gesture?: string } | undefined => {
  try {
    return JSON.parse(metadataJson) as { emotion?: string; gesture?: string }
  } catch {
    return undefined
  }
}

export const promptHash = (): string =>
  createHash("sha256").update(SYSTEM_PROMPT, "utf8").digest("hex")

export const formatAssistantTrainerContent = (
  content: string,
  metadata: { emotion: string; intensity: number; gesture: string },
): string => `${content}<${ROCKY_METADATA_TAG}>${JSON.stringify(metadata)}</${ROCKY_METADATA_TAG}>`

export const extractMetadataTag = (content: string): string | undefined => {
  const open = `<${ROCKY_METADATA_TAG}>`
  const close = `</${ROCKY_METADATA_TAG}>`
  const start = content.indexOf(open)

  if (start === -1) {
    return undefined
  }

  const end = content.indexOf(close, start + open.length)
  if (end === -1) {
    return undefined
  }

  if (content.indexOf(open, start + open.length) !== -1) {
    return undefined
  }

  if (content.slice(end + close.length).trim().length > 0) {
    return undefined
  }

  return content.slice(start, end + close.length)
}

export const countMetadataTags = (content: string): number => {
  const open = `<${ROCKY_METADATA_TAG}>`
  let count = 0
  let index = content.indexOf(open)

  while (index !== -1) {
    count += 1
    index = content.indexOf(open, index + open.length)
  }

  return count
}

const mergeUserContent = (messages: ReadonlyArray<CorpusMessage>, endIndex: number): string[] => {
  const parts: string[] = []

  for (let index = 0; index < endIndex; index += 1) {
    const message = messages[index]
    if (!message) {
      continue
    }

    if (message.role === "system") {
      parts.push(message.content)
    } else if (message.role === "user") {
      parts.push(message.content)
    }
  }

  return parts
}

export const convertTrainingExampleToTrainerRows = (
  example: TrainingExample,
): ReadonlyArray<TrainerExportRow> => {
  const assistantIndexes = example.messages
    .map((message, index) => (message.role === "assistant" ? index : -1))
    .filter((index) => index >= 0)

  if (assistantIndexes.length === 0) {
    return []
  }

  const lastAssistantIndex = assistantIndexes.at(-1)
  if (lastAssistantIndex === undefined) {
    return []
  }

  const lastAssistant = example.messages[lastAssistantIndex]
  if (!lastAssistant || lastAssistant.role !== "assistant") {
    return []
  }

  const contextParts = mergeUserContent(example.messages, lastAssistantIndex)
  const userContent = contextParts.join("\n\n")

  const messages: TrainerExportMessage[] = [{ role: "system", content: SYSTEM_PROMPT }]

  if (userContent.length > 0) {
    messages.push({ role: "user", content: userContent })
  }

  messages.push({
    role: "assistant",
    content: formatAssistantTrainerContent(lastAssistant.content, lastAssistant.metadata),
  })

  return [
    {
      id: example.id,
      messages,
    },
  ]
}

export const buildTrainerExport = (options: {
  readonly trainingRows: ReadonlyArray<TrainingExample>
  readonly goldenEvalIds: ReadonlyArray<string>
  readonly sourceManifests?: ReadonlyArray<SourceManifest>
  readonly splitRegistry?: SplitRegistry
  readonly splitSeed?: number
  readonly exportedAt?: string
}): TrainerExportResult => {
  const splitRegistry =
    options.splitRegistry ??
    buildSplitRegistry({
      trainingRows: options.trainingRows,
      goldenEvalIds: options.goldenEvalIds,
      ...(options.splitSeed !== undefined ? { seed: options.splitSeed } : {}),
    })

  assertSplitRegistry(splitRegistry)
  assertGoldenEvalNotInTrainExport(splitRegistry, options.goldenEvalIds)
  assertTrainingRowsCoveredByRegistry(splitRegistry, options.trainingRows)

  const allowedTrainIds = trainExportIds(splitRegistry)
  const exportedTrainingRows = options.trainingRows.filter((row) => allowedTrainIds.has(row.id))
  const exportRows = exportedTrainingRows.flatMap((row) => convertTrainingExampleToTrainerRows(row))

  if (options.sourceManifests) {
    for (const manifest of options.sourceManifests) {
      if (!isTrainerExportEligible(manifest)) {
        throw new TrainerExportError(`source manifest blocked from export: ${manifest.sourceId}`)
      }
    }
  }

  for (const row of exportedTrainingRows) {
    if (!row.scenarioFamily) {
      throw new TrainerExportError(`training row ${row.id} missing scenarioFamily`)
    }
  }

  let neutralNoneCount = 0

  for (const row of exportRows) {
    const assistant = row.messages.find((message) => message.role === "assistant")
    if (!assistant) {
      continue
    }

    const tag = extractMetadataTag(assistant.content)
    if (!tag) {
      throw new TrainerExportError(`assistant row ${row.id} missing metadata tag`)
    }

    if (countMetadataTags(assistant.content) !== 1) {
      throw new TrainerExportError(`assistant row ${row.id} must include exactly one metadata tag`)
    }

    const decoded = decodeAssistantLabel(assistant.content)
    if (decoded) {
      const metadata = parseTaggedMetadata(decoded.metadataJson)
      if (metadata?.emotion === "neutral" && metadata.gesture === "none") {
        neutralNoneCount += 1
      }
    }
  }

  const sourceCountsMap = new Map<string, number>()
  const scenarioFamilyCountsMap = new Map<string, number>()

  for (const row of exportedTrainingRows) {
    sourceCountsMap.set(row.source, (sourceCountsMap.get(row.source) ?? 0) + 1)
    if (row.scenarioFamily) {
      scenarioFamilyCountsMap.set(
        row.scenarioFamily,
        (scenarioFamilyCountsMap.get(row.scenarioFamily) ?? 0) + 1,
      )
    }
  }

  const sourceIds = [...new Set(exportedTrainingRows.map((row) => row.source))].sort()
  const exportedAt = options.exportedAt ?? new Date(0).toISOString()

  const manifest: TrainerExportManifestCore = {
    promptHash: promptHash(),
    domainVersion: DOMAIN_VERSION,
    rowCount: exportRows.length,
    trainingRowCount: exportedTrainingRows.length,
    neutralNoneCount,
    sourceIds,
    sourceCounts: [...sourceCountsMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([source, count]) => ({ source, count })),
    scenarioFamilyCounts: [...scenarioFamilyCountsMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scenarioFamily, count]) => ({ scenarioFamily, count })),
    splitSeed: splitRegistry.seed,
    exportedAt,
  }

  const jsonl = exportRows.map((row) => JSON.stringify(row)).join("\n")

  return { rows: exportRows, manifest, jsonl }
}

export class TrainerExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TrainerExportError"
  }
}

export const decodeAssistantLabel = (
  content: string,
): { spoken: string; metadataJson: string } | undefined => {
  const open = `<${ROCKY_METADATA_TAG}>`
  const close = `</${ROCKY_METADATA_TAG}>`
  const start = content.indexOf(open)

  if (start === -1) {
    return undefined
  }

  const end = content.indexOf(close, start + open.length)
  if (end === -1) {
    return undefined
  }

  return {
    spoken: content.slice(0, start),
    metadataJson: content.slice(start + open.length, end),
  }
}
