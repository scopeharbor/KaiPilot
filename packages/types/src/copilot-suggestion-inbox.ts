/**
 * v3-copilot-suggestion-inbox — 五来源 AI 建议收件箱共享契约
 *
 * 核心设计纪律：
 * - 只存状态与去重元数据，**不存建议正文**
 * - 五态生命周期，禁止隐式状态推断
 * - source hash 失配驱动的自动过期，且必须说明原因
 * - 确定性排序（严重度/影响面 + 时效 + 稳定破平局），不含个性化权重
 * - 跨来源去重合并，按问题种类声明的去重键，禁止文本相似度聚类
 * - 采纳必经已归档动作边界的 preview 通道，无直写路径
 * - 单来源不可用时降级为标注缺失的部分聚合，不静默省略
 */

// ---------------------------------------------------------------------------
// 五来源标识
// ---------------------------------------------------------------------------

/** 五来源枚举，与既有能力一一对应 */
export const INBOX_SOURCE_KINDS = [
  /** 智能推荐 */
  'smart_recommendation',
  /** 进度与风险预测 */
  'progress_risk_prediction',
  /** AI 风险识别建议 */
  'risk_ai_suggestion',
  /** PMO 优先级推荐 */
  'pmo_priority_recommendation',
  /** 项目健康诊断 AI 草案 */
  'health_diagnosis_draft',
] as const

export type InboxSourceKind = (typeof INBOX_SOURCE_KINDS)[number]

/** 来源 kind 标签（低敏展示） */
export const INBOX_SOURCE_KIND_LABELS: Record<InboxSourceKind, string> = {
  smart_recommendation: '智能推荐',
  progress_risk_prediction: '进度与风险预测',
  risk_ai_suggestion: 'AI 风险识别',
  pmo_priority_recommendation: 'PMO 优先级推荐',
  health_diagnosis_draft: '健康诊断 AI 草案',
}

// ---------------------------------------------------------------------------
// 问题种类 —— 去重键的基础
// ---------------------------------------------------------------------------

/** 问题种类枚举，每种去重键按此分类声明 */
export const INBOX_PROBLEM_KINDS = [
  'resource_overload',
  'schedule_risk',
  'dependency_block',
  'milestone_pressure',
  'risk_escalation',
  'data_staleness',
  'quality_issue',
  'scope_change_impact',
  'cost_overrun',
  'process_gap',
  'other',
] as const

export type InboxProblemKind = (typeof INBOX_PROBLEM_KINDS)[number]

export const INBOX_PROBLEM_KIND_LABELS: Record<InboxProblemKind, string> = {
  resource_overload: '资源超载',
  schedule_risk: '进度风险',
  dependency_block: '依赖阻塞',
  milestone_pressure: '里程碑压力',
  risk_escalation: '风险升级',
  data_staleness: '数据陈旧',
  quality_issue: '质量问题',
  scope_change_impact: '范围变更影响',
  cost_overrun: '成本超支',
  process_gap: '流程缺陷',
  other: '其他',
}

// ---------------------------------------------------------------------------
// 严重度 / 影响面
// ---------------------------------------------------------------------------

export const INBOX_SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low', 'info'] as const
export type InboxSeverity = (typeof INBOX_SEVERITY_LEVELS)[number]

export const INBOX_SEVERITY_LABELS: Record<InboxSeverity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '信息',
}

/**
 * 严重度数值排序权重（越高越优先）。
 * 用于确定性排序，不含个性化权重。
 */
export function inboxSeverityScore(severity: InboxSeverity): number {
  const map: Record<InboxSeverity, number> = {
    critical: 50,
    high: 40,
    medium: 30,
    low: 20,
    info: 10,
  }
  return map[severity] ?? 0
}

// ---------------------------------------------------------------------------
// 五态生命周期
// ---------------------------------------------------------------------------

export const INBOX_ENTRY_STATES = ['unread', 'read', 'adopted', 'dismissed', 'expired'] as const

export type InboxEntryState = (typeof INBOX_ENTRY_STATES)[number]

export const INBOX_ENTRY_STATE_LABELS: Record<InboxEntryState, string> = {
  unread: '未读',
  read: '已读',
  adopted: '已采纳',
  dismissed: '已忽略',
  expired: '已过期',
}

/**
 * 合法状态迁移表。
 * 纪律：状态迁移必须由显式动作或时效驱动，不作为不触发任何迁移。
 * - unread → read：查看即已读
 * - read → adopted：显式采纳（走 preview 通道）
 * - read → dismissed：显式忽略
 * - unread/read → expired：source hash 失配自动过期
 * - 终态：adopted / dismissed / expired 不可迁移
 */
