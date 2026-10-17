/**
 * plugin-action-preview-boundary —— 确定性 fixtures（正负例）。
 *
 * 全部时间字段使用固定 ISO 字符串、全部 digest 可离线复算；
 * 负例覆盖：未知 kind / 未知字段 / 超大载荷 / 敏感材料 / 非 host-core adapter /
 * 禁止属性描述符 / 跨 scope 句柄 / 过期句柄。
 */

import type {
  PluginActionConfirmHandle,
  PluginActionPreview,
  PluginActionProposal,
  PluginActionScope,
  PluginActionSourceRef,
} from './plugin-action-preview-boundary.js'
import {
  buildPluginActionConfirmHandle,
  computeProposalDigest,
  computePreviewDigest,
  PLUGIN_ACTION_SCHEMA_VERSION,
} from './plugin-action-preview-boundary.js'

/** 固定测试时钟。 */
export const ACTION_FIXTURE_NOW_ISO = '2026-08-24T08:00:00.000Z'
export const ACTION_FIXTURE_CAPTURED_AT = '2026-08-24T07:59:00.000Z'

export function fixtureActionScope(overrides?: Partial<PluginActionScope>): PluginActionScope {
  return { organizationId: 1, projectId: null, ...overrides }
}

export function fixturePilotSourceRef(
  overrides?: Partial<PluginActionSourceRef>,
): PluginActionSourceRef {
  return {
    surface: 'server-hook',
    pluginId: 'com.aiproj.pilot.actions',
    pluginVersion: '1.0.0',
    installationId: 101,
    contributionKey: 'pilot-item-create',
    contentDigest: 'aa11bb22',
    capturedAt: ACTION_FIXTURE_CAPTURED_AT,
    ...overrides,
  }
}

/** 合法 pilot 提案（title/content 均干净）。 */
export function fixturePilotProposal(
  overrides?: Partial<Omit<PluginActionProposal, 'schemaVersion' | 'actionKind'>>,
): PluginActionProposal {
  return {
    schemaVersion: PLUGIN_ACTION_SCHEMA_VERSION,
    actionKind: 'plugin.pilot.item.create',
    scope: fixtureActionScope(),
    inputPayload: { title: 'Fixture 试点条目', content: '来自插件提案的试点内容' },
    sourceRefs: [fixturePilotSourceRef()],
    createdAt: ACTION_FIXTURE_NOW_ISO,
    ...overrides,
  }
}

/** 合法 pilot preview（dry-run 通过、无 blocking finding）。 */
export function fixturePilotPreview(input?: {
  proposalDigest?: string
  scope?: PluginActionScope
}): Omit<PluginActionPreview, 'previewDigest'> {
  const proposalDigest = input?.proposalDigest ?? computeProposalDigest(fixturePilotProposal())
  return {
    proposalDigest,
    actionKind: 'plugin.pilot.item.create',
    scope: input?.scope ?? fixtureActionScope(),
    pluginRef: {
      pluginId: 'com.aiproj.pilot.actions',
      pluginVersion: '1.0.0',
      installationId: 101,
    },
    diffEntries: [
      {
        targetRef: 'plugin_pilot_item:new',
        field: 'title',
        before: null,
        after: 'Fixture 试点条目',
      },
      {
        targetRef: 'plugin_pilot_item:new',
        field: 'content',
        before: null,
        after: '来自插件提案的试点内容',
      },
    ],
    assumptions: ['标题与内容按提案原样创建'],
    permissionSummary: { requiredPermissions: ['plugin_action:confirm'], granted: true },
    compatibilitySummary: 'host-contract 1.x 兼容',
    dryRun: { canApply: true, findings: [] },
    reversibility: 'reversible',
    affectedItemRefs: ['plugin_pilot_item:new'],
    batchPolicy: 'per-item',
    issuedAt: ACTION_FIXTURE_NOW_ISO,
    expiresAt: '2026-08-24T08:10:00.000Z',
  }
}

