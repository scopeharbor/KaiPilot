/**
 * plugin-e2e-lifecycle-certification-fixtures —— V3 插件 E2E 生命周期认证夹具（W5c 任务 4.3）
 *
 * fixtures 覆盖：
 * - focused / release 完整报告（确定性、可复现、零网络、低敏）
 * - 脱敏前后对照、绝对路径 → 相对路径对照、失败复现命令对照
 * - 证据账本（空 / 单条 focused / 完整 release）
 * - 负例报告（跨租未阻断、残留、stale、缺必需步骤、sensitive 泄露）
 */

import {
  PLUGIN_E2E_SCHEMA_VERSION,
  type PluginE2ECertificationReport,
  type PluginE2ECertificationLedger,
  type PluginE2EStepResult,
  canonicalizeReport,
  createFocusedProfile,
  createReleaseProfile,
  createEmptyLedger,
  addReportToLedger,
} from './plugin-e2e-lifecycle-certification.js'

// =============================================================================
// 1. 基础步骤 helpers
// =============================================================================

function step(
  stepId: PluginE2EStepResult['stepId'],
  conclusion: PluginE2EStepResult['conclusion'],
  reasonCode: PluginE2EStepResult['reasonCode'],
  order: number,
  evidenceRef?: string,
): PluginE2EStepResult {
  return { stepId, conclusion, reasonCode, order, ...(evidenceRef ? { evidenceRef } : {}) }
}

// =============================================================================
// 2. Focused 报告（任务 4.1：PR 快速，仅 canary，稳定 JSON/JUnit）
// =============================================================================

const FOCUSED_STEPS: PluginE2EStepResult[] = [
  step('package-verification', 'pass', 'ok', 1, 'evidence:canary/package-verification.json'),
  step('install-preview', 'pass', 'ok', 2, 'evidence:canary/install-preview.json'),
  step('install-confirm', 'pass', 'ok', 3, 'evidence:canary/install-confirm.json'),
  step('permission-confirmation', 'pass', 'ok', 4, 'evidence:canary/permission-confirmation.json'),
  step('enable', 'pass', 'ok', 5, 'evidence:canary/enable.json'),
  step('execute', 'pass', 'ok', 6, 'evidence:canary/execute.json'),
  step('disable', 'pass', 'ok', 7, 'evidence:canary/disable.json'),
  step('uninstall', 'pass', 'ok', 8, 'evidence:canary/uninstall.json'),
  step('residue-inspection', 'pass', 'ok', 9, 'evidence:canary/residue-inspection.json'),
]

