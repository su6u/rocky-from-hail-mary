/**
 * Export shared contracts from TypeScript packages for Python training and tooling.
 * Run: pnpm sync-contracts
 */
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { Emotions, Gestures } from "../packages/domain/dist/index.js"
import { ROCKY_METADATA_TAG, SYSTEM_PROMPT } from "../packages/prompt/dist/index.js"

const repoRoot = resolve(import.meta.dirname, "..")
const contractsDir = resolve(repoRoot, "contracts")
const promptsDir = resolve(contractsDir, "prompts")

const GENERATED =
  "GENERATED — run `pnpm sync-contracts` after changing @rocky/domain or @rocky/prompt"

const writeText = async (path, body) => {
  await writeFile(path, `${body.trimEnd()}\n`, "utf8")
}

const main = async () => {
  await mkdir(promptsDir, { recursive: true })

  await writeFile(
    resolve(contractsDir, "domain.json"),
    `${JSON.stringify(
      {
        _generated: GENERATED,
        metadataTag: ROCKY_METADATA_TAG,
        emotions: Emotions,
        gestures: Gestures,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  await writeText(resolve(promptsDir, "rocky-system.txt"), SYSTEM_PROMPT)

  console.log("contracts/domain.json")
  console.log("contracts/prompts/rocky-system.txt")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
