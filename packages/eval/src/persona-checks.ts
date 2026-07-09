import { checkAssistantRegister, checkThinkingLeak } from "./deterministic-checks.js"

/** Advisory / narrative phrasing about Grace — not direct Rocky→Grace address */
const THIRD_PERSON_GRACE_PATTERNS = [
  /\bgrace should\b/,
  /\bgrace needs\b/,
  /\bgrace must\b/,
  /\bgrace has to\b/,
  /\btell grace to\b/,
  /\bask grace to\b/,
] as const

export const containsThirdPersonGraceInstruction = (spoken: string): boolean =>
  THIRD_PERSON_GRACE_PATTERNS.some((pattern) => pattern.test(spoken.toLowerCase()))

export const passesDeterministicPersonaChecks = (spoken: string): boolean => {
  if (spoken.trim().length === 0) {
    return false
  }
  const hasThirdPersonGrace = containsThirdPersonGraceInstruction(spoken)
  return (
    checkAssistantRegister(spoken).length === 0 &&
    checkThinkingLeak(spoken).length === 0 &&
    !hasThirdPersonGrace
  )
}

export const passesRockyPersona = (spoken: string): boolean =>
  passesDeterministicPersonaChecks(spoken)
