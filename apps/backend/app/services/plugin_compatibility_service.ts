import {
  PLUGIN_SEAM_CURATED_CATALOG,
  evaluatePluginCompatibility,
  evaluatePluginReleaseApprovalCompatibility,
  type HostPluginContractSnapshot,
  type PluginBreakingSnapshot,
  type PluginCompatibilityDeclaration,
} from '@aiproj/types'

const HOST_READY_SEAMS = new Set([
  'skill-adapter.skill-bundle',
  'compiler-contribution.context-contribution',
  'server-query.readonly-provider',
  'server-command-proposal.proposal-only',
  'template-pack.content-bundle',
  'ocr-profile.content-bundle',
])

/** Single current-host snapshot shared by approval/install/enable/upgrade/rollback. */
export function currentPluginHostContract(): HostPluginContractSnapshot {
  return {
    hostVersion: '3.0.0',
    manifestSchemaVersions: ['1.0'],
    permissionModelVersion: '1.0',
    distributionChannels: ['stable'],
    seams: PLUGIN_SEAM_CURATED_CATALOG.map((entry) =>
      HOST_READY_SEAMS.has(entry.seamKey)
        ? { ...entry, availability: 'host-ready' as const }
        : entry,
    ),
  }
}

export function evaluateCurrentPluginCompatibility(declaration: PluginCompatibilityDeclaration) {
  return evaluatePluginCompatibility(currentPluginHostContract(), declaration)
}

interface ReleaseApprovalMetadata {
  compatibilityMatrix?: PluginCompatibilityDeclaration
  breakingChange?: {
    before: PluginBreakingSnapshot
    after: PluginBreakingSnapshot
    handledDigest?: string
  }
}

/** Parses only the compatibility review surface; package/manifest bodies never enter output. */
export function evaluateCurrentReleaseApproval(metadata: string | null) {
  let parsed: ReleaseApprovalMetadata = {}
  if (metadata) {
    try {
      const value = JSON.parse(metadata) as unknown
      if (value && typeof value === 'object') parsed = value as ReleaseApprovalMetadata
    } catch {
      parsed = {}
    }
  }
  return evaluatePluginReleaseApprovalCompatibility({
    host: currentPluginHostContract(),
    declaration: parsed.compatibilityMatrix,
    ...(parsed.breakingChange ? { breakingChange: parsed.breakingChange } : {}),
  })
}
