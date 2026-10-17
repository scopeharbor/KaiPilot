/**
 * plugin-manifest-fixtures.ts —— V3 plugin manifest 契约测试夹具
 *
 * 覆盖：合法 manifest、非法 manifest（所有 blocking rule families）、
 * grant fixtures、sensitive value fixtures。
 */

import { MANIFEST_SCHEMA_VERSION } from './plugin-manifest.js'
import type {
  PluginManifestV1,
  PluginPermissionGrantSnapshot,
  PluginManifestValidationContext,
  PluginPermissionVocabularyEntry,
  PluginCatalogSnapshotEntry,
} from './plugin-manifest.js'

// =============================================================================
// 1. 合法 manifest fixtures
// =============================================================================

/** 最小合法 manifest。 */
export const VALID_MANIFEST_MINIMAL: PluginManifestV1 = {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  identity: {
    pluginId: 'test.minimal',
    name: 'Minimal Plugin',
    version: '1.0.0',
    publisher: 'test-org',
  },
  provenance: {
    distribution: 'first-party',
  },
  compatibility: {
    hostContractVersion: '1.0',
    requiredSeams: [],
  },
  contributions: [],
  permissions: [],
}

/** 完整合法 manifest。 */
export const VALID_MANIFEST_FULL: PluginManifestV1 = {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  identity: {
    pluginId: 'acme.full-plugin',
    name: 'Full Plugin',
    version: '2.1.0',
    publisher: 'acme-corp',
    description: 'A complete test plugin with all fields',
  },
  provenance: {
    distribution: 'organization-private',
    sourceRef: 'repo:github.com/acme/plugin@abc123',
  },
  compatibility: {
    hostContractVersion: '1.0',
    requiredSeams: [
      { seamKey: 'skill-adapter', seamVersion: '1.0.0' },
      { seamKey: 'server-query', seamVersion: '1.1.0' },
    ],
  },
  contributions: [
    {
      contributionKey: 'acme.skill-contribution',
      seamKey: 'skill-adapter',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'esm', path: 'src/skill-provider.ts' },
      permissionRefs: ['acme.read-data'],
    },
    {
      contributionKey: 'acme.query-contribution',
      seamKey: 'server-query',
      seamVersion: '1.1.0',
      entrypoint: { kind: 'esm', path: 'src/query-handler.ts' },
      permissionRefs: ['acme.read-data'],
    },
  ],
  permissions: [
    {
      permissionKey: 'acme.read-data',
      seamKey: 'skill-adapter',
      scopeKind: 'organization',
      resourceRef: 'project.tasks',
      actionRef: 'read',
      sideEffect: 'read-only',
      confirmation: 'not-required',
      network: 'none',
      purpose: 'read task data for skill analysis',
    },
  ],
  dependencies: [
    { pluginId: 'dep.analytics', versionRequirement: '1.0.0' },
    { pluginId: 'dep.export', versionRequirement: '2.0.0' },
  ],
  contentDescriptor: {
    algorithm: 'sha256',
    digest: 'a'.repeat(64),
  },
  extensions: {
    'acme.internal': { note: 'custom metadata' },
  },
}

/** organization-private distribution。 */
export const VALID_MANIFEST_ORG_PRIVATE: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  identity: { ...VALID_MANIFEST_MINIMAL.identity, pluginId: 'org.private-plugin' },
  provenance: { distribution: 'organization-private' },
}

// =============================================================================
// 2. 非法 manifest fixtures（每个 blocking rule family 至少一个）
// =============================================================================

/** 未知 schema 版本。 */
export const INVALID_MANIFEST_UNKNOWN_SCHEMA: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  manifestSchemaVersion: '2.0' as any,
}

/** 无效 pluginId（大写）。 */
export const INVALID_MANIFEST_BAD_PLUGIN_ID: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  identity: { ...VALID_MANIFEST_MINIMAL.identity, pluginId: 'UPPERCASE' },
}

/** 无效 SemVer。 */
export const INVALID_MANIFEST_BAD_SEMVER: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  identity: { ...VALID_MANIFEST_MINIMAL.identity, version: 'latest' },
}

/** 未授权 distribution。 */
export const INVALID_MANIFEST_PUBLIC_DISTRIBUTION: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  provenance: { distribution: 'public-marketplace' },
}

/** 未知 seam。 */
export const INVALID_MANIFEST_UNKNOWN_SEAM: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  compatibility: {
    hostContractVersion: '1.0',
    requiredSeams: [{ seamKey: 'nonexistent', seamVersion: '1.0.0' }],
  },
}

/** 重复 contribution key。 */
export const INVALID_MANIFEST_DUPLICATE_CONTRIBUTION: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  contributions: [
    {
      contributionKey: 'dup.key',
      seamKey: 'skill-adapter',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'esm', path: 'src/a.ts' },
    },
    {
      contributionKey: 'dup.key',
      seamKey: 'skill-adapter',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'esm', path: 'src/b.ts' },
    },
  ],
}

/** 隐式 global scope。 */
export const INVALID_MANIFEST_GLOBAL_SCOPE: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  permissions: [
    {
      permissionKey: 'test.global',
      seamKey: 'skill-adapter',
      scopeKind: 'organization' as any,
      sideEffect: 'advisory',
      confirmation: 'not-required',
      network: 'none',
    },
  ],
}

