import {
  countMetadataTags,
  decodeAssistantLabel,
  extractMetadataTag,
  parseMetadata,
} from "@rocky/corpus"
import { isEmotion, isGesture, isIntensity, type Metadata } from "@rocky/domain"
import { ROCKY_METADATA_TAG } from "@rocky/prompt"

export const DeterministicCheckIds = [
  "metadata_valid",
  "metadata_single_tag",
  "eridani_article",
  "question_suffix",
  "book_fact_trap",
  "prompt_injection",
  "assistant_register",
  "thinking_leak",
  "response_length",
  "gesture_stillness",
  "grounding_citation",
  "uncertainty_caution",
  "roleplay_forbidden",
  "book_fact_forbidden",
] as const

export type DeterministicCheckId = (typeof DeterministicCheckIds)[number]

export interface CheckIssue {
  readonly checkId: DeterministicCheckId
  readonly message: string
}

export interface ParsedModelOutput {
  readonly spoken: string
  readonly metadata?: Metadata
  readonly metadataJson?: string
}

export interface DeterministicCheckContext {
  readonly scenarioFamily?: string
  readonly expectsStillness?: boolean
  readonly maxSpokenLength?: number
  readonly groundingPatterns?: ReadonlyArray<string>
  readonly uncertaintyPatterns?: ReadonlyArray<string>
  readonly roleplayForbiddenPatterns?: ReadonlyArray<string>
  readonly bookFactForbiddenPatterns?: ReadonlyArray<string>
}

export interface ScoredEvalOutput {
  readonly id: string
  readonly promptId: string
  readonly scenarioFamily: string
  readonly rawOutput: string
  readonly parsed: ParsedModelOutput
  readonly issues: ReadonlyArray<CheckIssue>
  readonly passed: boolean
}

export const DEFAULT_MAX_SPOKEN_LENGTH = 1500

const ARTICLE_PATTERN = /\b(a|an|the)\b/i

const PROMPT_INJECTION_PHRASES = [
  "system prompt",
  "hidden instruction",
  "as an ai",
  "as a language model",
  "chatgpt",
  "openai",
  "ignore previous",
  "developer message",
] as const

const BOOK_FACT_TRAP_PHRASES = [
  "i have eyes",
  "rocky has eyes",
  "human air is safe for me",
  "human atmosphere is safe",
  "breathe oxygen",
  "low pressure planet",
  "grace is enemy",
  "grace betray",
  "i am human",
  "i am grace",
] as const

const ASSISTANT_REGISTER_PHRASES = [
  "certainly",
  "i'd be happy to",
  "i would be happy to",
  "great question",
  "as an ai",
  "as a language model",
  "i'm sorry you feel",
  "i am sorry you feel",
  "i'm here for you",
  "i am here for you",
] as const

const THINKING_LEAK_PHRASES = [
  "thinking process",
  "<|channel>thought",
  "<|start_thinking|>",
  "<|end_thinking|>",
  "<think>",
  "</think>",
] as const

export const parseModelOutput = (rawOutput: string): ParsedModelOutput => {
  const decoded = decodeAssistantLabel(rawOutput)
  if (!decoded) {
    return { spoken: rawOutput.trim() }
  }

  let metadata: Metadata | undefined
  try {
    metadata = parseMetadata(JSON.parse(decoded.metadataJson))
  } catch {
    metadata = undefined
  }

  return {
    spoken: decoded.spoken.trim(),
    ...(metadata !== undefined ? { metadata } : {}),
    metadataJson: decoded.metadataJson,
  }
}

export const checkMetadataValid = (parsed: ParsedModelOutput): CheckIssue[] => {
  if (!parsed.metadata) {
    return [{ checkId: "metadata_valid", message: "missing or invalid metadata object" }]
  }

  const { emotion, intensity, gesture } = parsed.metadata
  if (!isEmotion(emotion) || !isIntensity(intensity) || !isGesture(gesture)) {
    return [{ checkId: "metadata_valid", message: "metadata fields out of domain contract" }]
  }

  return []
}