export const INBOX_VALID_TRANSITIONS: Record<InboxEntryState, readonly InboxEntryState[]> = {
  unread: ['read', 'expired'],
  read: ['adopted', 'dismissed', 'expired'],
  adopted: [],
  dismissed: [],
  expired: [],
}

/**
 * 确定状态迁移是否合法。
 */
export function canInboxTransition(from: InboxEntryState, to: InboxEntryState): boolean {
  return INBOX_VALID_TRANSITIONS[from].includes(to)
}

// ---------------------------------------------------------------------------
// 过期原因
// ---------------------------------------------------------------------------

export const INBOX_EXPIRY_REASON_KINDS = [
  'schedule_changed',
  'resource_changed',
  'risk_changed',
  'scope_changed',
  'data_refreshed',
  'other_changed',
] as const

export type InboxExpiryReasonKind = (typeof INBOX_EXPIRY_REASON_KINDS)[number]

export const INBOX_EXPIRY_REASON_LABELS: Record<InboxExpiryReasonKind, string> = {
  schedule_changed: '排期已变更',
  resource_changed: '资源分配已变更',
  risk_changed: '风险状态已变更',
  scope_changed: '项目范围已变更',
  data_refreshed: '数据已刷新',
  other_changed: '相关数据已变更',
}

// ---------------------------------------------------------------------------
// 来源引用
// ---------------------------------------------------------------------------

/**
 * 来源引用：指向建议的原始来源。
 * 收件箱只存引用，不复制建议正文。
 */
export interface InboxSourceRef {
  /** 来源能力标识 */
  sourceKind: InboxSourceKind
  /** 来源侧的建议/条目 ID */
  sourceId: string
  /** 来源侧的项目 ID（跨项目来源用） */
  projectId: string
  /** 来源内容 hash（用于过期判定） */
  sourceHash: string
  /** 来源捕获时间 */
  capturedAt: string
}

// ---------------------------------------------------------------------------
// 去重键
// ---------------------------------------------------------------------------

/**
 * 去重键：按问题种类声明，禁止文本相似度聚类。
 * 同一问题种类 + 相同声明键 = 合并为一条。
 */
export interface InboxDedupeKey {
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 按问题种类声明的确定性键（由来源提供，不含自由文本） */
  declaredKey: string
}

// ---------------------------------------------------------------------------
// 收件箱条目（持久化形状 —— **不含建议正文**）
// ---------------------------------------------------------------------------

export interface InboxEntry {
  /** 条目 ID（UUID） */
  id: string
  /** 组织 ID（组织隔离） */
  organizationId: string
  /** 项目 ID */
  projectId: string
  /** 当前状态 */
  state: InboxEntryState
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 严重度 */
  severity: InboxSeverity
  /** 去重键（组合唯一） */
  dedupeKey: InboxDedupeKey
  /** 来源引用列表（多来源合并时有多个） */
  sourceRefs: readonly InboxSourceRef[]
  /** 过期原因（state=expired 时必填） */
  expiryReason: InboxExpiryReasonKind | null
  /** 过期详情说明（指明哪类事实已变更） */
  expiryDetail: string | null
  /** 创建时间 */
  createdAt: string
  /** 最后更新时间 */
  updatedAt: string
  /** 最后查看时间（state=read 时有值） */
  readAt: string | null
  /** 用户动作时间（state=adopted/dismissed 时有值） */
  actionedAt: string | null
  /**
   * 读取时按主来源引用回源投影的正文（**不落库**）。
   * 未投影（如聚合中间态）时缺省；无权查看来源或来源已不可读时为 null。
   */
  content?: InboxEntryContent | null
}

/** 收件箱条目的回源正文投影（查询时现读，不持久化）。 */
export interface InboxEntryContent {
  /** 标题 */
  title: string
  /** 摘要 / 证据说明 */
  summary: string | null
  /** 来源给出的建议动作 */
  suggestedAction: string | null
}

// ---------------------------------------------------------------------------
// 部分聚合结果
// ---------------------------------------------------------------------------

/**
 * 来源不可用标注。
 * 降级为部分聚合时，标注哪些来源缺失。
 */
export interface InboxMissingSource {
  sourceKind: InboxSourceKind
  reason: string
}

/**
 * 聚合查询结果。
 */
export interface InboxAggregateResult {
  /** 聚合后的条目列表 */
  entries: readonly InboxEntry[]
  /** 总数（去重后） */
  total: number
  /** 未读计数 */
  unreadCount: number
  /** 不可用来源列表（不静默省略） */
  missingSources: readonly InboxMissingSource[]
  /** 分页信息 */
  pagination: {
    page: number
    perPage: number
    totalPages: number
  }
}

// ---------------------------------------------------------------------------
// 排序键
// ---------------------------------------------------------------------------

