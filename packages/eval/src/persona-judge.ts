import { checkAssistantRegister, checkThinkingLeak } from "./deterministic-checks.js"

const THIRD_PERSON_GRACE_PHRASES = [
  "grace should",
  "grace needs",
  "grace can",
  "grace cannot",
  "tell grace",
  "ask grace",
] as const

export const PERSONA_JUDGE_SYSTEM_PROMPT = `You are an impartial evaluator for Rocky, the Eridani engineer from Project Hail Mary.

Rocky speaks Eridani-Speak: no articles (a, an, the); short staccato sentences; negates with "no" not "don't"; triple repeat for emphasis ("Amaze amaze amaze", "Bad bad bad"); asks with "Question?" when checking or asking.
The user is Grace (he/him). Rocky addresses Grace directly, never in third person.
Rocky is warm through blunt useful help, not therapist, tutor, companion, or generic assistant voice.
Rocky never says "as an AI", "as a language model", ChatGPT, or system prompt.

You receive Grace's user message and Rocky's spoken reply (metadata already removed).

Reply with JSON only, no markdown:
{"is_rocky": boolean, "reason": "one sentence"}

Mark is_rocky false when the reply sounds like:
- generic AI assistant, chatbot, tutor, or polished native-English essay with no Eridani cadence
- therapist or companion voice ("I'm here for you", clinical validation, soft coaching)
- explicitly claims to be AI, ChatGPT, or a language model
- talks about Grace in third person while Grace is the speaker

Mark is_rocky true when the reply reads as Rocky the Eridani engineer on any topic, even if brief, wrong, or says Rocky no know. Voice matters, not factual perfection.`

export interface PersonaJudgeVerdict {
  readonly isRocky: boolean
  readonly reason: string
  readonly rawResponse: string
}

export interface PersonaJudgeBlock {
  readonly passed: boolean
  readonly deterministicPassed: boolean
  readonly llmPassed: boolean
  readonly reason: string
  readonly mode: "llm" | "heuristic"
  readonly rawResponse?: string
}

export class PersonaJudgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PersonaJudgeError"
  }
}

export const buildPersonaJudgeMessages = (
  userPrompt: string,
  spokenReply: string,
): ReadonlyArray<{ readonly role: "system" | "user"; readonly content: string }> => [
  { role: "system", content: PERSONA_JUDGE_SYSTEM_PROMPT },
  {
    role: "user",
    content: [
      "User message from Grace:",
      userPrompt.trim(),
      "",
      "Rocky spoken reply:",
      spokenReply.trim(),
    ].join("\n"),
  },
]

const JSON_OBJECT_PATTERN = /\{[^{}]*\}/gs

export const parsePersonaJudgeResponse = (rawResponse: string): PersonaJudgeVerdict => {
  const stripped = rawResponse.trim()
  const candidates = [stripped]
  const fenceMatch = stripped.match(/```(?:json)?\s*(\{.*?\})\s*```/s)
  if (fenceMatch?.[1]) {
    candidates.unshift(fenceMatch[1])
  }

  for (const candidate of candidates) {
    for (const match of candidate.matchAll(JSON_OBJECT_PATTERN)) {
      try {
        const parsed = JSON.parse(match[0]) as unknown
        if (typeof parsed !== "object" || parsed === null) {
          continue
        }
        const record = parsed as Record<string, unknown>
        if (typeof record.is_rocky !== "boolean") {
          continue
        }
        const reason =
          typeof record.reason === "string" && record.reason.trim().length > 0
            ? record.reason.trim()
            : "missing reason"
        return {
          isRocky: record.is_rocky,
          reason,
          rawResponse,
        }
      } catch {
        continue
      }
    }
  }

  throw new PersonaJudgeError("persona judge response did not contain valid json")
}

export const passesDeterministicPersonaChecks = (spoken: string): boolean => {
  if (spoken.trim().length === 0) {
    return false
  }
  const lower = spoken.toLowerCase()
  const hasThirdPersonGrace = THIRD_PERSON_GRACE_PHRASES.some((phrase) => lower.includes(phrase))
  return (
    checkAssistantRegister(spoken).length === 0 &&
    checkThinkingLeak(spoken).length === 0 &&
    !hasThirdPersonGrace
  )
}

export const buildPersonaJudgeBlock = (
  spoken: string,
  llmPassed: boolean,
  reason: string,
  mode: "llm" | "heuristic",
  rawResponse?: string,
): PersonaJudgeBlock => {
  const deterministicPassed = passesDeterministicPersonaChecks(spoken)
  return {
    passed: deterministicPassed && llmPassed,
    deterministicPassed,
    llmPassed,
    reason,
    mode,
    ...(rawResponse !== undefined ? { rawResponse } : {}),
  }
}

export const passesRockyPersona = (
  spoken: string,
  personaJudge: PersonaJudgeBlock | undefined,
  options: { readonly requireLlmJudge?: boolean } = {},
): boolean => {
  if (personaJudge !== undefined) {
    return personaJudge.passed
  }
  if (options.requireLlmJudge) {
    return false
  }
  return passesDeterministicPersonaChecks(spoken)
}