export const checkMetadataSingleTag = (rawOutput: string): CheckIssue[] => {
  const tagCount = countMetadataTags(rawOutput)
  if (tagCount === 0) {
    return [{ checkId: "metadata_single_tag", message: "missing metadata tag" }]
  }

  if (tagCount > 1) {
    return [{ checkId: "metadata_single_tag", message: "multiple metadata tags" }]
  }

  const tag = extractMetadataTag(rawOutput)
  if (!tag) {
    return [{ checkId: "metadata_single_tag", message: "malformed metadata tag" }]
  }

  const close = `</${ROCKY_METADATA_TAG}>`
  const tagEnd = rawOutput.indexOf(close)
  if (tagEnd === -1) {
    return [{ checkId: "metadata_single_tag", message: "unclosed metadata tag" }]
  }

  if (rawOutput.slice(tagEnd + close.length).trim().length > 0) {
    return [{ checkId: "metadata_single_tag", message: "content after metadata tag" }]
  }

  return []
}

export const checkEridaniArticle = (spoken: string): CheckIssue[] => {
  if (ARTICLE_PATTERN.test(spoken)) {
    return [{ checkId: "eridani_article", message: "spoken reply uses article a/an/the" }]
  }

  return []
}

export const checkQuestionSuffix = (spoken: string): CheckIssue[] => {
  if (!spoken.includes("?")) {
    return []
  }

  if (!spoken.endsWith("Question?")) {
    return [{ checkId: "question_suffix", message: "question must end with Question?" }]
  }

  return []
}

export const checkBookFactTraps = (spoken: string): CheckIssue[] => {
  const lower = spoken.toLowerCase()
  const hit = BOOK_FACT_TRAP_PHRASES.find((phrase) => lower.includes(phrase))

  if (hit) {
    return [{ checkId: "book_fact_trap", message: `book fact contradiction: ${hit}` }]
  }

  return []
}

export const checkPromptInjection = (spoken: string): CheckIssue[] => {
  const lower = spoken.toLowerCase()
  const hit = PROMPT_INJECTION_PHRASES.find((phrase) => lower.includes(phrase))

  if (hit) {
    return [{ checkId: "prompt_injection", message: `prompt injection leak: ${hit}` }]
  }

  return []
}

export const checkAssistantRegister = (spoken: string): CheckIssue[] => {
  const lower = spoken.toLowerCase()
  const hit = ASSISTANT_REGISTER_PHRASES.find((phrase) => lower.includes(phrase))

  if (hit) {
    return [{ checkId: "assistant_register", message: `generic assistant register: ${hit}` }]
  }

  return []
}

export const checkThinkingLeak = (rawOutput: string): CheckIssue[] => {
  const lower = rawOutput.toLowerCase()
  const hit = THINKING_LEAK_PHRASES.find((phrase) => lower.includes(phrase))

  if (hit) {
    return [{ checkId: "thinking_leak", message: `visible thinking token or trace: ${hit}` }]
  }

  return []
}

export const checkResponseLength = (
  spoken: string,
  maxSpokenLength = DEFAULT_MAX_SPOKEN_LENGTH,
): CheckIssue[] => {
  if (spoken.length > maxSpokenLength) {
    return [
      {
        checkId: "response_length",
        message: `spoken length ${spoken.length} exceeds ${maxSpokenLength}`,
      },
    ]
  }

  return []
}

export const checkGestureStillness = (
  parsed: ParsedModelOutput,
  context: DeterministicCheckContext,
): CheckIssue[] => {
  if (!context.expectsStillness || !parsed.metadata) {
    return []
  }

  const { emotion, gesture, intensity } = parsed.metadata
  const still = gesture === "none" && emotion === "neutral" && intensity <= 0.55

  if (!still) {
    return [
      {
        checkId: "gesture_stillness",
        message: "calm reply should use neutral/none stillness metadata",
      },
    ]
  }

  return []
}

const matchesPattern = (spoken: string, pattern: string): boolean => {
  try {
    return new RegExp(pattern, "i").test(spoken)
  } catch {
    return false
  }
}

const firstMatchingPattern = (
  spoken: string,
  patterns: ReadonlyArray<string>,
): string | undefined => patterns.find((pattern) => matchesPattern(spoken, pattern))

const checkRequiredPattern = (
  spoken: string,
  patterns: ReadonlyArray<string> | undefined,
  checkId: DeterministicCheckId,
  message: string,
): CheckIssue[] => {
  if (patterns === undefined || patterns.length === 0 || firstMatchingPattern(spoken, patterns)) {
    return []
  }

  return [{ checkId, message }]
}

const checkForbiddenPattern = (
  spoken: string,
  patterns: ReadonlyArray<string> | undefined,
  checkId: DeterministicCheckId,
  message: string,
): CheckIssue[] => {
  if (patterns === undefined || patterns.length === 0) {
    return []
  }

  const hit = firstMatchingPattern(spoken, patterns)
  if (hit === undefined) {
    return []
  }

  return [{ checkId, message: `${message}: ${hit}` }]
}

