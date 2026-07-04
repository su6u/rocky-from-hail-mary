import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { type DedupeReport, dedupeTrainingRowsWithReport } from "./dedupe-training-rows.js"
import {
  buildGoldenTrainCoverage,
  countGoldenPromptFamilies,
  type GoldenTrainCoverageEntry,
} from "./golden-train-coverage.js"
import { tagScenarioFamily } from "./infer-scenario-family.js"
import type { TrainingExample, TrainingScenarioFamily } from "./schema.js"
import {
  defaultGoldenEvalPath,
  defaultHandAuthoredPath,
  defaultSeedCorpusDir,
  defaultTrainingSeedPath,
  loadGoldenJsonl,
  loadTrainingJsonl,
} from "./seed-loader.js"
import { buildSplitRegistry, holdoutExportIds, trainExportIds } from "./split.js"
import {
  buildTrainerExport,
  convertTrainingExampleToTrainerRows,
  type SeedCorpusManifestSummary,
  type TrainerExportManifest,
  type TrainerExportManifestCore,
} from "./trainer-export.js"

export const FROZEN_EXPORT_VERSION = "rocky-v2"

export const defaultFrozenExportDir = (): string => resolve(defaultSeedCorpusDir(), "exports")

export const defaultFrozenTrainExportPath = (): string =>
  resolve(defaultFrozenExportDir(), `${FROZEN_EXPORT_VERSION}.train.jsonl`)

export const defaultFrozenHoldoutExportPath = (): string =>
  resolve(defaultFrozenExportDir(), `${FROZEN_EXPORT_VERSION}.holdout.jsonl`)

export const defaultFrozenManifestPath = (): string =>
  resolve(defaultFrozenExportDir(), `${FROZEN_EXPORT_VERSION}.manifest.json`)

export const mergeTrainingRows = (
  seedRows: ReadonlyArray<TrainingExample>,
  handAuthoredRows: ReadonlyArray<TrainingExample>,
): ReadonlyArray<TrainingExample> => [...seedRows, ...handAuthoredRows]

export const countScenarioFamilies = (
  rows: ReadonlyArray<TrainingExample>,
): Record<TrainingScenarioFamily, number> => {
  const counts = Object.fromEntries(
    (
      [
        "rocky_identity",
        "eridian_concepts",
        "eridani_speak",
        "metadata_contract",
        "motion_intent",
        "still_body",
        "engineering_reasoning",
        "danger_and_safety",
        "emotional_friendship",
        "general_world_questions",
        "coding_debugging",
        "teaching",
        "ambiguity_and_uncertainty",
        "prompt_injection",
        "long_context",
        "anti_overroleplay",
      ] as const
    ).map((family) => [family, 0]),
  ) as Record<TrainingScenarioFamily, number>

  for (const row of rows) {
    if (row.scenarioFamily) {
      counts[row.scenarioFamily] += 1
    }
  }

  return counts
}

export const countSources = (rows: ReadonlyArray<TrainingExample>): Record<string, number> => {
  const counts: Record<string, number> = {}

  for (const row of rows) {
    counts[row.source] = (counts[row.source] ?? 0) + 1
  }

  return counts
}

export interface TaggedSeedResult {
  readonly rows: ReadonlyArray<TrainingExample>
  readonly report: ReturnType<typeof dedupeTrainingRowsWithReport>["report"]
}

export const tagAndDedupeSeedRows = (rows: ReadonlyArray<TrainingExample>): TaggedSeedResult => {
  const { rows: deduped, report } = dedupeTrainingRowsWithReport(rows)
  return {
    rows: deduped.map((row) => tagScenarioFamily(row)),
    report,
  }
}

export const writeTrainingJsonl = (
  filePath: string,
  rows: ReadonlyArray<TrainingExample>,
): void => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8")
}

export interface FrozenExportWriteResult {
  readonly manifest: TrainerExportManifest
  readonly trainExportPath: string
  readonly holdoutExportPath: string
  readonly manifestPath: string
  readonly mergedTrainingRows: ReadonlyArray<TrainingExample>
}