export const focusedPassRawReport: Omit<PluginE2ECertificationReport, 'digest' | 'reproCommand'> = {
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createFocusedProfile(),
  steps: FOCUSED_STEPS,
  conclusion: 'pass',
  counts: { total: 9, pass: 9, fail: 0, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
}

export const focusedPassReport: PluginE2ECertificationReport =
  canonicalizeReport(focusedPassRawReport)

// =============================================================================
// 3. Release 报告（任务 4.2：完整生命周期 + 跨租负例）
// =============================================================================

const RELEASE_STEPS: PluginE2EStepResult[] = [
  step('package-verification', 'pass', 'ok', 1, 'evidence:canary/package-verification.json'),
  step('install-preview', 'pass', 'ok', 2, 'evidence:canary/install-preview.json'),
  step('install-confirm', 'pass', 'ok', 3, 'evidence:canary/install-confirm.json'),
  step('permission-confirmation', 'pass', 'ok', 4, 'evidence:canary/permission-confirmation.json'),
  step('enable', 'pass', 'ok', 5, 'evidence:canary/enable.json'),
  step('execute', 'pass', 'ok', 6, 'evidence:canary/execute.json'),
  step('disable', 'pass', 'ok', 7, 'evidence:canary/disable.json'),
  step('upgrade', 'pass', 'ok', 8, 'evidence:canary/upgrade.json'),
  step('rollback', 'pass', 'ok', 9, 'evidence:canary/rollback.json'),
  step('uninstall', 'pass', 'ok', 10, 'evidence:canary/uninstall.json'),
  step('residue-inspection', 'pass', 'ok', 11, 'evidence:canary/residue-inspection.json'),
  // 负例（均需被阻断，故结论为 pass 表示“负例被正确拒绝”）
  step('undeclared-capability', 'pass', 'ok', 12, 'evidence:negative/undeclared-capability.json'),
  step(
    'permission-escalation-reconfirm',
    'pass',
    'ok',
    13,
    'evidence:negative/permission-escalation.json',
  ),
  step('preview-replay', 'pass', 'ok', 14, 'evidence:negative/preview-replay.json'),
  step('cross-org-access', 'pass', 'ok', 15, 'evidence:negative/cross-org.json'),
  step('cross-project-access', 'pass', 'ok', 16, 'evidence:negative/cross-project.json'),
  step('corrupted-package', 'pass', 'ok', 17, 'evidence:negative/corrupted-package.json'),
  step('timeout-crash', 'pass', 'ok', 18, 'evidence:negative/timeout-crash.json'),
  step('uninstall-residue', 'pass', 'ok', 19, 'evidence:negative/uninstall-residue.json'),
  step('stale-preview', 'pass', 'ok', 20, 'evidence:negative/stale-preview.json'),
  step('health-unavailable', 'pass', 'ok', 21, 'evidence:negative/health-unavailable.json'),
  step(
    'compatibility-unavailable',
    'pass',
    'ok',
    22,
    'evidence:negative/compatibility-unavailable.json',
  ),
  step('revoked-grant', 'pass', 'ok', 23, 'evidence:negative/revoked-grant.json'),
]

export const releasePassRawReport: Omit<PluginE2ECertificationReport, 'digest' | 'reproCommand'> = {
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createReleaseProfile(),
  steps: RELEASE_STEPS,
  conclusion: 'pass',
  counts: { total: 23, pass: 23, fail: 0, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
}

export const releasePassReport: PluginE2ECertificationReport =
  canonicalizeReport(releasePassRawReport)

// =============================================================================
// 4. 失败与负例报告（用于测试 fail-closed 与 repro 命令）
// =============================================================================

export const failedCrossTenantReport: PluginE2ECertificationReport = canonicalizeReport({
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createReleaseProfile(),
  steps: RELEASE_STEPS.map((s) =>
    s.stepId === 'cross-org-access'
      ? { ...s, conclusion: 'fail' as const, reasonCode: 'cross-tenant-block-missing' as const }
      : s,
  ),
  conclusion: 'fail',
  blockingReason: 'cross-tenant-block-missing',
  counts: { total: 23, pass: 22, fail: 1, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
})

export const failedResidueReport: PluginE2ECertificationReport = canonicalizeReport({
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createReleaseProfile(),
  steps: RELEASE_STEPS.map((s) =>
    s.stepId === 'residue-inspection'
      ? { ...s, conclusion: 'fail' as const, reasonCode: 'residue-found' as const }
      : s,
  ),
  conclusion: 'fail',
  blockingReason: 'residue-found',
  counts: { total: 23, pass: 22, fail: 1, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
})

export const failedMissingRequiredStepReport: PluginE2ECertificationReport = canonicalizeReport({
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createReleaseProfile(),
  steps: RELEASE_STEPS.filter((s) => s.stepId !== 'rollback').map((s, idx) => ({
    ...s,
    order: idx + 1,
  })),
  conclusion: 'fail',
  blockingReason: 'missing-required-step',
  counts: { total: 22, pass: 22, fail: 0, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
})

export const failedStaleEvidenceReport: PluginE2ECertificationReport = canonicalizeReport({
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createReleaseProfile(),
  steps: RELEASE_STEPS.map((s) =>
    s.stepId === 'install-preview'
      ? { ...s, conclusion: 'fail' as const, reasonCode: 'stale-evidence' as const }
      : s,
  ),
  conclusion: 'fail',
  blockingReason: 'stale-evidence',
  counts: { total: 23, pass: 22, fail: 1, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
})

// =============================================================================
// 5. 脱敏 / 路径稳定性对照 fixtures（任务 4.3）
// =============================================================================

export const sensitiveLeakageRawReportInput: Record<string, unknown> = {
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createFocusedProfile(),
  steps: [
    {
      stepId: 'package-verification',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 1,
      evidenceRef: 'evidence:canary/package.json',
      details: 'Authorization: Bearer sk-1234567890abcdef12345',
    },
  ],
  conclusion: 'pass',
  counts: { total: 1, pass: 1, fail: 0, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
  // 顶层敏感字段（应被脱敏）
  token: 'sk-1234567890abcdef1234567890',
  secret: 'my-secret-value',
}

export const absolutePathRawReportInput: Record<string, unknown> = {
  schemaVersion: PLUGIN_E2E_SCHEMA_VERSION,
  hostRef: 'host:linux-node20-canary',
  pluginId: 'com.aiproj.canary-query',
  pluginVersion: '1.0.0',
  profile: createFocusedProfile(),
  steps: [
    {
      stepId: 'package-verification',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 1,
      evidenceRef: '/abs/path/to/evidence.json',
    },
    {
      stepId: 'install-preview',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 2,
      evidenceRef: 'C:\\abs\\windows\\evidence.json',
    },
    {
      stepId: 'install-confirm',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 3,
      evidenceRef: 'https://example.com/evidence.json',
    },
    {
      stepId: 'permission-confirmation',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 4,
      evidenceRef: '/abs/evidence/permission.json',
    },
    {
      stepId: 'enable',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 5,
      evidenceRef: 'evidence:canary/enable.json',
    },
    {
      stepId: 'execute',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 6,
      evidenceRef: 'evidence:canary/execute.json',
    },
    {
      stepId: 'disable',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 7,
      evidenceRef: 'evidence:canary/disable.json',
    },
    {
      stepId: 'uninstall',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 8,
      evidenceRef: 'evidence:canary/uninstall.json',
    },
    {
      stepId: 'residue-inspection',
      conclusion: 'pass',
      reasonCode: 'ok',
      order: 9,
      evidenceRef: '/abs/residue.json',
    },
  ],
  conclusion: 'pass',
  counts: { total: 9, pass: 9, fail: 0, notRun: 0, degraded: 0 },
  generatedAt: '2026-08-21T12:00:00.000Z',
  fixtureRef: 'fixture:canary-query-v1',
}

// =============================================================================
// 6. 证据账本 fixtures（任务 4.3：报告纳入证据账本）
// =============================================================================

export const emptyLedger: PluginE2ECertificationLedger = createEmptyLedger()

export const focusedLedger: PluginE2ECertificationLedger = addReportToLedger(
  emptyLedger,
  focusedPassReport,
)

export const releaseLedger: PluginE2ECertificationLedger = addReportToLedger(
  addReportToLedger(emptyLedger, focusedPassReport),
  releasePassReport,
)

export const failedLedger: PluginE2ECertificationLedger = addReportToLedger(
  emptyLedger,
  failedCrossTenantReport,
)

// =============================================================================
// 7. Repro 命令期望（任务 4.3）
// =============================================================================

export const expectedFocusedReproPrefix =
  'pnpm exec tsx scripts/plugin-e2e-certification.ts --profile focused'
export const expectedReleaseReproPrefix =
  'pnpm exec tsx scripts/plugin-e2e-certification.ts --profile release'

// =============================================================================
// 8. 聚合导出（便于测试枚举）
// =============================================================================

export const allPassReports = [focusedPassReport, releasePassReport] as const
export const allFailedReports = [
  failedCrossTenantReport,
  failedResidueReport,
  failedMissingRequiredStepReport,
  failedStaleEvidenceReport,
] as const
