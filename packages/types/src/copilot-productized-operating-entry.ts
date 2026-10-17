// @aiproj/types — V3 Copilot 产品化操作入口共享契约
// v3-copilot-productized-operating-entry
//
// 纯类型 + 确定性纯函数，禁止依赖 AdonisJS、React、数据库客户端、
// HTTP 客户端、外部网络、容器、provider 凭证或真实模型 SDK。
//
// 设计约束（design D3 / D6 / D7 / D9）：
// - 状态、原因码与可执行动作全部**闭集**：未知值一律 fail closed，不透传异常 message；
// - 只承载低敏投影：不含 prompt、消息正文、工具参数/结果、secret 与资格快照 exclusions；
// - 最近会话至多一条且标题有界；quick start 确定性排序 + 数量上限；
// - 插件来源的 quick start **必须**绑定资格快照 revision（TOCTOU 复核锚点）；
// - readiness 是宿主前置检查，不代表某个外部 provider 当下可用。

// ---------------------------------------------------------------------------
// 0. 契约版本
// ---------------------------------------------------------------------------

/** 入口契约版本（破坏性变更时递增主版本）。 */
export const COPILOT_ENTRY_CONTRACT_VERSION = '1.0.0'

// ---------------------------------------------------------------------------
// 1. 就绪状态与原因码（闭集）
// ---------------------------------------------------------------------------

/** 就绪三态。`ready` 只代表宿主允许进入并可受理请求。 */
export const COPILOT_ENTRY_READINESS_STATES = ['ready', 'degraded', 'unavailable'] as const
export type CopilotEntryReadinessState = (typeof COPILOT_ENTRY_READINESS_STATES)[number]

/**
 * 稳定低敏原因码。
 *
 * 分三档：`entry_ready` 只在 ready 出现；`*_unavailable`/`*_stale` 为可选能力降级；
 * 其余为 mandatory 前置失败。**任何原因码都不得携带不可访问对象的名称、ID、数量或存在性。**
 */
export const COPILOT_ENTRY_REASON_CODES = [
  // ready
  'entry_ready',
  // degraded —— 可选能力
  'recent_session_unavailable',
  'tool_snapshot_unavailable',
  'tool_snapshot_stale',
  'quick_starts_unavailable',
  // unavailable —— mandatory 前置
  'organization_context_missing',
  'copilot_permission_denied',
  'project_scope_denied',
  'turn_channel_unavailable',
  'readiness_evaluation_failed',
] as const
export type CopilotEntryReasonCode = (typeof COPILOT_ENTRY_REASON_CODES)[number]

/** 只允许出现在 `degraded` 的可选能力原因码。 */
export const COPILOT_ENTRY_OPTIONAL_REASON_CODES: readonly CopilotEntryReasonCode[] = [
  'recent_session_unavailable',
  'tool_snapshot_unavailable',
  'tool_snapshot_stale',
  'quick_starts_unavailable',
]

/** 只允许出现在 `unavailable` 的 mandatory 原因码。 */
export const COPILOT_ENTRY_MANDATORY_REASON_CODES: readonly CopilotEntryReasonCode[] = [
  'organization_context_missing',
  'copilot_permission_denied',
  'project_scope_denied',
  'turn_channel_unavailable',
  'readiness_evaluation_failed',
]

/** 单条原因：闭集码 + 是否可由用户重试。 */
export interface CopilotEntryReason {
  readonly code: CopilotEntryReasonCode
  /** true = 重新求值 readiness 有可能改变结果（如服务暂时不可用）。 */
  readonly retryable: boolean
}

// ---------------------------------------------------------------------------
// 2. 可执行动作（闭集）
// ---------------------------------------------------------------------------

/**
 * 入口允许的下一步动作。全部为**只读或本地偏好**行为：
 * 打开面板、选择 scope、选择 quick start、续接会话、重试 readiness、显式进入演示。
 * 任何可能改变正式项目数据的输出继续走既有 preview/confirm 边界。
 */
export const COPILOT_ENTRY_ALLOWED_ACTIONS = [
  'open-workspace',
  'continue-session',
  'start-session',
  'retry-readiness',
  'enter-explicit-demo',
] as const
export type CopilotEntryAllowedAction = (typeof COPILOT_ENTRY_ALLOWED_ACTIONS)[number]

// ---------------------------------------------------------------------------
// 3. 作用域摘要
// ---------------------------------------------------------------------------

/** 作用域类型：组织级（global）或项目级。 */
export const COPILOT_ENTRY_SCOPE_KINDS = ['organization', 'project'] as const
export type CopilotEntryScopeKind = (typeof COPILOT_ENTRY_SCOPE_KINDS)[number]

