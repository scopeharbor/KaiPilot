import {
  evaluatePluginCompatibility,
  projectPluginCompatibilityAudit,
  PLUGIN_SEAM_CURATED_CATALOG,
} from '@aiproj/types'

const host = {
  hostVersion: '3.0.0',
  manifestSchemaVersions: ['1.0'],
  permissionModelVersion: '1.0',
  distributionChannels: ['stable'] as const,
  // The checker validates catalog shape/context separately; entries without a
  // host-ready runtime remain blocking by design.
  seams: PLUGIN_SEAM_CURATED_CATALOG,
}

const fixture = {
  pluginVersion: '1.0.0',
  hostRange: '>=3.0.0 <4.0.0',
  manifestSchemaVersion: '1.0',
  permissionModelVersion: '1.0',
  channel: 'stable' as const,
  requiredSeams: [] as const,
}

const first = evaluatePluginCompatibility(host, fixture)
const second = evaluatePluginCompatibility(host, fixture)
if (first.digest !== second.digest || !first.compatible) {
  process.stderr.write(`${JSON.stringify(projectPluginCompatibilityAudit(first))}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`${JSON.stringify(projectPluginCompatibilityAudit(first))}\n`)
}