export const INBOX_SORT_FIELDS = ['severity', 'createdAt', 'updatedAt'] as const
export type InboxSortField = (typeof INBOX_SORT_FIELDS)[number]
export type InboxSortDirection = 'asc' | 'desc'

export interface InboxSortKey {
  field: InboxSortField
  direction: InboxSortDirection
}

/**
 * 默认排序：严重度降序 → 创建时间降序 → id 升序（稳定破平局）。
 * 不含个性化权重。
 */
export const INBOX_DEFAULT_SORT: readonly InboxSortKey[] = [
  { field: 'severity', direction: 'desc' },
  { field: 'createdAt', direction: 'desc' },
]

// ---------------------------------------------------------------------------
// 查询参数
// ---------------------------------------------------------------------------

export interface InboxQueryParams {
  projectId?: string
  sourceKind?: InboxSourceKind
  state?: InboxEntryState
  severity?: InboxSeverity
  /** 时间窗下限（ISO 8601） */
  since?: string
  /** 时间窗上限（ISO 8601） */
  until?: string
  page?: number
  perPage?: number
  sort?: readonly InboxSortKey[]
}

// ---------------------------------------------------------------------------
// 状态变更动作
// ---------------------------------------------------------------------------

export const INBOX_ACTIONS = ['mark_read', 'adopt', 'dismiss'] as const
export type InboxAction = (typeof INBOX_ACTIONS)[number]

export interface InboxStateChangeRequest {
  entryId: InboxEntry['id']
  action: InboxAction
}

// ---------------------------------------------------------------------------
// 来源标记（反馈事件区分）
// ---------------------------------------------------------------------------

/**
 * 反馈事件中的 inbox 来源标记。
 * 用于区分主动建议采纳率与会话内建议采纳率。
 */
export const INBOX_FEEDBACK_ORIGIN = 'inbox_suggestion' as const

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

export function isInboxSourceKind(v: unknown): v is InboxSourceKind {
  return typeof v === 'string' && (INBOX_SOURCE_KINDS as readonly string[]).includes(v)
}

export function isInboxProblemKind(v: unknown): v is InboxProblemKind {
  return typeof v === 'string' && (INBOX_PROBLEM_KINDS as readonly string[]).includes(v)
}

export function isInboxSeverity(v: unknown): v is InboxSeverity {
  return typeof v === 'string' && (INBOX_SEVERITY_LEVELS as readonly string[]).includes(v)
}

export function isInboxEntryState(v: unknown): v is InboxEntryState {
  return typeof v === 'string' && (INBOX_ENTRY_STATES as readonly string[]).includes(v)
}

export function isInboxAction(v: unknown): v is InboxAction {
  return typeof v === 'string' && (INBOX_ACTIONS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// 确定性排序函数
// ---------------------------------------------------------------------------

/**
 * 确定性比较器：严重度降序 → createdAt 降序 → id 升序。
 * 禁止个性化权重。
 */
export function compareInboxEntries(a: InboxEntry, b: InboxEntry): number {
  // 严重度降序
  const sevDiff = inboxSeverityScore(b.severity) - inboxSeverityScore(a.severity)
  if (sevDiff !== 0) return sevDiff
  // 创建时间降序
  const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  if (timeDiff !== 0) return timeDiff
  // id 升序（稳定破平局）
  return a.id.localeCompare(b.id)
}

/**
 * 稳定排序条目（不改变原数组）。
 */
export function sortInboxEntries(entries: readonly InboxEntry[]): InboxEntry[] {
  return [...entries].sort(compareInboxEntries)
}

// ---------------------------------------------------------------------------
// 去重键派生
// ---------------------------------------------------------------------------

/**
 * 声明式去重键（按问题种类）。
 * 不使用文本相似度聚类。
 */
export function deriveInboxDedupeKey(
  problemKind: InboxProblemKind,
  declaredKey: string,
): InboxDedupeKey {
  return { problemKind, declaredKey }
}

/**
 * 去重键序列化为稳定字符串（用于 map key 或 DB 唯一约束）。
 */
export function serializeInboxDedupeKey(key: InboxDedupeKey): string {
  return `${key.problemKind}::${key.declaredKey}`
}

// ---------------------------------------------------------------------------
// 低敏 sanitizers
// ---------------------------------------------------------------------------

/**
 * 低敏化条目摘要（用于日志/审计）。
 * 不暴露来源详情、去重键内部或正文。
 */
export function sanitizeInboxEntrySummary(entry: InboxEntry): {
  id: string
  state: InboxEntryState
  problemKind: InboxProblemKind
  severity: InboxSeverity
  sourceCount: number
  expired: boolean
} {
  return {
    id: entry.id,
    state: entry.state,
    problemKind: entry.problemKind,
    severity: entry.severity,
    sourceCount: entry.sourceRefs.length,
    expired: entry.state === 'expired',
  }
}