/** 标签长度上限（作用域名 / 会话标题 / quick start 文案）。 */
export const COPILOT_ENTRY_MAX_SCOPE_LABEL_LENGTH = 40
export const COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH = 60
export const COPILOT_ENTRY_MAX_QUICK_START_LABEL_LENGTH = 40
export const COPILOT_ENTRY_MAX_QUICK_START_DRAFT_LENGTH = 200
/** quick start 数量上限（确定性截断，详细工具浏览仍留在侧栏/插件面）。 */
export const COPILOT_ENTRY_MAX_QUICK_STARTS = 6

/**
 * 有效作用域摘要。
 *
 * 只允许出现**当前已授权**的组织/项目引用；不可访问的 scope 一律不出现在此结构中
 * （其名称、ID、数量与存在性都不得泄露）。
 */
export interface CopilotEntryScope {
  readonly kind: CopilotEntryScopeKind
  readonly organizationId: number
  /** 项目级 scope 才有；必须已通过项目可见性判定。 */
  readonly projectId?: number
  /** 有界展示名（≤40）；组织级 scope 可省略。 */
  readonly label?: string
}

// ---------------------------------------------------------------------------
// 4. 最近会话摘要（至多一条）
// ---------------------------------------------------------------------------

/** 会话作用域（与既有 `CopilotScope` 词表对齐的封闭子集）。 */
export const COPILOT_ENTRY_SESSION_SCOPES = ['global', 'project', 'portfolio'] as const
export type CopilotEntrySessionScope = (typeof COPILOT_ENTRY_SESSION_SCOPES)[number]

/**
 * 最近会话的有界摘要。
 *
 * 禁存：消息正文、prompt、工具参数/结果。只保留可续接所需的最小引用与展示信息。
 */
export interface CopilotEntryRecentSession {
  readonly sessionId: string
  /** 有界标题（≤60）；无标题时由服务端给出中性占位。 */
  readonly titleSummary: string
  readonly scope: CopilotEntrySessionScope
  /** ISO 8601 更新时间。 */
  readonly updatedAt: string
}

// ---------------------------------------------------------------------------
// 5. Quick start
// ---------------------------------------------------------------------------

/** quick start 来源：宿主核心能力或当前有效插件工具资格快照。 */
export const COPILOT_ENTRY_QUICK_START_SOURCES = ['core', 'plugin'] as const
export type CopilotEntryQuickStartSource = (typeof COPILOT_ENTRY_QUICK_START_SOURCES)[number]

/** 副作用等级（与 `CopilotToolSideEffectClass` 词表一致）。 */
export const COPILOT_ENTRY_SIDE_EFFECT_CLASSES = ['query', 'advisory', 'write'] as const
export type CopilotEntrySideEffectClass = (typeof COPILOT_ENTRY_SIDE_EFFECT_CLASSES)[number]

/**
 * 插件来源绑定：提交前据此复核资格快照是否仍然有效。
 *
 * 只含身份与 digest/revision，不含 schema、URL、代码路径或 secret。
 */
export interface CopilotEntryPluginBinding {
  readonly pluginId: string
  readonly pluginVersion: string
  readonly toolId: string
  /** 工具声明 digest（TOCTOU 复核锚点）。 */
  readonly toolDigest: string
  /** 资格快照 digest —— 快照整体替换即失效。 */
  readonly snapshotRevision: string
}

/**
 * 入口快捷建议。
 *
 * **选择 quick start 只填入草稿或打开面板**，绝不提交模型请求或执行业务动作（design D6）。
 */
export interface CopilotEntryQuickStart {
  /** 稳定 ID（确定性排序的次级键）。 */
  readonly quickStartId: string
  readonly source: CopilotEntryQuickStartSource
  /** 有界展示文案（≤40）。 */
  readonly label: string
  /** 填入输入框的有界草稿模板（≤200）。 */
  readonly draftTemplate: string
  readonly sideEffectClass: CopilotEntrySideEffectClass
  /** `source === 'plugin'` 时必填；`core` 时必须缺席。 */
  readonly pluginBinding?: CopilotEntryPluginBinding
}

// ---------------------------------------------------------------------------
// 6. 就绪快照
// ---------------------------------------------------------------------------

/** 演示能力声明来源（宿主构建/运行环境显式声明，不是 catch-all 回退）。 */
export interface CopilotEntryDemonstrationCapability {
  /** 宿主是否声明了本机/测试演示能力。 */
  readonly declared: boolean
}

/**
 * 宿主拥有的确定性就绪快照。
 *
 * 求值期间**禁止**调用模型、provider、公网，或写入会话/审计（design D2 / D9）。
 */
