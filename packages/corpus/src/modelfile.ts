import { basename } from "node:path"

import { SYSTEM_PROMPT } from "@rocky/prompt"

import type { ModelSpec } from "./model-spec.js"
import { promptHash } from "./trainer-export.js"

export const MODELFILE_GENERATED_MARKER = "GENERATED — do not edit by hand"

export interface GenerateModelfileOptions {
  readonly spec: ModelSpec
  readonly systemPrompt?: string
  readonly ggufPath?: string
}

export class ModelfileError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.name = "ModelfileError"
    this.reason = reason
  }
}

export const assertCanonicalSystemPrompt = (systemPrompt: string): void => {
  if (systemPrompt !== SYSTEM_PROMPT) {
    throw new ModelfileError("system prompt must match @rocky/prompt SYSTEM_PROMPT")
  }
}

export const resolveModelfileGgufFrom = (ggufPath: string): string => `./${basename(ggufPath)}`

export const generateModelfile = ({
  spec,
  systemPrompt = SYSTEM_PROMPT,
  ggufPath = spec.artifacts.gguf_path,
}: GenerateModelfileOptions): string => {
  assertCanonicalSystemPrompt(systemPrompt)

  const lines = [
    `# ${MODELFILE_GENERATED_MARKER}`,
    `# spec: ${spec.id}`,
    `# prompt_hash: ${promptHash()}`,
    `FROM ${resolveModelfileGgufFrom(ggufPath)}`,
    `SYSTEM """${systemPrompt}"""`,
    `PARAMETER temperature ${spec.inference.temperature}`,
    `PARAMETER top_p ${spec.inference.top_p}`,
    `PARAMETER num_ctx ${spec.inference.num_ctx}`,
  ]

  for (const stop of spec.inference.stop) {
    lines.push(`STOP ${JSON.stringify(stop)}`)
  }

  return `${lines.join("\n")}\n`
}
