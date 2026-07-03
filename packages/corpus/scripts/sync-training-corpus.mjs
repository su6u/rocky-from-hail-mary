import { refreshTaggedSeedFile, writeFrozenTrainerExport } from "../dist/write-frozen-export.js"

const tagged = refreshTaggedSeedFile()
console.log(
  `seed dedupe: ${tagged.report.inputCount} -> ${tagged.report.outputCount} (dropped low quality ${tagged.report.droppedLowQuality}, non-Rocky ${tagged.report.droppedNonRockySeed}, dupes ${tagged.report.droppedDuplicates}, stripped OCR system ${tagged.report.strippedSystemContexts})`,
)

const frozen = writeFrozenTrainerExport()
console.log(
  `export: ${frozen.manifest.rowCount} train rows -> ${frozen.trainExportPath}; holdout -> ${frozen.holdoutExportPath}`,
)
