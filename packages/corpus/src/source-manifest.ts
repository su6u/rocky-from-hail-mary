import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import type { ValidationIssue, ValidationResult } from "./schema.js"

export const SourcePipelineUses = [
  "scene_extraction",
  "provenance_reference",
  "review_queue",
  "trainer_export",
] as const

export type SourcePipelineUse = (typeof SourcePipelineUses)[number]

export interface SourceManifest {
  readonly sourceId: string
  readonly title: string
  readonly filePath: string
  readonly localOnly: boolean
  readonly sourceNotes?: string
  readonly allowedPipelineUse: ReadonlyArray<SourcePipelineUse>
}

export interface SourceManifestSummary {
  readonly manifestPath: string
  readonly manifest: SourceManifest
  readonly sourceFileExists: boolean
  readonly sourceFileBytes?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0

export const isSourcePipelineUse = (value: string): value is SourcePipelineUse =>
  (SourcePipelineUses as readonly string[]).includes(value)

export const isUnderRawPath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "")
  return normalized === "raw" || normalized.startsWith("raw/")
}

export const defaultSourceManifestsDir = (): string =>
  resolve(import.meta.dirname, "../../../research/seed-corpus/source/manifests")

export const defaultProjectHailMaryOcrManifestPath = (): string =>
  resolve(defaultSourceManifestsDir(), "project-hail-mary-ocr.json")

export const resolveRepoPath = (repoRoot: string, filePath: string): string =>
  resolve(repoRoot, filePath)

export const validateSourceManifest = (
  raw: unknown,
  line = 0,
): { issues: ValidationIssue[]; value?: SourceManifest } => {
  if (!isRecord(raw)) {
    return { issues: [{ line, path: "$", message: "manifest must be an object" }] }
  }

  const issues: ValidationIssue[] = []

  if (!isNonEmptyString(raw.sourceId)) {
    issues.push({ line, path: "sourceId", message: "sourceId must be a non-empty string" })
  }

  if (!isNonEmptyString(raw.title)) {
    issues.push({ line, path: "title", message: "title must be a non-empty string" })
  }

  if (!isNonEmptyString(raw.filePath)) {
    issues.push({ line, path: "filePath", message: "filePath must be a non-empty string" })
  }

  if (typeof raw.localOnly !== "boolean") {
    issues.push({ line, path: "localOnly", message: "localOnly must be a boolean" })
  }

  if (raw.sourceNotes !== undefined && !isNonEmptyString(raw.sourceNotes)) {
    issues.push({
      line,
      path: "sourceNotes",
      message: "sourceNotes must be a non-empty string",
    })
  }

  let allowedPipelineUse: SourcePipelineUse[] = []
  if (!Array.isArray(raw.allowedPipelineUse) || raw.allowedPipelineUse.length === 0) {
    issues.push({
      line,
      path: "allowedPipelineUse",
      message: "allowedPipelineUse must be a non-empty string array",
    })
  } else {
    let pipelineUsesValid = true
    raw.allowedPipelineUse.forEach((use, index) => {
      if (!isNonEmptyString(use) || !isSourcePipelineUse(use)) {
        pipelineUsesValid = false
        issues.push({
          line,
          path: `allowedPipelineUse[${index}]`,
          message: `allowedPipelineUse entries must be one of: ${SourcePipelineUses.join(", ")}`,
        })
      }
    })
    if (pipelineUsesValid) {
      allowedPipelineUse = raw.allowedPipelineUse as SourcePipelineUse[]
    }
  }

  if (isNonEmptyString(raw.filePath) && isUnderRawPath(raw.filePath) && raw.localOnly !== true) {
    issues.push({
      line,
      path: "localOnly",
      message: "files under raw/ must set localOnly to true",
    })
  }

  if (
    isNonEmptyString(raw.filePath) &&
    isUnderRawPath(raw.filePath) &&
    Array.isArray(raw.allowedPipelineUse) &&
    (raw.allowedPipelineUse as string[]).includes("trainer_export")
  ) {
    issues.push({
      line,
      path: "allowedPipelineUse",
      message: "raw source material cannot allow trainer_export",
    })
  }

  if (issues.length > 0) {
    return { issues }
  }

  if (
    !isNonEmptyString(raw.sourceId) ||
    !isNonEmptyString(raw.title) ||
    !isNonEmptyString(raw.filePath) ||
    typeof raw.localOnly !== "boolean"
  ) {
    return { issues: [{ line, path: "$", message: "manifest is missing required fields" }] }
  }

  const manifest: SourceManifest = {
    sourceId: raw.sourceId,
    title: raw.title,
    filePath: raw.filePath,
    localOnly: raw.localOnly,
    allowedPipelineUse,
    ...(isNonEmptyString(raw.sourceNotes) ? { sourceNotes: raw.sourceNotes } : {}),
  }

  return { issues: [], value: manifest }
}

export const loadSourceManifest = (manifestPath: string): SourceManifest => {
  const content = readFileSync(manifestPath, "utf8")
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new SourceManifestError(manifestPath, [{ line: 0, path: "$", message: "invalid JSON" }])
  }

  const result = validateSourceManifest(parsed)
  if (result.issues.length > 0) {
    throw new SourceManifestError(manifestPath, result.issues)
  }

  if (!result.value) {
    throw new SourceManifestError(manifestPath, [
      { line: 0, path: "$", message: "manifest is invalid" },
    ])
  }

  return result.value
}

export const summarizeSourceManifest = (
  manifestPath: string,
  repoRoot: string,
): SourceManifestSummary => {
  const manifest = loadSourceManifest(manifestPath)
  const absoluteSourcePath = resolveRepoPath(repoRoot, manifest.filePath)

  try {
    const stats = statSync(absoluteSourcePath)
    if (stats.isFile()) {
      return {
        manifestPath,
        manifest,
        sourceFileExists: true,
        sourceFileBytes: stats.size,
      }
    }

    return {
      manifestPath,
      manifest,
      sourceFileExists: false,
    }
  } catch {
    return {
      manifestPath,
      manifest,
      sourceFileExists: false,
    }
  }
}

export const listSourceManifests = (
  manifestsDir = defaultSourceManifestsDir(),
): ReadonlyArray<string> =>
  readdirSync(manifestsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(manifestsDir, name))
    .sort()

export const loadAllSourceManifests = (
  manifestsDir = defaultSourceManifestsDir(),
): ReadonlyArray<SourceManifest> => listSourceManifests(manifestsDir).map(loadSourceManifest)

export const validateSourceManifestFile = (manifestPath: string): ValidationResult => {
  const content = readFileSync(manifestPath, "utf8")
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    return {
      filePath: manifestPath,
      rowCount: 1,
      issues: [{ line: 0, path: "$", message: "invalid JSON" }],
    }
  }

  const result = validateSourceManifest(parsed)
  return {
    filePath: manifestPath,
    rowCount: 1,
    issues: result.issues,
  }
}

export class SourceManifestError extends Error {
  readonly manifestPath: string
  readonly issues: ReadonlyArray<ValidationIssue>

  constructor(manifestPath: string, issues: ReadonlyArray<ValidationIssue>) {
    super(
      issues
        .map((issue) => `${manifestPath}:${issue.line}: ${issue.path}: ${issue.message}`)
        .join("\n"),
    )
    this.name = "SourceManifestError"
    this.manifestPath = manifestPath
    this.issues = issues
  }
}

export const formatManifestBasename = (manifestPath: string): string => basename(manifestPath)
