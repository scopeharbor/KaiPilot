// @aiproj/types — copilot-productized-operating-entry fixtures（零网络、受控测试夹具）。
//
// 供 @aiproj/types 单测、backend 单测/功能测试与前端组件测试复用；
// 全部为声明式本机数据，无可执行内容、无真实外部配置、无 provider 凭证。

import type {
  CopilotEntryPluginBinding,
  CopilotEntryQuickStart,
  CopilotEntryReadinessSnapshot,
  CopilotEntryRecentSession,
} from './copilot-productized-operating-entry.js'
import { COPILOT_ENTRY_CONTRACT_VERSION } from './copilot-productized-operating-entry.js'

/** 固定求值时间，保证 fixture 断言确定性。 */
export const ENTRY_FIXTURE_EVALUATED_AT = '2026-08-24T02:00:00.000Z'
/** 固定会话更新时间。 */
export const ENTRY_FIXTURE_SESSION_UPDATED_AT = '2026-08-24T01:30:00.000Z'
/** 固定资格快照 revision（快照整体替换即失效）。 */
export const ENTRY_FIXTURE_SNAPSHOT_REVISION = 'snap_rev_fixture_0001'
/** 与上者不同的 revision，用于 stale 复核负例。 */
export const ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION = 'snap_rev_fixture_0002'

/** 插件绑定夹具（advisory 类工具）。 */
export const ENTRY_FIXTURE_PLUGIN_BINDING: CopilotEntryPluginBinding = {
  pluginId: 'plg_fixture_triz',
  pluginVersion: '1.2.0',
  toolId: 'ctool_fixture_contradiction_advisor',
  toolDigest: 'tool_digest_fixture_advisory',
  snapshotRevision: ENTRY_FIXTURE_SNAPSHOT_REVISION,
}

/** 插件绑定夹具（write 类工具——只可 pending review）。 */
export const ENTRY_FIXTURE_WRITE_PLUGIN_BINDING: CopilotEntryPluginBinding = {
  pluginId: 'plg_fixture_report',
  pluginVersion: '0.9.1',
  toolId: 'ctool_fixture_weekly_report_writer',
  toolDigest: 'tool_digest_fixture_write',
  snapshotRevision: ENTRY_FIXTURE_SNAPSHOT_REVISION,
}

/** 核心 quick start（宿主能力派生）。 */
export const ENTRY_FIXTURE_CORE_QUICK_START: CopilotEntryQuickStart = {
  quickStartId: 'core.project-health',
  source: 'core',
  label: '看看项目健康度',
  draftTemplate: '帮我总结当前项目的健康度与主要风险。',
  sideEffectClass: 'query',
}

/** 第二条核心 quick start（用于排序断言）。 */
export const ENTRY_FIXTURE_CORE_QUICK_START_B: CopilotEntryQuickStart = {
  quickStartId: 'core.ask-anything',
  source: 'core',
  label: '问点别的',
  draftTemplate: '',
  sideEffectClass: 'query',
}

/** 插件来源 quick start（advisory）。 */
export const ENTRY_FIXTURE_PLUGIN_QUICK_START: CopilotEntryQuickStart = {
  quickStartId: 'plugin.triz.contradiction',
  source: 'plugin',
  label: '分析一个技术矛盾',
  draftTemplate: '帮我分析这个技术矛盾的可行解法。',
  sideEffectClass: 'advisory',
  pluginBinding: ENTRY_FIXTURE_PLUGIN_BINDING,
}

/** 插件来源 quick start（write 类，仅 pending review）。 */
export const ENTRY_FIXTURE_WRITE_QUICK_START: CopilotEntryQuickStart = {
  quickStartId: 'plugin.report.weekly',
  source: 'plugin',
  label: '生成本周周报草稿',
  draftTemplate: '帮我生成本周项目周报草稿。',
  sideEffectClass: 'write',
  pluginBinding: ENTRY_FIXTURE_WRITE_PLUGIN_BINDING,
}

/** 最近会话摘要（有界标题）。 */
export const ENTRY_FIXTURE_RECENT_SESSION: CopilotEntryRecentSession = {
  sessionId: 'csess_fixture_recent_0001',
  titleSummary: '排期冲突讨论',
  scope: 'project',
  updatedAt: ENTRY_FIXTURE_SESSION_UPDATED_AT,
}

/** ready：项目级 scope，核心 + 插件 quick starts，一条最近会话。 */
export const readyEntrySnapshotFixture: CopilotEntryReadinessSnapshot = {
  contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
  state: 'ready',
  scope: { kind: 'project', organizationId: 7, projectId: 42, label: '灯塔迁移项目' },
  reasons: [{ code: 'entry_ready', retryable: false }],
  allowedActions: ['open-workspace', 'continue-session', 'start-session', 'retry-readiness'],
  recentSession: ENTRY_FIXTURE_RECENT_SESSION,
  quickStarts: [ENTRY_FIXTURE_CORE_QUICK_START, ENTRY_FIXTURE_PLUGIN_QUICK_START],
  evaluatedAt: ENTRY_FIXTURE_EVALUATED_AT,
}

/** ready：组织级 scope，无最近会话、无 quick start（empty 态）。 */
export const readyEmptyEntrySnapshotFixture: CopilotEntryReadinessSnapshot = {
  contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
  state: 'ready',
  scope: { kind: 'organization', organizationId: 7 },
  reasons: [{ code: 'entry_ready', retryable: false }],
  allowedActions: ['open-workspace', 'start-session', 'retry-readiness'],
  recentSession: null,
  quickStarts: [],
  evaluatedAt: ENTRY_FIXTURE_EVALUATED_AT,
}

