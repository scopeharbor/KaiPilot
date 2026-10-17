/**
 * first-party-plugin-canary-pack —— V3 官方 canary 插件包共享契约（W5a）
 */

import {
  MANIFEST_SCHEMA_VERSION,
  computeManifestDigest as _computeManifestDigest,
  manifestFnv1aHash,
  manifestStableSerialize,
  normalizeManifest,
  type PluginManifestV1,
} from './plugin-manifest.js'

export const CANARY_QUERY_PLUGIN_ID = 'com.aiproj.canary-query' as const
export const CANARY_QUERY_VERSION = '1.0.0' as const
export const CANARY_QUERY_PUBLISHER = 'aiproj-official' as const

export const CANARY_ADVISORY_PLUGIN_ID = 'com.aiproj.canary-advisory' as const
export const CANARY_ADVISORY_VERSION = '1.0.0' as const
export const CANARY_ADVISORY_PUBLISHER = 'aiproj-official' as const

export const CANARY_HOST_CONTRACT_VERSION = '1.0' as const

export const CANARY_QUERY_MANIFEST: PluginManifestV1 = {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  identity: {
    pluginId: CANARY_QUERY_PLUGIN_ID,
    name: 'Canary Query (Read-Only)',
    version: CANARY_QUERY_VERSION,
    publisher: CANARY_QUERY_PUBLISHER,
    description: 'Official read-only project summary query canary (bounded preview, zero network)',
  },
  provenance: {
    distribution: 'first-party',
    sourceRef: 'repo:github.com/aiproj/aiproj@canary-query-v1',
  },
  compatibility: {
    hostContractVersion: CANARY_HOST_CONTRACT_VERSION,
    requiredSeams: [{ seamKey: 'server-query.readonly-provider', seamVersion: '1.0.0' }],
  },
  contributions: [
    {
      contributionKey: 'canary-query-summary',
      seamKey: 'server-query.readonly-provider',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'json', path: 'canary/query-summary.json' },
      permissionRefs: ['aiproj.project-view'],
    },
  ],
  permissions: [
    {
      permissionKey: 'aiproj.project-view',
      seamKey: 'server-query.readonly-provider',
      scopeKind: 'organization',
      sideEffect: 'read-only',
      confirmation: 'not-required',
      network: 'none',
      purpose: 'Read-only canary query for project summary',
    },
  ],
}

