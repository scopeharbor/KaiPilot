/**
 * local-plugin-developer-kit-fixtures —— V3 本机插件开发套件测试夹具
 * （声明式本机数据，无可执行、真实外部配置、无敏感值）。
 */

import {
  LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
  LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION,
  LOCAL_PLUGIN_INSTALL_PLAN_SCHEMA_VERSION,
  type LocalPluginDevFinding,
  type LocalPluginDevReport,
  type LocalPluginHostProfileV1,
  type LocalPluginInstallPlanV1,
  type LocalPluginDiagnosticsSummary,
} from './local-plugin-developer-kit.js'
import { MANIFEST_SCHEMA_VERSION } from './plugin-manifest.js'

// =============================================================================
// 1. 合法 Host Profile 夹具
// =============================================================================

export const VALID_HOST_PROFILE_NOT_INSTALLED: LocalPluginHostProfileV1 = {
  schemaVersion: LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION,
  kind: 'local-plugin-host-profile-v1',
  hostContractVersion: '1.0',
  catalogDigest: 'a20e3f11',
  currentStatus: 'not_installed',
  allowedScopeKinds: ['organization'],
  referenceTime: '2026-08-21T00:00:00.000Z',
}

export const VALID_HOST_PROFILE_INSTALLED: LocalPluginHostProfileV1 = {
  ...VALID_HOST_PROFILE_NOT_INSTALLED,
  currentStatus: 'installed',
  approvedReleaseDigest: 'abc123',
  approvedReleaseVersion: '1.0.0',
}

export const VALID_HOST_PROFILE_ENABLED: LocalPluginHostProfileV1 = {
  ...VALID_HOST_PROFILE_NOT_INSTALLED,
  currentStatus: 'enabled',
}

// =============================================================================
// 2. 非法 Host Profile 夹具
// =============================================================================

export const INVALID_HOST_PROFILE_MISSING_FIELD: unknown = {
  schemaVersion: LOCAL_PLUGIN_HOST_PROFILE_SCHEMA_VERSION,
  kind: 'local-plugin-host-profile-v1',
  // missing hostContractVersion
  catalogDigest: 'abc',
  currentStatus: 'not_installed',
  allowedScopeKinds: ['organization'],
  referenceTime: '2026-08-21T00:00:00.000Z',
}

export const INVALID_HOST_PROFILE_AUTHORITY_CLAIM: unknown = {
  ...VALID_HOST_PROFILE_NOT_INSTALLED,
  organizationId: 'org_123',
}

export const INVALID_HOST_PROFILE_SENSITIVE: unknown = {
  ...VALID_HOST_PROFILE_NOT_INSTALLED,
  // @ts-ignore injection
  token: 'sk_abc123456789012345678',
}

export const INVALID_HOST_PROFILE_UNKNOWN_FIELD: unknown = {
  ...VALID_HOST_PROFILE_NOT_INSTALLED,
  unknownField: 'evil',
}

// =============================================================================
// 3. 合法 Install Plan 夹具（由 buildLocalInstallDryRun 产生，此处手写示例）
// =============================================================================

export const VALID_INSTALL_PLAN_INSTALL: LocalPluginInstallPlanV1 = {
  schemaVersion: LOCAL_PLUGIN_INSTALL_PLAN_SCHEMA_VERSION,
  kind: 'local-plugin-install-plan-v1',
  action: 'install',
  currentStatus: 'not_installed',
  targetStatus: 'installed',
  affectedContributions: [],
  requestedPermissions: [],
  catalogDigest: 'a20e3f11',
  warnings: [],
  blockers: [],
  planDigest: 'deadbeef',
  confirmable: false,
  generatedAt: '2026-08-21T00:00:00.000Z',
}

// =============================================================================
// 4. 合法 Report 夹具
// =============================================================================

export const VALID_DEV_REPORT_PASSED: LocalPluginDevReport = {
  schemaVersion: LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
  kind: 'local-plugin-dev-report-v1',
  reportId: 'validate-2026-08-21T00:00:00-000Z',
  generatedAt: '2026-08-21T00:00:00.000Z',
  commit: 'abc123',
  command: 'validate',
  status: 'passed',
  phase: 'manifest',
  findings: [],
  counts: { total: 0, blocking: 0, warning: 0, info: 0, omitted: 0 },
  resultDigest: 'abcd1234',
  trustedAudit: false,
  omittedCounts: {},
}

