import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  type GoldenEvalPrompt,
  type TrainingExample,
  type ValidationIssue,
  type ValidationResult,
  validateGoldenEvalPrompt,
  validateTrainingExample,
} from "./schema.js"

export interface ParsedJsonlLine {
  readonly line: number
  readonly value: unknown
}

export interface LoadedTrainingCorpus {
  readonly filePath: string
  readonly rows: ReadonlyArray<TrainingExample>
}

export interface LoadedGoldenCorpus {
  readonly filePath: string
  readonly rows: ReadonlyArray<GoldenEvalPrompt>
}

export const defaultSeedCorpusDir = (): string =>
  resolve(import.meta.dirname, "../../../research/seed-corpus")

export const defaultTrainingSeedPath = (): string =>
  resolve(defaultSeedCorpusDir(), "project-hail-mary.seed.jsonl")

export const defaultHandAuthoredPath = (): string =>
  resolve(defaultSeedCorpusDir(), "hand-authored.jsonl")

export const defaultGoldenEvalPath = (): string =>
  resolve(defaultSeedCorpusDir(), "evaluation-golden-v2.jsonl")

export const parseJsonl = (content: string): ParsedJsonlLine[] => {
  const lines = content.split(/\r?\n/)
  const parsed: ParsedJsonlLine[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index]?.trim() ?? ""

    if (line.length === 0) {
      continue
    }

    try {
      parsed.push({ line: lineNumber, value: JSON.parse(line) })
    } catch {
      parsed.push({ line: lineNumber, value: { __jsonParseError: true } })
    }
  }

  return parsed
}

export const loadTrainingJsonl = (filePath: string): LoadedTrainingCorpus => {
  const content = readFileSync(filePath, "utf8")
  const parsedLines = parseJsonl(content)
  const rows: TrainingExample[] = []

  for (const parsedLine of parsedLines) {
    if (
      typeof parsedLine.value === "object" &&
      parsedLine.value !== null &&
      "__jsonParseError" in parsedLine.value
    ) {
      throw new CorpusValidationError(filePath, [
        { line: parsedLine.line, path: "$", message: "invalid JSON" },
      ])
    }

    const result = validateTrainingExample(parsedLine.value, parsedLine.line)
    if (result.issues.length > 0) {
      throw new CorpusValidationError(filePath, result.issues)
    }

    if (result.value) {
      rows.push(result.value)
    }
  }

  return { filePath, rows }
}

export interface LoadedMergedTrainingCorpus {
  readonly seedPath: string
  readonly handAuthoredPath: string
  readonly rows: ReadonlyArray<TrainingExample>
}

export const loadTrainingCorpus = (options?: {
  readonly seedPath?: string
  readonly handAuthoredPath?: string
}): LoadedMergedTrainingCorpus => {
  const seedPath = options?.seedPath ?? defaultTrainingSeedPath()
  const handAuthoredPath = options?.handAuthoredPath ?? defaultHandAuthoredPath()
  const seed = loadTrainingJsonl(seedPath)
  const handAuthored = loadTrainingJsonl(handAuthoredPath)

  return {
    seedPath,
    handAuthoredPath,
    rows: [...seed.rows, ...handAuthored.rows],
  }
}

export const loadGoldenJsonl = (filePath: string): LoadedGoldenCorpus => {
  const content = readFileSync(filePath, "utf8")
  const parsedLines = parseJsonl(content)
  const rows: GoldenEvalPrompt[] = []

  for (const parsedLine of parsedLines) {
    if (
      typeof parsedLine.value === "object" &&
      parsedLine.value !== null &&
      "__jsonParseError" in parsedLine.value
    ) {
      throw new CorpusValidationError(filePath, [
        { line: parsedLine.line, path: "$", message: "invalid JSON" },
      ])
    }

    const result = validateGoldenEvalPrompt(parsedLine.value, parsedLine.line)
    if (result.issues.length > 0) {
      throw new CorpusValidationError(filePath, result.issues)
    }

    if (result.value) {
      rows.push(result.value)
    }
  }

  return { filePath, rows }
}

export class CorpusValidationError extends Error {
  readonly filePath: string
  readonly issues: ReadonlyArray<ValidationIssue>

  constructor(filePath: string, issues: ReadonlyArray<ValidationIssue>) {
    super(formatValidationIssues(filePath, issues))
    this.name = "CorpusValidationError"
    this.filePath = filePath
    this.issues = issues
  }
}

export const formatValidationIssue = (filePath: string, issue: ValidationIssue): string =>
  `${filePath}:${issue.line}: ${issue.path}: ${issue.message}`

export const formatValidationIssues = (
  filePath: string,
  issues: ReadonlyArray<ValidationIssue>,
): string => issues.map((issue) => formatValidationIssue(filePath, issue)).join("\n")

export const validateTrainingJsonlFile = (filePath: string): ValidationResult => {
  const content = readFileSync(filePath, "utf8")
  const parsedLines = parseJsonl(content)
  const issues: ValidationIssue[] = []

  for (const parsedLine of parsedLines) {
    if (
      typeof parsedLine.value === "object" &&
      parsedLine.value !== null &&
      "__jsonParseError" in parsedLine.value
    ) {
      issues.push({ line: parsedLine.line, path: "$", message: "invalid JSON" })
      continue
    }

    const result = validateTrainingExample(parsedLine.value, parsedLine.line)
    issues.push(...result.issues)
  }

  return {
    filePath,
    rowCount: parsedLines.length,
    issues,
  }
}

export const validateGoldenJsonlFile = (filePath: string): ValidationResult => {
  const content = readFileSync(filePath, "utf8")
  const parsedLines = parseJsonl(content)
  const issues: ValidationIssue[] = []

  for (const parsedLine of parsedLines) {
    if (
      typeof parsedLine.value === "object" &&
      parsedLine.value !== null &&
      "__jsonParseError" in parsedLine.value
    ) {
      issues.push({ line: parsedLine.line, path: "$", message: "invalid JSON" })
      continue
    }

    const result = validateGoldenEvalPrompt(parsedLine.value, parsedLine.line)
    issues.push(...result.issues)
  }

  return {
    filePath,
    rowCount: parsedLines.length,
    issues,
  }
}

export interface SeedCorpusValidationSummary {
  readonly results: ReadonlyArray<ValidationResult>
  readonly ok: boolean
}

export const validateSeedCorpus = (options?: {
  readonly seedPath?: string
  readonly handAuthoredPath?: string
  readonly goldenPath?: string
}): SeedCorpusValidationSummary => {
  const seedPath = options?.seedPath ?? defaultTrainingSeedPath()
  const handAuthoredPath = options?.handAuthoredPath ?? defaultHandAuthoredPath()
  const goldenPath = options?.goldenPath ?? defaultGoldenEvalPath()

  const results = [
    validateTrainingJsonlFile(seedPath),
    validateTrainingJsonlFile(handAuthoredPath),
    validateGoldenJsonlFile(goldenPath),
  ]

  return {
    results,
    ok: results.every((result) => result.issues.length === 0),
  }
}