export interface CopilotEntryReadinessSnapshot {
  readonly contractVersion: string
  readonly state: CopilotEntryReadinessState
  readonly scope: CopilotEntryScope
  /** 稳定原因（ready 时为单条 `entry_ready`）。 */
  readonly reasons: readonly CopilotEntryReason[]
  readonly allowedActions: readonly CopilotEntryAllowedAction[]
  /** 至多一条最近会话；不可用或无合格会话时为 null。 */
  readonly recentSession: CopilotEntryRecentSession | null
  /** 有界 quick starts（确定性排序，≤ `COPILOT_ENTRY_MAX_QUICK_STARTS`）。 */
  readonly quickStarts: readonly CopilotEntryQuickStart[]
  /** ISO 8601 求值时间。 */
  readonly evaluatedAt: string
}

// ---------------------------------------------------------------------------
// 7. 禁存字段检测
// ---------------------------------------------------------------------------

/**
 * 禁止出现在入口契约中的字段名（低敏边界）。
 *
 * 含 prompt/消息正文/工具参数与结果/secret，以及资格快照的 `exclusions`
 * ——后者会把无权工具或跨租对象的存在性带到客户端。
 */
export const COPILOT_ENTRY_FORBIDDEN_FIELDS = [
  'prompt',
  'promptText',
  'systemPrompt',
  'message',
  'messageText',
  'messageBody',
  'messages',
  'content',
  'rawText',
  'toolArguments',
  'toolInput',
  'toolOutput',
  'toolResult',
  'toolParams',
  'rawResponse',
  'stackTrace',
  'exception',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'credential',
  'exclusions',
  'exclusionReason',
] as const
export type CopilotEntryForbiddenField = (typeof COPILOT_ENTRY_FORBIDDEN_FIELDS)[number]

const FORBIDDEN_FIELD_SET = new Set<string>(COPILOT_ENTRY_FORBIDDEN_FIELDS)

/**
 * 递归检测禁存字段名，返回命中的**路径**（确定性排序）。
 *
 * 只按字段名判定，不读取值——避免在诊断路径上再复制一份敏感内容。
 */