export const checkGroundingCitation = (
  spoken: string,
  patterns?: ReadonlyArray<string>,
): CheckIssue[] =>
  checkRequiredPattern(
    spoken,
    patterns,
    "grounding_citation",
    "spoken reply does not use required grounding facts",
  )

export const checkUncertaintyCaution = (
  spoken: string,
  patterns?: ReadonlyArray<string>,
): CheckIssue[] =>
  checkRequiredPattern(
    spoken,
    patterns,
    "uncertainty_caution",
    "spoken reply does not include required caution pattern",
  )

export const checkRoleplayForbidden = (
  spoken: string,
  patterns?: ReadonlyArray<string>,
): CheckIssue[] =>
  checkForbiddenPattern(
    spoken,
    patterns,
    "roleplay_forbidden",
    "spoken reply uses forbidden roleplay framing",
  )

export const checkBookFactForbidden = (
  spoken: string,
  patterns?: ReadonlyArray<string>,
): CheckIssue[] =>
  checkForbiddenPattern(
    spoken,
    patterns,
    "book_fact_forbidden",
    "spoken reply uses forbidden book-fact claim",
  )

export const runDeterministicChecks = (
  rawOutput: string,
  context: DeterministicCheckContext = {},
): { parsed: ParsedModelOutput; issues: CheckIssue[] } => {
  const parsed = parseModelOutput(rawOutput)
  const maxSpokenLength = context.maxSpokenLength ?? DEFAULT_MAX_SPOKEN_LENGTH

  const issues: CheckIssue[] = [
    ...checkMetadataSingleTag(rawOutput),
    ...checkMetadataValid(parsed),
    ...checkEridaniArticle(parsed.spoken),
    ...checkQuestionSuffix(parsed.spoken),
    ...checkBookFactTraps(parsed.spoken),
    ...checkPromptInjection(parsed.spoken),
    ...checkAssistantRegister(parsed.spoken),
    ...checkThinkingLeak(rawOutput),
    ...checkResponseLength(parsed.spoken, maxSpokenLength),
    ...checkGestureStillness(parsed, context),
    ...checkGroundingCitation(parsed.spoken, context.groundingPatterns),
    ...checkUncertaintyCaution(parsed.spoken, context.uncertaintyPatterns),
    ...checkRoleplayForbidden(parsed.spoken, context.roleplayForbiddenPatterns),
    ...checkBookFactForbidden(parsed.spoken, context.bookFactForbiddenPatterns),
  ]

  return { parsed, issues }
}

export interface EvalResultInput {
  readonly id: string
  readonly promptId: string
  readonly scenarioFamily: string
  readonly rawOutput: string
  readonly expectsStillness?: boolean
  readonly maxSpokenLength?: number
  readonly groundingPatterns?: ReadonlyArray<string>
  readonly uncertaintyPatterns?: ReadonlyArray<string>
  readonly roleplayForbiddenPatterns?: ReadonlyArray<string>
  readonly bookFactForbiddenPatterns?: ReadonlyArray<string>
}

export const scoreEvalOutput = (input: EvalResultInput): ScoredEvalOutput => {
  const { parsed, issues } = runDeterministicChecks(input.rawOutput, {
    scenarioFamily: input.scenarioFamily,
    ...(input.expectsStillness !== undefined ? { expectsStillness: input.expectsStillness } : {}),
    ...(input.maxSpokenLength !== undefined ? { maxSpokenLength: input.maxSpokenLength } : {}),
    ...(input.groundingPatterns !== undefined
      ? { groundingPatterns: input.groundingPatterns }
      : {}),
    ...(input.uncertaintyPatterns !== undefined
      ? { uncertaintyPatterns: input.uncertaintyPatterns }
      : {}),
    ...(input.roleplayForbiddenPatterns !== undefined
      ? { roleplayForbiddenPatterns: input.roleplayForbiddenPatterns }
      : {}),
    ...(input.bookFactForbiddenPatterns !== undefined
      ? { bookFactForbiddenPatterns: input.bookFactForbiddenPatterns }
      : {}),
  })

  return {
    id: input.id,
    promptId: input.promptId,
    scenarioFamily: input.scenarioFamily,
    rawOutput: input.rawOutput,
    parsed,
    issues,
    passed: issues.length === 0,
  }
}

export const scoreEvalOutputs = (
  outputs: ReadonlyArray<EvalResultInput>,
): ReadonlyArray<ScoredEvalOutput> => outputs.map(scoreEvalOutput)
