import { isUnderRawPath, type SourceManifest } from "./source-manifest.js"

export interface TrainerExportGuardResult {
  readonly eligible: ReadonlyArray<SourceManifest>
  readonly rejected: ReadonlyArray<{ readonly manifest: SourceManifest; readonly reason: string }>
}

export const trainerExportRejectionReason = (manifest: SourceManifest): string | undefined => {
  if (manifest.localOnly) {
    return "localOnly sources are never trainer export input"
  }

  if (isUnderRawPath(manifest.filePath)) {
    return "raw/ paths are never trainer export input"
  }

  if (!manifest.allowedPipelineUse.includes("trainer_export")) {
    return "manifest does not allow trainer_export"
  }

  return undefined
}

export const isTrainerExportEligible = (manifest: SourceManifest): boolean =>
  trainerExportRejectionReason(manifest) === undefined

export const partitionTrainerExportSources = (
  manifests: ReadonlyArray<SourceManifest>,
): TrainerExportGuardResult => {
  const eligible: SourceManifest[] = []
  const rejected: TrainerExportGuardResult["rejected"][number][] = []

  for (const manifest of manifests) {
    const reason = trainerExportRejectionReason(manifest)
    if (reason === undefined) {
      eligible.push(manifest)
    } else {
      rejected.push({ manifest, reason })
    }
  }

  return { eligible, rejected }
}

export const assertTrainerExportSafe = (manifest: SourceManifest): void => {
  const reason = trainerExportRejectionReason(manifest)
  if (reason !== undefined) {
    throw new TrainerExportGuardError(manifest.sourceId, reason)
  }
}

export class TrainerExportGuardError extends Error {
  readonly sourceId: string
  readonly reason: string

  constructor(sourceId: string, reason: string) {
    super(`source ${sourceId} cannot be trainer export input: ${reason}`)
    this.name = "TrainerExportGuardError"
    this.sourceId = sourceId
    this.reason = reason
  }
}