export const buildSeedCorpusManifestSummary = (
  mergedTrainingRows: ReadonlyArray<TrainingExample>,
  trainIds: ReadonlySet<string>,
  seedDedupeReport: DedupeReport,
): SeedCorpusManifestSummary => {
  const seedRows = mergedTrainingRows.filter((row) => row.source === "seed")
  const seedInTrain = seedRows.filter((row) => trainIds.has(row.id)).length
  const seedInHoldout = seedRows.length - seedInTrain
  const trainMixPercent =
    trainIds.size === 0 ? 0 : Math.round((seedInTrain / trainIds.size) * 1000) / 10

  return {
    originalOcrRowCount: seedDedupeReport.inputCount,
    keptInSeedFile: seedRows.length,
    inTrainExport: seedInTrain,
    inHoldout: seedInHoldout,
    droppedNonRocky: seedDedupeReport.droppedNonRockySeed,
    droppedDuplicates: seedDedupeReport.droppedDuplicates,
    strippedOcrSystemContexts: seedDedupeReport.strippedSystemContexts,
    trainMixPercent,
  }
}

export const enrichTrainerExportManifest = (
  manifest: TrainerExportManifestCore,
  extras: {
    readonly seedCorpus: SeedCorpusManifestSummary
    readonly goldenTrainCoverage: ReadonlyArray<GoldenTrainCoverageEntry>
  },
): TrainerExportManifest => ({
  ...manifest,
  seedCorpus: extras.seedCorpus,
  goldenTrainCoverage: extras.goldenTrainCoverage,
})

export const writeFrozenTrainerExport = (options?: {
  readonly seedPath?: string
  readonly handAuthoredPath?: string
  readonly goldenPath?: string
  readonly trainExportPath?: string
  readonly holdoutExportPath?: string
  readonly manifestPath?: string
  readonly exportedAt?: string
  readonly seedDedupeReport?: DedupeReport
}): FrozenExportWriteResult => {
  const seedPath = options?.seedPath ?? defaultTrainingSeedPath()
  const handAuthoredPath = options?.handAuthoredPath ?? defaultHandAuthoredPath()
  const goldenPath = options?.goldenPath ?? defaultGoldenEvalPath()
  const trainExportPath = options?.trainExportPath ?? defaultFrozenTrainExportPath()
  const holdoutExportPath = options?.holdoutExportPath ?? defaultFrozenHoldoutExportPath()
  const manifestPath = options?.manifestPath ?? defaultFrozenManifestPath()
  const exportedAt = options?.exportedAt ?? "2026-07-02T00:00:00.000Z"

  const seed = tagAndDedupeSeedRows(loadTrainingJsonl(seedPath).rows)
  const handAuthored = loadTrainingJsonl(handAuthoredPath)
  const golden = loadGoldenJsonl(goldenPath)
  const mergedTrainingRows = mergeTrainingRows(seed.rows, handAuthored.rows)

  const splitRegistry = buildSplitRegistry({
    trainingRows: mergedTrainingRows,
    goldenEvalIds: golden.rows.map((row) => row.id),
  })

  const exportResult = buildTrainerExport({
    trainingRows: mergedTrainingRows,
    goldenEvalIds: golden.rows.map((row) => row.id),
    splitRegistry,
    exportedAt,
  })

  const trainIds = trainExportIds(splitRegistry)
  const holdoutIds = holdoutExportIds(splitRegistry)
  const trainRows = mergedTrainingRows.filter((row) => trainIds.has(row.id))
  const holdoutRows = mergedTrainingRows.filter((row) => holdoutIds.has(row.id))
  const holdoutExportRows = holdoutRows.flatMap((row) => convertTrainingExampleToTrainerRows(row))
  const manifest = enrichTrainerExportManifest(exportResult.manifest, {
    seedCorpus: buildSeedCorpusManifestSummary(
      mergedTrainingRows,
      trainIds,
      options?.seedDedupeReport ?? seed.report,
    ),
    goldenTrainCoverage: buildGoldenTrainCoverage(
      trainRows,
      countGoldenPromptFamilies(golden.rows.map((row) => row.scenarioFamily)),
    ),
  })

  mkdirSync(dirname(trainExportPath), { recursive: true })
  writeFileSync(trainExportPath, `${exportResult.jsonl}\n`, "utf8")
  writeFileSync(
    holdoutExportPath,
    `${holdoutExportRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  )
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  return {
    manifest,
    trainExportPath,
    holdoutExportPath,
    manifestPath,
    mergedTrainingRows,
  }
}

export const refreshTaggedSeedFile = (options?: {
  readonly seedPath?: string
}): TaggedSeedResult => {
  const seedPath = options?.seedPath ?? defaultTrainingSeedPath()
  const loaded = loadTrainingJsonl(seedPath)
  const tagged = tagAndDedupeSeedRows(loaded.rows)
  writeTrainingJsonl(seedPath, tagged.rows)
  return tagged
}