export function detectCopilotEntryForbiddenFields(value: unknown): readonly string[] {
  const hits: string[] = []

  function walk(node: unknown, path: string): void {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${path}[${i}]`)
      return
    }
    if (!node || typeof node !== 'object') return
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key
      if (FORBIDDEN_FIELD_SET.has(key)) hits.push(childPath)
      walk((node as Record<string, unknown>)[key], childPath)
    }
  }

  walk(value, '')
  return hits.sort()
}

// ---------------------------------------------------------------------------
// 8. 确定性排序与截断
// ---------------------------------------------------------------------------

const QUICK_START_SOURCE_PRIORITY: Record<CopilotEntryQuickStartSource, number> = {
  core: 0,
  plugin: 1,
}

/**
 * 确定性排序：`source priority` 升序 → `quickStartId` 升序（design D6）。
 *
 * 不做原地修改；相同输入必然产生相同输出。
 */
export function sortCopilotEntryQuickStarts(
  quickStarts: readonly CopilotEntryQuickStart[],
): readonly CopilotEntryQuickStart[] {
  return [...quickStarts].sort((a, b) => {
    const bySource = QUICK_START_SOURCE_PRIORITY[a.source] - QUICK_START_SOURCE_PRIORITY[b.source]
    if (bySource !== 0) return bySource
    return a.quickStartId < b.quickStartId ? -1 : a.quickStartId > b.quickStartId ? 1 : 0
  })
}

/** 排序后按上限截断（默认 `COPILOT_ENTRY_MAX_QUICK_STARTS`）。 */
export function boundCopilotEntryQuickStarts(
  quickStarts: readonly CopilotEntryQuickStart[],
  max: number = COPILOT_ENTRY_MAX_QUICK_STARTS,
): readonly CopilotEntryQuickStart[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : COPILOT_ENTRY_MAX_QUICK_STARTS
  return sortCopilotEntryQuickStarts(quickStarts).slice(0, limit)
}

/** 有界截断文本（超长补省略号，保证结果长度 ≤ max）。 */
export function boundCopilotEntryText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  if (max <= 1) return normalized.slice(0, Math.max(0, max))
  return `${normalized.slice(0, max - 1)}…`
}

// ---------------------------------------------------------------------------
// 9. 严格解析（fail closed）
// ---------------------------------------------------------------------------

/** 解析 finding 码（闭集）。 */
export const COPILOT_ENTRY_PARSE_ISSUE_CODES = [
  'entry-schema-invalid',
  'entry-unknown-field',
  'entry-unknown-enum',
  'entry-bound-exceeded',
  'entry-forbidden-field',
  'entry-invariant-violated',
] as const
export type CopilotEntryParseIssueCode = (typeof COPILOT_ENTRY_PARSE_ISSUE_CODES)[number]

export interface CopilotEntryParseIssue {
  readonly code: CopilotEntryParseIssueCode
  readonly path: string
  readonly message: string
}

export type CopilotEntryParseResult =
  | { readonly ok: true; readonly snapshot: CopilotEntryReadinessSnapshot }
  | { readonly ok: false; readonly issues: readonly CopilotEntryParseIssue[] }

const SNAPSHOT_FIELDS = [
  'contractVersion',
  'state',
  'scope',
  'reasons',
  'allowedActions',
  'recentSession',
  'quickStarts',
  'evaluatedAt',
] as const
const SCOPE_FIELDS = ['kind', 'organizationId', 'projectId', 'label'] as const
const REASON_FIELDS = ['code', 'retryable'] as const
const SESSION_FIELDS = ['sessionId', 'titleSummary', 'scope', 'updatedAt'] as const
const QUICK_START_FIELDS = [
  'quickStartId',
  'source',
  'label',
  'draftTemplate',
  'sideEffectClass',
  'pluginBinding',
] as const
const PLUGIN_BINDING_FIELDS = [
  'pluginId',
  'pluginVersion',
  'toolId',
  'toolDigest',
  'snapshotRevision',
] as const

function issue(
  code: CopilotEntryParseIssueCode,
  path: string,
  message: string,
): CopilotEntryParseIssue {
  return { code, path, message }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 未知字段一律拒绝（fail closed），不静默丢弃。 */
function rejectUnknownFields(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: CopilotEntryParseIssue[],
): void {
  const allowedSet = new Set<string>(allowed)
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      issues.push(issue('entry-unknown-field', `${path}.${key}`, `未知字段 ${key}`))
    }
  }
}

function requireBoundedString(
  value: unknown,
  max: number,
  path: string,
  issues: CopilotEntryParseIssue[],
): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(issue('entry-schema-invalid', path, '必须是非空字符串'))
    return null
  }
  if (value.length > max) {
    issues.push(issue('entry-bound-exceeded', path, `长度超过 ${max}`))
    return null
  }
  return value
}

function requireIsoTimestamp(
  value: unknown,
  path: string,
  issues: CopilotEntryParseIssue[],
): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    issues.push(issue('entry-schema-invalid', path, '必须是 ISO 8601 时间戳'))
    return null
  }
  return value
}

function parseScope(raw: unknown, issues: CopilotEntryParseIssue[]): CopilotEntryScope | null {
  if (!isPlainObject(raw)) {
    issues.push(issue('entry-schema-invalid', 'scope', 'scope 必须是对象'))
    return null
  }
  rejectUnknownFields(raw, SCOPE_FIELDS, 'scope', issues)

  const kind = raw.kind
  if (typeof kind !== 'string' || !isCopilotEntryScopeKind(kind)) {
    issues.push(issue('entry-unknown-enum', 'scope.kind', 'scope.kind 不在封闭词表内'))
    return null
  }
  const organizationId = raw.organizationId
  if (typeof organizationId !== 'number' || !Number.isInteger(organizationId)) {
    issues.push(issue('entry-schema-invalid', 'scope.organizationId', '必须是整数'))
    return null
  }

  let projectId: number | undefined
  if (raw.projectId !== undefined) {
    if (typeof raw.projectId !== 'number' || !Number.isInteger(raw.projectId)) {
      issues.push(issue('entry-schema-invalid', 'scope.projectId', '必须是整数'))
      return null
    }
    projectId = raw.projectId
  }
  if (kind === 'project' && projectId === undefined) {
    issues.push(
      issue('entry-invariant-violated', 'scope.projectId', '项目级 scope 必须带 projectId'),
    )
    return null
  }
  if (kind === 'organization' && projectId !== undefined) {
    issues.push(
      issue('entry-invariant-violated', 'scope.projectId', '组织级 scope 不得携带 projectId'),
    )
    return null
  }

  let label: string | undefined
  if (raw.label !== undefined) {
    const parsed = requireBoundedString(
      raw.label,
      COPILOT_ENTRY_MAX_SCOPE_LABEL_LENGTH,
      'scope.label',
      issues,
    )
    if (parsed === null) return null
    label = parsed
  }

  return {
    kind,
    organizationId,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(label !== undefined ? { label } : {}),
  }
}

function parseReasons(raw: unknown, issues: CopilotEntryParseIssue[]): CopilotEntryReason[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push(issue('entry-schema-invalid', 'reasons', 'reasons 必须是非空数组'))
    return null
  }
  const reasons: CopilotEntryReason[] = []
  for (let i = 0; i < raw.length; i++) {
    const path = `reasons[${i}]`
    const item = raw[i]
    if (!isPlainObject(item)) {
      issues.push(issue('entry-schema-invalid', path, '必须是对象'))
      return null
    }
    rejectUnknownFields(item, REASON_FIELDS, path, issues)
    const code = item.code
    if (typeof code !== 'string' || !isCopilotEntryReasonCode(code)) {
      issues.push(issue('entry-unknown-enum', `${path}.code`, '原因码不在封闭词表内'))
      return null
    }
    if (typeof item.retryable !== 'boolean') {
      issues.push(issue('entry-schema-invalid', `${path}.retryable`, '必须是布尔值'))
      return null
    }
    reasons.push({ code, retryable: item.retryable })
  }
  return reasons
}

function parseAllowedActions(
  raw: unknown,
  issues: CopilotEntryParseIssue[],
): CopilotEntryAllowedAction[] | null {
  if (!Array.isArray(raw)) {
    issues.push(issue('entry-schema-invalid', 'allowedActions', '必须是数组'))
    return null
  }
  const actions: CopilotEntryAllowedAction[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const path = `allowedActions[${i}]`
    const action = raw[i]
    if (typeof action !== 'string' || !isCopilotEntryAllowedAction(action)) {
      issues.push(issue('entry-unknown-enum', path, '动作不在封闭词表内'))
      return null
    }
    if (seen.has(action)) {
      issues.push(issue('entry-invariant-violated', path, '动作重复'))
      return null
    }
    seen.add(action)
    actions.push(action)
  }
  return actions
}

function parseRecentSession(
  raw: unknown,
  issues: CopilotEntryParseIssue[],
): CopilotEntryRecentSession | null | undefined {
  if (raw === null) return null
  if (!isPlainObject(raw)) {
    issues.push(issue('entry-schema-invalid', 'recentSession', '必须是对象或 null'))
    return undefined
  }
  rejectUnknownFields(raw, SESSION_FIELDS, 'recentSession', issues)

  const sessionId = requireBoundedString(raw.sessionId, 128, 'recentSession.sessionId', issues)
  const titleSummary = requireBoundedString(
    raw.titleSummary,
    COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH,
    'recentSession.titleSummary',
    issues,
  )
  const scope = raw.scope
  if (typeof scope !== 'string' || !isCopilotEntrySessionScope(scope)) {
    issues.push(issue('entry-unknown-enum', 'recentSession.scope', '会话 scope 不在封闭词表内'))
    return undefined
  }
  const updatedAt = requireIsoTimestamp(raw.updatedAt, 'recentSession.updatedAt', issues)
  if (sessionId === null || titleSummary === null || updatedAt === null) return undefined

  return { sessionId, titleSummary, scope, updatedAt }
}

function parsePluginBinding(
  raw: unknown,
  path: string,
  issues: CopilotEntryParseIssue[],
): CopilotEntryPluginBinding | null {
  if (!isPlainObject(raw)) {
    issues.push(issue('entry-schema-invalid', path, '必须是对象'))
    return null
  }
  rejectUnknownFields(raw, PLUGIN_BINDING_FIELDS, path, issues)
  const pluginId = requireBoundedString(raw.pluginId, 128, `${path}.pluginId`, issues)
  const pluginVersion = requireBoundedString(raw.pluginVersion, 64, `${path}.pluginVersion`, issues)
  const toolId = requireBoundedString(raw.toolId, 128, `${path}.toolId`, issues)
  const toolDigest = requireBoundedString(raw.toolDigest, 128, `${path}.toolDigest`, issues)
  const snapshotRevision = requireBoundedString(
    raw.snapshotRevision,
    128,
    `${path}.snapshotRevision`,
    issues,
  )
  if (
    pluginId === null ||
    pluginVersion === null ||
    toolId === null ||
    toolDigest === null ||
    snapshotRevision === null
  ) {
    return null
  }
  return { pluginId, pluginVersion, toolId, toolDigest, snapshotRevision }
}

function parseQuickStarts(
  raw: unknown,
  issues: CopilotEntryParseIssue[],
): CopilotEntryQuickStart[] | null {
  if (!Array.isArray(raw)) {
    issues.push(issue('entry-schema-invalid', 'quickStarts', '必须是数组'))
    return null
  }
  if (raw.length > COPILOT_ENTRY_MAX_QUICK_STARTS) {
    issues.push(
      issue('entry-bound-exceeded', 'quickStarts', `数量超过 ${COPILOT_ENTRY_MAX_QUICK_STARTS}`),
    )
    return null
  }

  const quickStarts: CopilotEntryQuickStart[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const path = `quickStarts[${i}]`
    const item = raw[i]
    if (!isPlainObject(item)) {
      issues.push(issue('entry-schema-invalid', path, '必须是对象'))
      return null
    }
    rejectUnknownFields(item, QUICK_START_FIELDS, path, issues)

    const quickStartId = requireBoundedString(
      item.quickStartId,
      128,
      `${path}.quickStartId`,
      issues,
    )
    const label = requireBoundedString(
      item.label,
      COPILOT_ENTRY_MAX_QUICK_START_LABEL_LENGTH,
      `${path}.label`,
      issues,
    )
    const draftTemplate = requireBoundedString(
      item.draftTemplate,
      COPILOT_ENTRY_MAX_QUICK_START_DRAFT_LENGTH,
      `${path}.draftTemplate`,
      issues,
    )
    const source = item.source
    if (typeof source !== 'string' || !isCopilotEntryQuickStartSource(source)) {
      issues.push(issue('entry-unknown-enum', `${path}.source`, 'source 不在封闭词表内'))
      return null
    }
    const sideEffectClass = item.sideEffectClass
    if (typeof sideEffectClass !== 'string' || !isCopilotEntrySideEffectClass(sideEffectClass)) {
      issues.push(
        issue('entry-unknown-enum', `${path}.sideEffectClass`, 'sideEffectClass 不在封闭词表内'),
      )
      return null
    }
    if (quickStartId === null || label === null || draftTemplate === null) return null
    if (seenIds.has(quickStartId)) {
      issues.push(issue('entry-invariant-violated', `${path}.quickStartId`, 'quickStartId 重复'))
      return null
    }
    seenIds.add(quickStartId)

    let pluginBinding: CopilotEntryPluginBinding | undefined
    if (source === 'plugin') {
      if (item.pluginBinding === undefined) {
        issues.push(
          issue(
            'entry-invariant-violated',
            `${path}.pluginBinding`,
            '插件来源必须绑定快照 revision',
          ),
        )
        return null
      }
      const parsed = parsePluginBinding(item.pluginBinding, `${path}.pluginBinding`, issues)
      if (parsed === null) return null
      pluginBinding = parsed
    } else if (item.pluginBinding !== undefined) {
      issues.push(
        issue('entry-invariant-violated', `${path}.pluginBinding`, 'core 来源不得携带插件绑定'),
      )
      return null
    }

    quickStarts.push({
      quickStartId,
      source,
      label,
      draftTemplate,
      sideEffectClass,
      ...(pluginBinding !== undefined ? { pluginBinding } : {}),
    })
  }
  return quickStarts
}

/** 状态与原因码的一致性（mandatory 原因只属 unavailable，可选原因只属 degraded）。 */
function checkStateReasonConsistency(
  state: CopilotEntryReadinessState,
  reasons: readonly CopilotEntryReason[],
  issues: CopilotEntryParseIssue[],
): void {
  const optional = new Set<string>(COPILOT_ENTRY_OPTIONAL_REASON_CODES)
  const mandatory = new Set<string>(COPILOT_ENTRY_MANDATORY_REASON_CODES)

  for (let i = 0; i < reasons.length; i++) {
    const { code } = reasons[i]!
    const path = `reasons[${i}].code`
    if (state === 'ready' && code !== 'entry_ready') {
      issues.push(issue('entry-invariant-violated', path, 'ready 只允许 entry_ready'))
    }
    if (state === 'degraded' && !optional.has(code)) {
      issues.push(issue('entry-invariant-violated', path, 'degraded 只允许可选能力原因码'))
    }
    if (state === 'unavailable' && !mandatory.has(code)) {
      issues.push(issue('entry-invariant-violated', path, 'unavailable 只允许 mandatory 原因码'))
    }
  }
}

/**
 * 严格解析就绪快照：未知字段、未知枚举、越界与不变量违反一律 fail closed。
 *
 * 解析成功即代表该 payload 可安全渲染；调用方**不得**在解析失败时回退到部分可用状态。
 */
export function parseCopilotEntryReadinessSnapshot(input: unknown): CopilotEntryParseResult {
  const issues: CopilotEntryParseIssue[] = []

  if (!isPlainObject(input)) {
    return { ok: false, issues: [issue('entry-schema-invalid', '', '快照必须是对象')] }
  }

  const forbidden = detectCopilotEntryForbiddenFields(input)
  for (const path of forbidden) {
    issues.push(issue('entry-forbidden-field', path, '命中禁存字段名'))
  }

  rejectUnknownFields(input, SNAPSHOT_FIELDS, '', issues)

  if (input.contractVersion !== COPILOT_ENTRY_CONTRACT_VERSION) {
    issues.push(
      issue(
        'entry-schema-invalid',
        'contractVersion',
        `契约版本必须是 ${COPILOT_ENTRY_CONTRACT_VERSION}`,
      ),
    )
  }

  const state = input.state
  if (typeof state !== 'string' || !isCopilotEntryReadinessState(state)) {
    issues.push(issue('entry-unknown-enum', 'state', 'state 不在封闭词表内'))
  }

  const scope = parseScope(input.scope, issues)
  const reasons = parseReasons(input.reasons, issues)
  const allowedActions = parseAllowedActions(input.allowedActions, issues)
  const recentSession =
    input.recentSession === undefined ? undefined : parseRecentSession(input.recentSession, issues)
  const quickStarts = parseQuickStarts(input.quickStarts, issues)
  const evaluatedAt = requireIsoTimestamp(input.evaluatedAt, 'evaluatedAt', issues)

  if (input.recentSession === undefined) {
    issues.push(issue('entry-schema-invalid', 'recentSession', '必须显式提供（对象或 null）'))
  }

  if (
    typeof state === 'string' &&
    isCopilotEntryReadinessState(state) &&
    reasons !== null &&
    reasons !== undefined
  ) {
    checkStateReasonConsistency(state, reasons, issues)
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    snapshot: {
      contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
      state: state as CopilotEntryReadinessState,
      scope: scope as CopilotEntryScope,
      reasons: reasons as readonly CopilotEntryReason[],
      allowedActions: allowedActions as readonly CopilotEntryAllowedAction[],
      recentSession: (recentSession ?? null) as CopilotEntryRecentSession | null,
      quickStarts: quickStarts as readonly CopilotEntryQuickStart[],
      evaluatedAt: evaluatedAt as string,
    },
  }
}

// ---------------------------------------------------------------------------
// 10. 类型守卫
// ---------------------------------------------------------------------------

export function isCopilotEntryReadinessState(value: string): value is CopilotEntryReadinessState {
  return (COPILOT_ENTRY_READINESS_STATES as readonly string[]).includes(value)
}

export function isCopilotEntryReasonCode(value: string): value is CopilotEntryReasonCode {
  return (COPILOT_ENTRY_REASON_CODES as readonly string[]).includes(value)
}

export function isCopilotEntryAllowedAction(value: string): value is CopilotEntryAllowedAction {
  return (COPILOT_ENTRY_ALLOWED_ACTIONS as readonly string[]).includes(value)
}

export function isCopilotEntryScopeKind(value: string): value is CopilotEntryScopeKind {
  return (COPILOT_ENTRY_SCOPE_KINDS as readonly string[]).includes(value)
}

export function isCopilotEntrySessionScope(value: string): value is CopilotEntrySessionScope {
  return (COPILOT_ENTRY_SESSION_SCOPES as readonly string[]).includes(value)
}

export function isCopilotEntryQuickStartSource(
  value: string,
): value is CopilotEntryQuickStartSource {
  return (COPILOT_ENTRY_QUICK_START_SOURCES as readonly string[]).includes(value)
}

export function isCopilotEntrySideEffectClass(value: string): value is CopilotEntrySideEffectClass {
  return (COPILOT_ENTRY_SIDE_EFFECT_CLASSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 11. 生产提交错误分类（纯函数，design D7）
// ---------------------------------------------------------------------------

/**
 * 入口失败类别（闭集）。
 *
 * 关键不变量：**任何生产错误都不产生 demonstration success**——
 * 每个类别的 `allowsDemonstration` 字面量恒为 `false`，由类型系统固定。
 * 演示态只能由「宿主显式声明 + 用户显式选择」进入（见 `canEnterCopilotDemonstration`）。
 */
export const COPILOT_ENTRY_FAILURE_KINDS = [
  'auth',
  'permission',
  'validation',
  'rate-limit',
  'stale',
  'conflict',
  'retryable-service',
  'unknown',
] as const
export type CopilotEntryFailureKind = (typeof COPILOT_ENTRY_FAILURE_KINDS)[number]

/**
 * 分类结果：稳定的入口结果，不透传后端 message。
 *
 * `messageKey` 是稳定文案键，由界面层映射为简体中文；契约本身不承载展示文案，
 * 也不承载任何后端内部细节。
 */
export interface CopilotEntryFailureOutcome {
  readonly kind: CopilotEntryFailureKind
  /** 是否允许「重试」动作（重放同一请求或重新求值 readiness）。 */
  readonly retryable: boolean
  /** 是否保留有界草稿/retry envelope，使用户输入可恢复。 */
  readonly preserveDraft: boolean
  /** 是否需要走既有会话刷新/登录流程。 */
  readonly requiresReauth: boolean
  /** 是否需要重新求值 readiness（权限/资格/scope 可能已变）。 */
  readonly refreshReadiness: boolean
  /** 恒为 false：生产错误绝不转成演示成功。 */
  readonly allowsDemonstration: false
  /** 稳定文案键（界面映射中文）。 */
  readonly messageKey: string
}

const FAILURE_OUTCOMES: Readonly<Record<CopilotEntryFailureKind, CopilotEntryFailureOutcome>> = {
  auth: {
    kind: 'auth',
    retryable: true,
    preserveDraft: true,
    requiresReauth: true,
    refreshReadiness: true,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.auth',
  },
  permission: {
    kind: 'permission',
    retryable: false,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: true,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.permission',
  },
  validation: {
    kind: 'validation',
    retryable: false,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: false,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.validation',
  },
  'rate-limit': {
    kind: 'rate-limit',
    retryable: true,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: false,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.rateLimit',
  },
  stale: {
    kind: 'stale',
    retryable: false,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: true,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.stale',
  },
  conflict: {
    kind: 'conflict',
    retryable: false,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: true,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.conflict',
  },
  'retryable-service': {
    kind: 'retryable-service',
    retryable: true,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: false,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.service',
  },
  unknown: {
    kind: 'unknown',
    retryable: true,
    preserveDraft: true,
    requiresReauth: false,
    refreshReadiness: true,
    allowsDemonstration: false,
    messageKey: 'copilot.entry.failure.unknown',
  },
}

/** 按错误码归类（大小写敏感，与后端 `api_exception` 词表一致）。 */
const ERROR_CODE_TO_KIND: Readonly<Record<string, CopilotEntryFailureKind>> = {
  AUTH_REQUIRED: 'auth',
  INVALID_CREDENTIALS: 'auth',
  ROLE_VERSION_MISMATCH: 'auth',
  PERMISSION_DENIED: 'permission',
  ACCOUNT_INACTIVE: 'permission',
  RESOURCE_NOT_FOUND: 'permission',
  VALIDATION_ERROR: 'validation',
  ACCOUNT_LOCKED: 'rate-limit',
  RATE_LIMIT_EXCEEDED: 'rate-limit',
  RESOURCE_CONFLICT: 'conflict',
  SNAPSHOT_STALE: 'stale',
  COPILOT_SNAPSHOT_STALE: 'stale',
  WORKFLOW_SNAPSHOT_STALE: 'stale',
  AI_SERVICE_ERROR: 'retryable-service',
  FEATURE_DISABLED: 'retryable-service',
  TENANT_RESOLUTION_UNAVAILABLE: 'retryable-service',
  CONNECTION_POOL_EXHAUSTED: 'retryable-service',
  CONNECTION_POOL_TIMEOUT: 'retryable-service',
  CONNECTION_POOL_DEGRADED: 'retryable-service',
}

/** 按 HTTP 状态归类（错误码未命中时的次级信号）。 */
function kindFromStatus(status: number): CopilotEntryFailureKind | null {
  if (status === 401) return 'auth'
  if (status === 403) return 'permission'
  if (status === 404) return 'permission'
  if (status === 409) return 'conflict'
  if (status === 412 || status === 428) return 'stale'
  if (status === 422 || status === 400) return 'validation'
  if (status === 429) return 'rate-limit'
  if (status >= 500 && status <= 599) return 'retryable-service'
  return null
}

/** 查表：某个失败类别对应的稳定入口结果。 */
export function copilotEntryFailureOutcome(
  kind: CopilotEntryFailureKind,
): CopilotEntryFailureOutcome {
  return FAILURE_OUTCOMES[kind]
}

/**
 * 把一次生产提交失败分类为稳定入口结果。
 *
 * 优先级：显式错误码 → HTTP 状态 → `unknown`。
 * **未识别的错误默认 `unknown`（仍是 live failure）**，绝不回退到演示成功。
 */
export function classifyCopilotEntryFailure(error: unknown): CopilotEntryFailureOutcome {
  if (error && typeof error === 'object') {
    const candidate = error as {
      code?: unknown
      status?: unknown
      error?: { code?: unknown; status?: unknown }
    }
    const code =
      typeof candidate.code === 'string'
        ? candidate.code
        : typeof candidate.error?.code === 'string'
          ? candidate.error.code
          : null
    if (code !== null) {
      const byCode = ERROR_CODE_TO_KIND[code]
      if (byCode !== undefined) return FAILURE_OUTCOMES[byCode]
    }

    const status =
      typeof candidate.status === 'number'
        ? candidate.status
        : typeof candidate.error?.status === 'number'
          ? candidate.error.status
          : null
    if (status !== null) {
      const byStatus = kindFromStatus(status)
      if (byStatus !== null) return FAILURE_OUTCOMES[byStatus]
    }
  }
  return FAILURE_OUTCOMES.unknown
}

/**
 * 演示态准入：**必须**宿主显式声明能力**且**用户显式选择（design D7）。
 *
 * 任意一侧为假即不得进入；提交失败本身永远不是进入条件。
 */
export function canEnterCopilotDemonstration(params: {
  readonly capabilityDeclared: boolean
  readonly userSelected: boolean
}): boolean {
  return params.capabilityDeclared === true && params.userSelected === true
}

export function isCopilotEntryFailureKind(value: string): value is CopilotEntryFailureKind {
  return (COPILOT_ENTRY_FAILURE_KINDS as readonly string[]).includes(value)
}
