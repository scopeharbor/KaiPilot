import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import {
  CANARY_ADVISORY_PLUGIN_ID,
  CANARY_ADVISORY_RELEASE_METADATA,
  CANARY_QUERY_PLUGIN_ID,
  CANARY_QUERY_RELEASE_METADATA,
} from '@aiproj/types'
import { evaluateCurrentReleaseApproval } from '#services/plugin_compatibility_service'

export async function seedCanaryRelease(
  organizationId: number,
  kind: 'query' | 'advisory',
  version = '1.0.0',
  overrides: { status?: string; packageDigest?: string; metadata?: Record<string, unknown> } = {},
) {
  const pluginId = kind === 'query' ? CANARY_QUERY_PLUGIN_ID : CANARY_ADVISORY_PLUGIN_ID
  const base = kind === 'query' ? CANARY_QUERY_RELEASE_METADATA : CANARY_ADVISORY_RELEASE_METADATA
  const metadata = overrides.metadata ?? {
    ...base,
    version,
    compatibilityMatrix: {
      pluginVersion: version,
      hostRange: '>=3.0.0 <4.0.0',
      manifestSchemaVersion: '1.0',
      permissionModelVersion: '1.0',
      channel: 'stable',
      requiredSeams: base.contributions.map((item) => ({
        seamKey: item.seamKey,
        seamVersion: item.seamVersion,
      })),
    },
  }
  if ((overrides.status ?? 'approved') === 'approved') {
    const approval = evaluateCurrentReleaseApproval(JSON.stringify(metadata))
    if (!approval.allowed) {
      throw new Error(`Canary release approval rejected: ${approval.reasonCodes.join(',')}`)
    }
  }
  return PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: pluginId,
    version,
    packageDigest: overrides.packageDigest ?? `sha256:${kind}-package-${version}`,
    manifestDigest: `sha256:${kind}-manifest-${version}`,
    compatibilityDigest: `sha256:${kind}-compat-${version}`,
    upstreamReceiptRef: `fixture:first-party-canary-${kind}-${version}`,
    status: overrides.status ?? 'approved',
    metadata: JSON.stringify(metadata),
    rowVersion: 1,
  })
}
