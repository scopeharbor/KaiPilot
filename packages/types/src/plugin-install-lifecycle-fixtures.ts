/**
 * plugin-install-lifecycle-fixtures —— 安装生命周期测试与冒烟测试夹具。
 * 覆盖五态、预览-确认正常与异常场景、脱敏审计等。
 */

import {
  computeInstallPreviewDigest,
  computePermissionDigest,
  type PluginInstallCommandPreview,
  type PluginInstallConfirmRequest,
  type PluginInstallationRecord,
  type PluginPermissionConfirmationSummary,
} from './plugin-install-lifecycle.js'

export const PLUGIN_INSTALL_FIXTURE_ORG_ID = '1'
export const FIXTURE_ACTOR_ID = 'user-admin-42'
export const FIXTURE_PLUGIN_ID = 'org.example.dev-toolkit'
export const FIXTURE_RELEASE_ID = 'rel-uuid-001'
export const FIXTURE_VERSION = '1.2.0'
export const FIXTURE_UPGRADE_VERSION = '1.3.0'
export const FIXTURE_UPGRADE_RELEASE_ID = 'rel-uuid-002'

export const FIXTURE_PERMISSIONS = [
  {
    permissionKey: 'compiler:skill:view',
    seamKey: 'skill-adapter.skill-bundle',
    sideEffect: 'read-only',
    network: 'none',
    purpose: 'View compiler skills',
  },
  {
    permissionKey: 'compiler:run:view',
    seamKey: 'compiler-contribution.context-contribution',
    sideEffect: 'advisory',
    network: 'none',
    purpose: 'Provide contextual advice',
  },
] as const

export const FIXTURE_PERMISSION_DIGEST = computePermissionDigest(FIXTURE_PERMISSIONS)

export const FIXTURE_CONFIRMATION_SUMMARY: PluginPermissionConfirmationSummary = {
  confirmedBy: FIXTURE_ACTOR_ID,
  permissionDigest: FIXTURE_PERMISSION_DIGEST,
  permissionKeys: ['compiler:run:view', 'compiler:skill:view'],
  confirmedAt: '2026-08-19T10:00:00.000Z',
}

// 1. 已安装（未启用）记录
export const fixtureInstalledRecord: PluginInstallationRecord = {
  id: 'inst-001',
  organizationId: PLUGIN_INSTALL_FIXTURE_ORG_ID,
  pluginId: FIXTURE_PLUGIN_ID,
  version: FIXTURE_VERSION,
  releaseId: FIXTURE_RELEASE_ID,
  status: 'installed',
  permissionConfirmation: null,
  packageDigest: 'pkg-sha256-abc123',
  manifestDigest: 'man-sha256-def456',
  compatibilityDigest: 'compat-sha256-789xyz',
  rowVersion: 1,
  createdAt: '2026-08-19T09:00:00.000Z',
  updatedAt: '2026-08-19T09:00:00.000Z',
  uninstalledAt: null,
}

// 2. 已启用记录
export const fixtureEnabledRecord: PluginInstallationRecord = {
  ...fixtureInstalledRecord,
  status: 'enabled',
  permissionConfirmation: FIXTURE_CONFIRMATION_SUMMARY,
  rowVersion: 2,
  updatedAt: '2026-08-19T10:00:00.000Z',
}

// 3. 停用回落记录（status 回落到 installed，permissionConfirmation 变 null）
export const fixtureDisabledRecord: PluginInstallationRecord = {
  ...fixtureInstalledRecord,
  status: 'installed',
  permissionConfirmation: null,
  rowVersion: 3,
  updatedAt: '2026-08-19T11:00:00.000Z',
}

// 4. 已卸载记录（status 为 uninstalled，uninstalledAt 有值）
export const fixtureUninstalledRecord: PluginInstallationRecord = {
  ...fixtureInstalledRecord,
  status: 'uninstalled',
  permissionConfirmation: null,
  rowVersion: 4,
  updatedAt: '2026-08-19T12:00:00.000Z',
  uninstalledAt: '2026-08-19T12:00:00.000Z',
}

// 5. 生成预览 fixture 的辅助函数
export function createFixturePreview(
  overrides?: Partial<PluginInstallCommandPreview>,
): PluginInstallCommandPreview {
  const base = {
    organizationId: PLUGIN_INSTALL_FIXTURE_ORG_ID,
    actorRef: FIXTURE_ACTOR_ID,
    action: 'install' as const,
    pluginId: FIXTURE_PLUGIN_ID,
    pluginName: 'Dev Toolkit',
    targetVersion: FIXTURE_VERSION,
    releaseId: FIXTURE_RELEASE_ID,
    currentStatus: 'not_installed' as const,
    targetStatus: 'installed' as const,
    sourceHash: 'source-hash-001',
    affectedContributions: [
      {
        contributionKey: 'dev-skill-bundle',
        seamKey: 'skill-adapter.skill-bundle',
        seamVersion: '1.0.0',
        skillKeyRef: 'dev-patterns',
      },
    ],
    requestedPermissions: FIXTURE_PERMISSIONS,
    permissionDigest: FIXTURE_PERMISSION_DIGEST,
    ttlSeconds: 300,
    createdAt: '2026-08-19T09:00:00.000Z',
    expiresAt: '2026-08-19T09:05:00.000Z',
    ...overrides,
  }

  const previewDigest = computeInstallPreviewDigest(base)
  return {
    ...base,
    previewHandle: `prev-handle-${previewDigest.slice(0, 8)}`,
    previewDigest,
  }
}

export function createFixtureEnablePreview(): PluginInstallCommandPreview {
  return createFixturePreview({
    action: 'enable',
    currentVersion: FIXTURE_VERSION,
    currentStatus: 'installed',
    targetStatus: 'enabled',
  })
}

export function createFixtureConfirmRequest(
  preview: PluginInstallCommandPreview,
  overrides?: Partial<PluginInstallConfirmRequest>,
): PluginInstallConfirmRequest {
  return {
    previewHandle: preview.previewHandle,
    previewDigest: preview.previewDigest,
    permissionConfirmed: preview.action === 'enable' ? true : undefined,
    permissionDigest: preview.action === 'enable' ? preview.permissionDigest : undefined,
    ...overrides,
  }
}