/** degraded：会话检索不可用 + 工具快照陈旧，仍保留安全动作。 */
export const degradedEntrySnapshotFixture: CopilotEntryReadinessSnapshot = {
  contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
  state: 'degraded',
  scope: { kind: 'project', organizationId: 7, projectId: 42, label: '灯塔迁移项目' },
  reasons: [
    { code: 'recent_session_unavailable', retryable: true },
    { code: 'tool_snapshot_stale', retryable: true },
  ],
  allowedActions: ['open-workspace', 'start-session', 'retry-readiness'],
  recentSession: null,
  quickStarts: [ENTRY_FIXTURE_CORE_QUICK_START],
  evaluatedAt: ENTRY_FIXTURE_EVALUATED_AT,
}

/** unavailable：项目 scope 未授权，fail closed（不泄露 projectId/名称）。 */
export const unavailableEntrySnapshotFixture: CopilotEntryReadinessSnapshot = {
  contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
  state: 'unavailable',
  scope: { kind: 'organization', organizationId: 7 },
  reasons: [{ code: 'project_scope_denied', retryable: false }],
  allowedActions: ['retry-readiness'],
  recentSession: null,
  quickStarts: [],
  evaluatedAt: ENTRY_FIXTURE_EVALUATED_AT,
}

/** unavailable：无有效组织上下文。 */
export const unavailableNoOrganizationFixture: CopilotEntryReadinessSnapshot = {
  contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
  state: 'unavailable',
  scope: { kind: 'organization', organizationId: 0 },
  reasons: [{ code: 'organization_context_missing', retryable: false }],
  allowedActions: ['retry-readiness'],
  recentSession: null,
  quickStarts: [],
  evaluatedAt: ENTRY_FIXTURE_EVALUATED_AT,
}

// ---------------------------------------------------------------------------
// 负例夹具（解析必须 fail closed）
// ---------------------------------------------------------------------------

/** 携带未知字段。 */
export const entrySnapshotWithUnknownFieldFixture: unknown = {
  ...readyEntrySnapshotFixture,
  entryTelemetryBlob: { anything: true },
}

/** 携带未知枚举值。 */
export const entrySnapshotWithUnknownEnumFixture: unknown = {
  ...readyEntrySnapshotFixture,
  state: 'partially-ready',
}

/** 携带禁存字段（prompt 全文）。 */
export const entrySnapshotWithForbiddenFieldFixture: unknown = {
  ...readyEntrySnapshotFixture,
  prompt: '请把所有任务的负责人改成我',
}

/** 携带资格快照 exclusions（会泄露无权工具存在性）。 */
export const entrySnapshotWithExclusionsFixture: unknown = {
  ...readyEntrySnapshotFixture,
  exclusions: [{ reason: 'no_permission', pluginId: 'plg_other' }],
}

/** 会话标题超界。 */
export const entrySnapshotWithOverlongTitleFixture: unknown = {
  ...readyEntrySnapshotFixture,
  recentSession: {
    ...ENTRY_FIXTURE_RECENT_SESSION,
    titleSummary: '排'.repeat(120),
  },
}

/** quick start 数量超上限。 */
export const entrySnapshotWithTooManyQuickStartsFixture: unknown = {
  ...readyEntrySnapshotFixture,
  quickStarts: Array.from({ length: 9 }, (_unused, index) => ({
    quickStartId: `core.overflow-${index}`,
    source: 'core',
    label: `建议 ${index}`,
    draftTemplate: `示例 ${index}`,
    sideEffectClass: 'query',
  })),
}

/** 插件来源缺少快照绑定。 */
export const entrySnapshotWithUnboundPluginQuickStartFixture: unknown = {
  ...readyEntrySnapshotFixture,
  quickStarts: [
    {
      quickStartId: 'plugin.triz.contradiction',
      source: 'plugin',
      label: '分析一个技术矛盾',
      draftTemplate: '帮我分析这个技术矛盾的可行解法。',
      sideEffectClass: 'advisory',
    },
  ],
}

/** ready 却携带降级原因（状态—原因不一致）。 */
export const entrySnapshotWithInconsistentReasonFixture: unknown = {
  ...readyEntrySnapshotFixture,
  reasons: [{ code: 'tool_snapshot_stale', retryable: true }],
}

/** 生产错误样本（用于错误分类矩阵测试）。 */
export const ENTRY_FIXTURE_API_ERRORS = {
  auth: { status: 401, code: 'AUTH_REQUIRED', message: '未认证' },
  roleVersion: { status: 401, code: 'ROLE_VERSION_MISMATCH', message: '角色版本不一致' },
  permission: { status: 403, code: 'PERMISSION_DENIED', message: '权限不足' },
  notFound: { status: 404, code: 'RESOURCE_NOT_FOUND', message: '资源不存在' },
  validation: { status: 422, code: 'VALIDATION_ERROR', message: '参数校验失败' },
  rateLimit: { status: 429, code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁' },
  conflict: { status: 409, code: 'RESOURCE_CONFLICT', message: '状态冲突' },
  stale: { status: 409, code: 'COPILOT_SNAPSHOT_STALE', message: '资格快照已变更' },
  service: { status: 503, code: 'AI_SERVICE_ERROR', message: '服务暂不可用' },
  tenant: { status: 503, code: 'TENANT_RESOLUTION_UNAVAILABLE', message: '租户链路不可用' },
  unknownCode: { status: 418, code: 'SOMETHING_NEW', message: '未知' },
  transport: new TypeError('Failed to fetch'),
} as const