/** manifest 包含 organizationId。 */
export const INVALID_MANIFEST_ORG_ID_LEAK: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  extensions: {
    organizationId: 'org_123',
  },
}

/** traversal entrypoint。 */
export const INVALID_MANIFEST_TRAVERSAL: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  contributions: [
    {
      contributionKey: 'test.traversal',
      seamKey: 'skill-adapter',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'esm', path: '../../escape/file.ts' },
    },
  ],
}

/** 自依赖。 */
export const INVALID_MANIFEST_SELF_DEPENDENCY: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  identity: { ...VALID_MANIFEST_MINIMAL.identity, pluginId: 'test.minimal' },
  dependencies: [{ pluginId: 'test.minimal', versionRequirement: '1.0.0' }],
}

/** 重复依赖。 */
export const INVALID_MANIFEST_DUPLICATE_DEP: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  dependencies: [
    { pluginId: 'dep.dup', versionRequirement: '1.0.0' },
    { pluginId: 'dep.dup', versionRequirement: '2.0.0' },
  ],
}

/** URL dependency。 */
export const INVALID_MANIFEST_URL_DEP: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  dependencies: [{ pluginId: 'dep.url', versionRequirement: 'https://evil.com' }],
}

/** raw secret value。 */
export const INVALID_MANIFEST_RAW_SECRET: PluginManifestV1 = {
  ...VALID_MANIFEST_MINIMAL,
  extensions: {
    token: 'sk_abc123456789012345678',
  },
}

/** 多个 errors 输入。 */
export const INVALID_MANIFEST_MULTI_ERROR: PluginManifestV1 = {
  manifestSchemaVersion: '3.0' as any,
  identity: { pluginId: 'X', name: '', version: 'bad', publisher: 'Y' },
  provenance: { distribution: 'public-marketplace' },
  compatibility: { hostContractVersion: '1.0', requiredSeams: [] },
  contributions: [],
  permissions: [],
}

// =============================================================================
// 3. Grant fixtures
// =============================================================================

/** 合法 grant。 */
export function makeValidGrant(
  manifestDigest: string,
  pluginId: string,
): PluginPermissionGrantSnapshot {
  return {
    grantId: 'grant-valid-1',
    manifestDigest,
    pluginId,
    scopeBinding: { organizationIdHash: 'org-hash-1' },
    grantedPermissions: [],
    decisionRef: 'decision:granted:2026-08-16',
  }
}

/** 权限升级 grant。 */
export function makeEscalationGrant(
  manifestDigest: string,
  pluginId: string,
): PluginPermissionGrantSnapshot {
  return {
    grantId: 'grant-escalation-1',
    manifestDigest,
    pluginId,
    scopeBinding: { organizationIdHash: 'org-hash-1' },
    grantedPermissions: ['nonexistent.permission'],
  }
}

// =============================================================================
// 4. Catalog / context fixtures
// =============================================================================

/** 最小合法 catalog entry。 */
export function makeCatalogEntry(
  overrides?: Partial<PluginCatalogSnapshotEntry>,
): PluginCatalogSnapshotEntry {
  return {
    seamVersion: '1.0.0',
    availability: 'cataloged',
    surface: 'skill-adapter',
    requiredPermissions: [],
    scopeModes: ['organization', 'project'],
    sideEffectCeiling: 'external-action',
    confirmationCeiling: 'host-brokered',
    networkCeiling: 'direct-allowed',
    ...overrides,
  }
}

/** 最小合法 permission vocabulary entry。 */
export function makePermissionVocabularyEntry(
  overrides?: Partial<PluginPermissionVocabularyEntry>,
): PluginPermissionVocabularyEntry {
  return {
    seamKey: 'skill-adapter',
    maxScopeKind: 'organization',
    maxSideEffect: 'advisory',
    maxConfirmation: 'not-required',
    maxNetwork: 'none',
    ...overrides,
  }
}

/** 最小合法 validation context。 */
export function makeValidationContext(
  catalog?: Record<string, PluginCatalogSnapshotEntry>,
  vocabulary?: Record<string, PluginPermissionVocabularyEntry>,
): PluginManifestValidationContext {
  return {
    hostContractVersion: '1.0',
    seamCatalog: catalog ?? {
      'skill-adapter': makeCatalogEntry(),
    },
    permissionVocabulary: vocabulary ?? {},
    allowedDistributions: ['first-party', 'organization-private'],
  }
}

// =============================================================================
// 5. Sensitive value fixtures
// =============================================================================

export const SENSITIVE_VALUES = [
  'sk_abc123456789012345678',
  'Bearer eyJhbGciOiJIUzI1NiJ9',
  'ghp_abc123456789012345678',
  'sk-proj-abc123456789012345678',
]

export const SENSITIVE_KEYS = [
  'token',
  'secret',
  'apiKey',
  'password',
  'authorization',
  'private_key',
  'credential',
]

export const NON_SENSITIVE_VALUES = [
  'normal text',
  'fixture:valid-manifest',
  'sha256:abcdef',
  '12345',
]

export const NON_SENSITIVE_KEYS = ['name', 'version', 'description', 'pluginId', 'path']