export function fixturePilotPreviewWithDigest(input?: {
  proposalDigest?: string
  scope?: PluginActionScope
}): PluginActionPreview {
  const base = fixturePilotPreview(input)
  return { ...base, previewDigest: computePreviewDigest(base) }
}

/** 由合法 preview + 提案签发确认句柄（确定性）。 */
export function fixturePilotConfirmHandle(input?: {
  previewDigest?: string
  actorUserId?: number
  scope?: PluginActionScope
  idempotencyKey?: string
  nowIso?: string
}): PluginActionConfirmHandle {
  return buildPluginActionConfirmHandle({
    proposalId: 'pact-proposal-fixture-001',
    previewDigest: input?.previewDigest ?? fixturePilotPreviewWithDigest().previewDigest,
    actorUserId: input?.actorUserId ?? 42,
    organizationId: input?.scope?.organizationId ?? 1,
    projectId: input?.scope?.projectId ?? null,
    pluginId: 'com.aiproj.pilot.actions',
    pluginVersion: '1.0.0',
    targetRevision: 'pilot-items@rev-7',
    idempotencyKey: input?.idempotencyKey ?? 'idem-fixture-key-1',
    nowIso: input?.nowIso ?? ACTION_FIXTURE_NOW_ISO,
  })
}

// =============================================================================
// 负例 fixtures
// =============================================================================

/** 未知 action kind 的提案。 */
export function fixtureUnknownKindProposal(): Record<string, unknown> {
  const p = fixturePilotProposal()
  return { ...(p as unknown as Record<string, unknown>), actionKind: 'domain.tasks.bulk-delete' }
}

/** 携带未知顶层字段的提案（夹带执行语义企图）。 */
export function fixtureExtraTopLevelFieldProposal(): Record<string, unknown> {
  const p = fixturePilotProposal() as unknown as Record<string, unknown>
  return { ...p, repositoryWrite: true }
}

/** 输入载荷含未知字段。 */
export function fixtureUnknownInputFieldProposal(): Record<string, unknown> {
  const p = fixturePilotProposal() as unknown as Record<string, unknown>
  return {
    ...p,
    inputPayload: { title: 't', content: 'c', sqlStatement: 'DELETE FROM projects' },
  }
}

/** 超过大小上限的载荷。 */
export function fixtureOversizedProposal(): Record<string, unknown> {
  const p = fixturePilotProposal() as unknown as Record<string, unknown>
  return {
    ...p,
    inputPayload: { title: 'x'.repeat(17 * 1024), content: 'ok' },
  }
}

/** 敏感材料：键名 apiKey 与值 sk-… token。 */
export function fixtureSensitiveMaterialProposal(): Record<string, unknown> {
  const p = fixturePilotProposal() as unknown as Record<string, unknown>
  return {
    ...p,
    inputPayload: {
      title: '正常标题',
      content: 'token=sk-abcdefghijklmnopqrstuvwxyz012345',
    },
  }
}

/** 非 host-core 归属的 adapter 描述符（插件自带 adapter 企图）。 */
export function fixturePluginOwnedAdapterDescriptor(): Record<string, unknown> {
  return {
    actionKind: 'plugin.pilot.item.create',
    owner: 'com.aiproj.evil.plugin',
    batchPolicy: 'per-item',
    reversibility: 'reversible',
    requiredPermissions: [],
  }
}

/** 含禁止直写/SQL/网络声明的 adapter 描述符。 */
export function fixtureForbiddenAdapterDescriptor(): Record<string, unknown> {
  return {
    actionKind: 'plugin.pilot.item.create',
    owner: 'host-core',
    batchPolicy: 'per-item',
    reversibility: 'reversible',
    requiredPermissions: [],
    repository: 'Database.writeRepository',
    executeSql: 'DELETE FROM tasks',
    callbackUrl: 'https://evil.example.com/exfil',
  }
}

/** 跨组织句柄（org 不匹配）。 */
export function fixtureCrossOrgHandle(): PluginActionConfirmHandle {
  return fixturePilotConfirmHandle({ scope: fixtureActionScope({ organizationId: 999 }) })
}
