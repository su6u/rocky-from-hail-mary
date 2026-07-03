import type { TrainingExample } from "./schema.js"

/** Recorded outcome when the full OCR seed (273 rows) was sanitized and deduped. */
export const SEED_DEDUPE_FROM_OCR = {
  originalOcrRowCount: 273,
  keptAfterSanitizeAndDedupe: 76,
  droppedNonRocky: 70,
  droppedDuplicates: 127,
  strippedOcrSystemContexts: 148,
} as const

const OCR_SCENE_PREFIX = "Scene from Project Hail Mary aboard Hail Mary: "

const OCR_FRAGMENT_ALLOWLIST = new Set([
  "if",
  "what",
  "when",
  "why",
  "how",
  "and",
  "but",
  "or",
  "so",
  "then",
  "yes",
  "no",
  "oh",
  "hey",
  "same",
  "more",
  "iron",
  "wow",
  "year",
  "right",
])

const ROCKY_BOOK_VERY = /Humans have very small mass!/

const normalizeAssistantText = (content: string): string =>
  content.trim().toLowerCase().replace(/\s+/g, " ")

export const assistantTextKey = (example: TrainingExample): string | undefined => {
  const assistant = example.messages.filter((message) => message.role === "assistant").at(-1)
  if (!assistant || assistant.role !== "assistant") {
    return undefined
  }

  return normalizeAssistantText(assistant.content)
}

export const isNoisyOcrSystemContext = (content: string | undefined): boolean => {
  if (!content) {
    return true
  }

  if (content.length < 120) {
    return true
  }

  if (!content.startsWith(OCR_SCENE_PREFIX)) {
    return false
  }

  const body = content.slice(OCR_SCENE_PREFIX.length).trimStart()
  const firstWord = body.split(/\s+/)[0]?.toLowerCase() ?? ""

  if (/^[A-Z]/.test(body)) {
    return false
  }

  if (OCR_FRAGMENT_ALLOWLIST.has(firstWord)) {
    return false
  }

  if (/^[a-z]/.test(body) && firstWord.length <= 4) {
    return true
  }

  return false
}

export const isNonRockySeedAssistant = (content: string): boolean => {
  if (/\b(?:a|an|the)\b/i.test(content)) {
    return true
  }

  if (
    /\b(?:I['’]m|I['’]ll|don['’]t|doesn['’]t|can['’]t|won['’]t|we['’]re|they['’]re|that['’]s|it['’]s)\b/i.test(
      content,
    )
  ) {
    return true
  }

  if (/\b(?:Call me|Good Morning|of course|See, there)\b/i.test(content)) {
    return true
  }

  if (/\bvery\b/i.test(content) && !ROCKY_BOOK_VERY.test(content)) {
    return true
  }

  if (
    /\bGrace friend\b/i.test(content) &&
    !/\bfriend Grace\b/.test(content) &&
    !/Hello Grace friend/i.test(content)
  ) {
    return true
  }

  return false
}

export const isLowQualityTrainingRow = (example: TrainingExample): boolean => {
  const assistant = example.messages.filter((message) => message.role === "assistant").at(-1)
  if (!assistant || assistant.role !== "assistant") {
    return true
  }

  const normalized = normalizeAssistantText(assistant.content)

  if (normalized.startsWith("many seconds")) {
    return true
  }

  if (normalized.length < 10 && !normalized.includes("?")) {
    return true
  }

  return false
}

export interface SanitizedSeedRow {
  readonly row: TrainingExample
  readonly strippedSystemContext: boolean
}

export const sanitizeSeedTrainingRow = (example: TrainingExample): SanitizedSeedRow | undefined => {
  if (example.source !== "seed") {
    return { row: example, strippedSystemContext: false }
  }

  const assistant = example.messages.filter((message) => message.role === "assistant").at(-1)
  if (!assistant || assistant.role !== "assistant") {
    return undefined
  }

  if (isLowQualityTrainingRow(example) || isNonRockySeedAssistant(assistant.content)) {
    return undefined
  }

  let strippedSystemContext = false
  const messages = example.messages.filter((message) => {
    if (message.role !== "system") {
      return true
    }

    if (isNoisyOcrSystemContext(message.content)) {
      strippedSystemContext = true
      return false
    }

    return true
  })

  return {
    row: { ...example, messages },
    strippedSystemContext,
  }
}