export const VALID_DEV_REPORT_BLOCKING: LocalPluginDevReport = {
  ...VALID_DEV_REPORT_PASSED,
  reportId: 'validate-2026-08-21T00:00:01-000Z',
  status: 'blocking',
  findings: [
    {
      code: 'dev-validate-manifest-invalid',
      severity: 'blocking',
      phase: 'manifest',
      fieldPath: '$.identity.pluginId',
    },
  ],
  counts: { total: 1, blocking: 1, warning: 0, info: 0, omitted: 0 },
}

export const VALID_DEV_REPORT_WARNING_ONLY: LocalPluginDevReport = {
  ...VALID_DEV_REPORT_PASSED,
  reportId: 'validate-2026-08-21T00:00:02-000Z',
  status: 'passed',
  findings: [
    {
      code: 'dev-tool-budget-exceeded',
      severity: 'warning',
      phase: 'input',
      fieldPath: '$.plugin',
    },
  ],
  counts: { total: 1, blocking: 0, warning: 1, info: 0, omitted: 0 },
}

// =============================================================================
// 5. Manifest 夹具（复用 plugin-manifest 的 VALID/INVALID，但此处声明式）
// =============================================================================

export const VALID_MANIFEST_FOR_DEV_KIT: unknown = {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  identity: {
    pluginId: 'com.aiproj.example.local-dev-demo',
    name: 'Local Dev Demo',
    version: '1.0.0',
    publisher: 'aiproj-official',
  },
  provenance: { distribution: 'first-party' },
  compatibility: { hostContractVersion: '1.0', requiredSeams: [] },
  contributions: [],
  permissions: [],
}

export const INVALID_MANIFEST_WITH_TRAVERSAL: unknown = {
  manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
  identity: {
    pluginId: 'com.aiproj.bad',
    name: 'Bad',
    version: '1.0.0',
    publisher: 'aiproj-official',
  },
  provenance: { distribution: 'first-party' },
  compatibility: { hostContractVersion: '1.0', requiredSeams: [] },
  contributions: [
    {
      contributionKey: 'bad.traversal',
      seamKey: 'skill-adapter',
      seamVersion: '1.0.0',
      entrypoint: { kind: 'esm', path: '../../escape.ts' },
    },
  ],
  permissions: [],
}

// =============================================================================
// 6. Diagnostics Summary 夹具
// =============================================================================

export const VALID_DIAGNOSTICS_SUMMARY: LocalPluginDiagnosticsSummary = {
  schemaVersion: LOCAL_PLUGIN_DEV_REPORT_SCHEMA_VERSION,
  kind: 'local-plugin-diagnostics-summary-v1',
  generatedAt: '2026-08-21T00:00:00.000Z',
  totalReports: 2,
  totalFindings: 1,
  blockingCount: 1,
  warningCount: 0,
  byCommand: { validate: 1, 'install-dry-run': 1 },
  byPhase: { manifest: 1 },
  byCode: { 'dev-validate-manifest-invalid': 1 },
  bySeverity: { blocking: 1 },
  topFindings: [{ code: 'dev-validate-manifest-invalid', severity: 'blocking', phase: 'manifest' }],
  sourceDigests: ['abcd1234', 'efgh5678'],
  omittedCounts: {},
  trustedAudit: false,
  digest: 'deadbeef',
}

// =============================================================================
// 7. 敏感值/非敏感值
// =============================================================================

export const SENSITIVE_FINDING_WITH_TOKEN: LocalPluginDevFinding = {
  code: 'dev-tool-error',
  severity: 'blocking',
  phase: 'tool-error',
  message: 'failed with token sk_abc123456789012345678 Bearer eyJhbGciOiJIUzI1NiJ9',
  evidenceRef: 'https://evil.com/secret?token=sk_abc123456789012345678',
}

export const LONG_FINDING: LocalPluginDevFinding = {
  code: 'dev-tool-error',
  severity: 'blocking',
  phase: 'tool-error',
  message: 'a'.repeat(5000),
}