export const CANARY_ADVISORY_MANIFEST: PluginManifestV1 = {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  identity: {
    pluginId: CANARY_ADVISORY_PLUGIN_ID,
    name: 'Canary Advisory (Skill)',
    version: CANARY_ADVISORY_VERSION,
    publisher: CANARY_ADVISORY_PUBLISHER,
    description:
      'Official advisory Skill canary referencing existing Skill (draft preview, zero network)',
  },
  provenance: {
    distribution: 'first-party',
    sourceRef: 'repo:github.com/aiproj/aiproj@canary-advisory-v1',
  },
  compatibility: {
    hostContractVersion: CANARY_HOST_CONTRACT_VERSION,
    requiredSeams: [{ seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' }],
  },
  contributions: [
    {
      contributionKey: 'canary-skill-bundle',
      seamKey: 'skill-adapter.skill-bundle',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'json', path: 'canary/skill-bundle.json' },
      permissionRefs: ['aiproj.compiler-skill-view'],
    },
  ],
  permissions: [
    {
      permissionKey: 'aiproj.compiler-skill-view',
      seamKey: 'skill-adapter.skill-bundle',
      scopeKind: 'organization',
      sideEffect: 'read-only',
      confirmation: 'not-required',
      network: 'none',
      purpose: 'Advisory canary referencing existing Skill',
    },
  ],
}

export function computeCanaryManifestDigest(manifest: PluginManifestV1): string {
  return _computeManifestDigest(manifest)
}

export function computeCanaryPackageDigest(manifest: PluginManifestV1): string {
  const normalized = normalizeManifest(manifest)
  return `sha256:${manifestFnv1aHash(`pkg:${manifestStableSerialize(normalized)}`)}`
}

export function computeCanaryCompatibilityDigest(manifest: PluginManifestV1): string {
  const normalized = normalizeManifest(manifest)
  return `sha256:${manifestFnv1aHash(`compat:${manifestStableSerialize(normalized.compatibility)}:${normalized.compatibility.hostContractVersion}`)}`
}

export const CANARY_QUERY_MANIFEST_DIGEST = computeCanaryManifestDigest(CANARY_QUERY_MANIFEST)
export const CANARY_QUERY_PACKAGE_DIGEST = computeCanaryPackageDigest(CANARY_QUERY_MANIFEST)
export const CANARY_QUERY_COMPATIBILITY_DIGEST =
  computeCanaryCompatibilityDigest(CANARY_QUERY_MANIFEST)

export const CANARY_ADVISORY_MANIFEST_DIGEST = computeCanaryManifestDigest(CANARY_ADVISORY_MANIFEST)
export const CANARY_ADVISORY_PACKAGE_DIGEST = computeCanaryPackageDigest(CANARY_ADVISORY_MANIFEST)
export const CANARY_ADVISORY_COMPATIBILITY_DIGEST =
  computeCanaryCompatibilityDigest(CANARY_ADVISORY_MANIFEST)

export const CANARY_QUERY_RELEASE_METADATA = {
  name: 'Canary Query (Read-Only)',
  version: CANARY_QUERY_VERSION,
  pluginId: CANARY_QUERY_PLUGIN_ID,
  distribution: 'first-party' as const,
  networkPolicy: 'none' as const,
  providerCalls: 0 as const,
  draftPersisted: false as const,
  contributions: [
    {
      contributionKey: 'canary-query-summary',
      seamKey: 'server-query.readonly-provider',
      seamVersion: '1.0.0',
      title: 'Canary 只读项目摘要',
      payload: {
        callbackHandle: 'canary-query-summary-callback',
        description: 'Official canary read-only project summary (bounded, fixture)',
        requiredPermissions: ['project:view'],
      },
    },
  ],
  permissions: [
    {
      permissionKey: 'aiproj.project-view',
      seamKey: 'server-query.readonly-provider',
      sideEffect: 'read-only',
      network: 'none',
      purpose: 'Read-only canary query for project summary',
    },
  ],
}

export const CANARY_ADVISORY_RELEASE_METADATA = {
  name: 'Canary Advisory (Skill)',
  version: CANARY_ADVISORY_VERSION,
  pluginId: CANARY_ADVISORY_PLUGIN_ID,
  distribution: 'first-party' as const,
  networkPolicy: 'none' as const,
  providerCalls: 0 as const,
  draftPersisted: false as const,
  contributions: [
    {
      contributionKey: 'canary-skill-bundle',
      seamKey: 'skill-adapter.skill-bundle',
      seamVersion: '1.0.0',
      title: 'Canary Skill Bundle (advisory)',
      payload: {
        skillKey: 'skill-sw-dev',
        skillVersion: '1.0.0',
        lifecycleRef: 'active' as const,
        description: 'Canary advisory referencing official skill-sw-dev',
      },
    },
  ],
  permissions: [
    {
      permissionKey: 'aiproj.compiler-skill-view',
      seamKey: 'skill-adapter.skill-bundle',
      sideEffect: 'read-only',
      network: 'none',
      purpose: 'Advisory canary referencing existing Skill',
    },
  ],
}

export interface CanaryQueryResult {
  pluginId: typeof CANARY_QUERY_PLUGIN_ID
  contributionKey: 'canary-query-summary'
  advisory: true
  bounded: true
  providerCalls: 0
  draftPersisted: false
  data: {
    projectCount: number
    taskCount: number
    completedTaskCount: number
    previewTruncated: boolean
  }
  source: string
  timestamp: string
}

export const CANARY_QUERY_FIXTURE_RESULT: CanaryQueryResult = {
  pluginId: CANARY_QUERY_PLUGIN_ID,
  contributionKey: 'canary-query-summary',
  advisory: true,
  bounded: true,
  providerCalls: 0,
  draftPersisted: false,
  data: {
    projectCount: 3,
    taskCount: 42,
    completedTaskCount: 10,
    previewTruncated: false,
  },
  source: 'canary-query:canary-query-summary',
  timestamp: '2026-08-21T12:00:00.000Z',
}

export interface CanaryAdvisoryResult {
  pluginId: typeof CANARY_ADVISORY_PLUGIN_ID
  contributionKey: 'canary-skill-bundle'
  kind: 'advisory'
  bounded: true
  providerCalls: 0
  draftPersisted: false
  advisory: true
  draft: {
    title: string
    summary: string
    skillKey: 'skill-sw-dev'
    skillVersion: '1.0.0'
    truncated: boolean
  }
  source: string
  timestamp: string
}

export const CANARY_ADVISORY_FIXTURE_RESULT: CanaryAdvisoryResult = {
  pluginId: CANARY_ADVISORY_PLUGIN_ID,
  contributionKey: 'canary-skill-bundle',
  kind: 'advisory',
  bounded: true,
  providerCalls: 0,
  draftPersisted: false,
  advisory: true,
  draft: {
    title: '[Canary Advisory] 项目执行建议（预览，不自动落库）',
    summary: '基于 skill-sw-dev 的 advisory 预览，需经人工确认后方可落库；本执行不写正式业务表。',
    skillKey: 'skill-sw-dev',
    skillVersion: '1.0.0',
    truncated: false,
  },
  source: 'canary-advisory:canary-skill-bundle',
  timestamp: '2026-08-21T12:00:00.000Z',
}

export function isCanaryZeroNetworkManifest(manifest: PluginManifestV1): boolean {
  return manifest.permissions.every(
    (p) => p.network === 'none' || p.network === 'fixture-mock-only',
  )
}

export function assertCanaryZeroProviderCalls(result: { providerCalls: number }): boolean {
  return result.providerCalls === 0
}

export function assertCanaryNoFormalWrite(result: { draftPersisted: boolean }): boolean {
  return result.draftPersisted === false
}

export const CANARY_SENSITIVE_PATTERNS = [
  'token',
  'secret',
  'password',
  'apikey',
  'bearer',
  'credential',
] as const

export function canaryContainsSensitiveKey(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if ((CANARY_SENSITIVE_PATTERNS as readonly string[]).some((p) => lower.includes(p))) return true
    const val = (obj as Record<string, unknown>)[key]
    if (val && typeof val === 'object' && canaryContainsSensitiveKey(val)) return true
  }
  return false
}