export const sanitizeSeedTrainingRows = (
  rows: ReadonlyArray<TrainingExample>,
): {
  readonly rows: ReadonlyArray<TrainingExample>
  readonly droppedLowQuality: number
  readonly droppedNonRockySeed: number
  readonly strippedSystemContexts: number
} => {
  const prepared: TrainingExample[] = []
  let droppedLowQuality = 0
  let droppedNonRockySeed = 0
  let strippedSystemContexts = 0

  for (const row of rows) {
    const sanitized = sanitizeSeedTrainingRow(row)
    if (!sanitized) {
      if (row.source === "seed") {
        const assistant = row.messages.filter((message) => message.role === "assistant").at(-1)
        if (!assistant || assistant.role !== "assistant" || isLowQualityTrainingRow(row)) {
          droppedLowQuality += 1
        } else if (isNonRockySeedAssistant(assistant.content)) {
          droppedNonRockySeed += 1
        }
      }
      continue
    }

    if (sanitized.strippedSystemContext) {
      strippedSystemContexts += 1
    }

    prepared.push(sanitized.row)
  }

  return { rows: prepared, droppedLowQuality, droppedNonRockySeed, strippedSystemContexts }
}

const rowQualityScore = (example: TrainingExample): number => {
  const userLength = example.messages
    .filter((message) => message.role === "user")
    .reduce((total, message) => total + message.content.length, 0)

  const assistant = example.messages.filter((message) => message.role === "assistant").at(-1)
  if (!assistant || assistant.role !== "assistant") {
    return userLength
  }

  const metadataBonus =
    assistant.metadata.emotion !== "neutral" || assistant.metadata.gesture !== "none" ? 25 : 0

  return userLength + metadataBonus + assistant.content.length
}

export const dedupeTrainingRows = (
  rows: ReadonlyArray<TrainingExample>,
): ReadonlyArray<TrainingExample> => {
  const grouped = new Map<string, TrainingExample[]>()

  for (const row of rows) {
    if (isLowQualityTrainingRow(row)) {
      continue
    }

    const key = assistantTextKey(row)
    if (!key) {
      continue
    }

    const bucket = grouped.get(key) ?? []
    bucket.push(row)
    grouped.set(key, bucket)
  }

  return [...grouped.values()].map((bucket) =>
    bucket.reduce((best, candidate) =>
      rowQualityScore(candidate) > rowQualityScore(best) ? candidate : best,
    ),
  )
}

export interface DedupeReport {
  readonly inputCount: number
  readonly outputCount: number
  readonly droppedLowQuality: number
  readonly droppedDuplicates: number
  readonly droppedNonRockySeed: number
  readonly strippedSystemContexts: number
}

export const dedupeTrainingRowsWithReport = (
  rows: ReadonlyArray<TrainingExample>,
): { rows: ReadonlyArray<TrainingExample>; report: DedupeReport } => {
  const {
    rows: sanitizedRows,
    droppedLowQuality: droppedLowQualityDuringSanitize,
    droppedNonRockySeed,
    strippedSystemContexts,
  } = sanitizeSeedTrainingRows(rows)
  const kept = dedupeTrainingRows(sanitizedRows)
  const droppedLowQualityAfterSanitize = sanitizedRows.filter((row) =>
    isLowQualityTrainingRow(row),
  ).length
  const droppedLowQuality = droppedLowQualityDuringSanitize + droppedLowQualityAfterSanitize
  const droppedDuplicates = sanitizedRows.length - droppedLowQualityAfterSanitize - kept.length

  return {
    rows: kept,
    report: {
      inputCount: rows.length,
      outputCount: kept.length,
      droppedLowQuality,
      droppedDuplicates,
      droppedNonRockySeed,
      strippedSystemContexts,
    },
  }
}
