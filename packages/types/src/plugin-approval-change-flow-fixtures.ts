/**
 * plugin-approval-change-flow-fixtures —— 统一变更请求状态机测试夹具。
 * 覆盖三类 kind、九态、handle 签发/过期/stale、权限差异与敏感样本。
 */

import {
  buildChangeConfirmHandle,
  computeChangeDiffDigest,
  computePermissionDelta,
  type PluginChangeCanonicalDiff,
  type PluginChangeConfirmHandle,
  type PluginChangeRequestRecord,
} from './plugin-approval-change-flow.js'

export const CHANGE_FIXTURE_ORG_ID = '1'
export const CHANGE_FIXTURE_ACTOR = 'user-maker-7'
export const CHANGE_FIXTURE_CHECKER = 'user-checker-9'
export const CHANGE_FIXTURE_PLUGIN_ID = 'org.example.dev-toolkit'
export const CHANGE_FIXTURE_NOW_ISO = '2026-08-24T10:00:00.000Z'
export const CHANGE_FIXTURE_EXPIRES_ISO = '2026-08-24T10:10:00.000Z'

/** install 类 canonical diff（无既有安装）。 */
export function fixtureInstallDiff(): PluginChangeCanonicalDiff {
  return {
    kind: 'install',
    pluginId: CHANGE_FIXTURE_PLUGIN_ID,
    installStatusBefore: 'not_installed',
    installStatusAfter: 'installed',
    versionDelta: {
      currentVersion: null,
      targetVersion: '1.2.0',
      currentReleaseId: null,
      targetReleaseId: 101,
    },
    permissionDelta: computePermissionDelta([], ['compiler:skill:view', 'compiler:run:view']),
    compatibilityDigestBefore: null,
    compatibilityDigestAfter: 'compat-digest-001',
  }
}

/** permission-upgrade 类 canonical diff（新增一条权限）。 */
export function fixturePermissionUpgradeDiff(): PluginChangeCanonicalDiff {
  return {
    kind: 'permission-upgrade',
    pluginId: CHANGE_FIXTURE_PLUGIN_ID,
    installStatusBefore: 'enabled',
    installStatusAfter: 'enabled',
    versionDelta: {
      currentVersion: '1.2.0',
      targetVersion: '1.3.0',
      currentReleaseId: 101,
      targetReleaseId: 102,
    },
    permissionDelta: computePermissionDelta(
      ['compiler:skill:view', 'compiler:run:view'],
      ['compiler:skill:view', 'compiler:run:view', 'ocr:file:read'],
    ),
    compatibilityDigestBefore: 'compat-digest-001',
    compatibilityDigestAfter: 'compat-digest-002',
  }
}

/** version-upgrade 类 canonical diff（权限不变）。 */
export function fixtureVersionUpgradeDiff(): PluginChangeCanonicalDiff {
  return {
    kind: 'version-upgrade',
    pluginId: CHANGE_FIXTURE_PLUGIN_ID,
    installStatusBefore: 'enabled',
    installStatusAfter: 'enabled',
    versionDelta: {
      currentVersion: '1.2.0',
      targetVersion: '1.2.1',
      currentReleaseId: 101,
      targetReleaseId: 103,
    },
    permissionDelta: computePermissionDelta(
      ['compiler:skill:view', 'compiler:run:view'],
      ['compiler:skill:view', 'compiler:run:view'],
    ),
    compatibilityDigestBefore: 'compat-digest-001',
    compatibilityDigestAfter: 'compat-digest-001',
  }
}

/** 构造请求记录 fixture。 */
export function createFixtureChangeRequest(
  overrides?: Partial<PluginChangeRequestRecord>,
): PluginChangeRequestRecord {
  const diff = overrides?.diff ?? fixturePermissionUpgradeDiff()
  return {
    id: 'chg-req-0001',
    organizationId: CHANGE_FIXTURE_ORG_ID,
    projectId: null,
    kind: diff.kind,
    state: 'awaiting-confirmation',
    pluginId: diff.pluginId,
    requestedBy: CHANGE_FIXTURE_ACTOR,
    targetRevision: 'release-102',
    diff,
    diffDigest: computeChangeDiffDigest(diff),
    permissionDigest: 'perm-digest-fixture',
    compatibilityDigest: 'compat-digest-002',
    approvalRequired: true,
    approvedBy: CHANGE_FIXTURE_CHECKER,
    rowVersion: 2,
    expiresAt: CHANGE_FIXTURE_EXPIRES_ISO,
    createdAt: '2026-08-24T09:58:00.000Z',
    updatedAt: '2026-08-24T09:59:00.000Z',
    ...overrides,
  }
}

/** 从请求记录签发确认句柄 fixture。 */
export function createFixtureHandle(
  request: PluginChangeRequestRecord,
  overrides?: Partial<Parameters<typeof buildChangeConfirmHandle>[0]>,
): PluginChangeConfirmHandle {
  return buildChangeConfirmHandle({
    requestId: request.id,
    organizationId: request.organizationId,
    projectId: request.projectId,
    actorRef: request.requestedBy,
    rowVersion: request.rowVersion,
    targetRevision: request.targetRevision,
    diffDigest: request.diffDigest,
    permissionDigest: request.permissionDigest,
    compatibilityDigest: request.compatibilityDigest,
    nowIso: CHANGE_FIXTURE_NOW_ISO,
    ttlSeconds: 600,
    ...overrides,
  })
}

/** 含敏感字段的请求样本（用于脱敏测试）。 */
export const SENSITIVE_CHANGE_SAMPLE = {
  requestId: 'chg-req-sensitive',
  apiToken: 'sk_abcdefghijklmnopqrstuvwxyz123456',
  authorizationHeader: 'Bearer abcdef123456789',
  nested: {
    clientSecret: 'should-be-dropped',
    note: 'normal value',
  },
}
