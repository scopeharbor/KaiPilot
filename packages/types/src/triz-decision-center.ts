/**
 * v3-triz-decision-center —— TRIZ 决策中心共享契约（前后端共享）。
 *
 * 项目级 TRIZ 决策中心，聚合矛盾、Compiler TRIZ 分析 artifact、推荐理由、
 * 创新工作台方案、Draft Layer 阻断和既有决策日志，形成可过滤的决策队列与概览。
 *
 * 红线：
 * - 中心采用派生 read model，默认不持久化完整 artifact
 * - 所有 DTO 仅含低敏摘要，不存完整 prompt/模型输出/artifact payload/token/secret
 * - 权限脱敏：无权限时不仅隐藏详情，也不泄露数量或 source existence
 * - AI 草稿理由只作为可选辅助，不自动保存
 */

// ---------------------------------------------------------------------------
// 枚举常量
// ---------------------------------------------------------------------------

/** 决策中心来源种类 */
export const TRIZ_DECISION_CENTER_SOURCE_KINDS = [
  'contradiction',
  'compiler_triz_analysis',
  'recommendation_rationale',
  'innovation_workbench',
  'draft_blocker',
  'decision_log',
] as const

export type TrizDecisionCenterSourceKind = (typeof TRIZ_DECISION_CENTER_SOURCE_KINDS)[number]

/** 队列状态 */
export const TRIZ_DECISION_CENTER_QUEUE_STATUSES = [
  'pending_decision',
  'missing_reason',
  'stale_source',
  'ready_for_draft',
  'blocked',
  'recently_decided',
] as const

export type TrizDecisionCenterQueueStatus = (typeof TRIZ_DECISION_CENTER_QUEUE_STATUSES)[number]

/** Draft readiness 状态 */
export const TRIZ_DECISION_CENTER_READINESS_STATES = [
  'ready',
  'not_ready',
  'blocked',
  'stale',
  'unknown',
] as const

export type TrizDecisionCenterReadinessState =
  (typeof TRIZ_DECISION_CENTER_READINESS_STATES)[number]

/** 决策中心允许的动作 */
export const TRIZ_DECISION_CENTER_ALLOWED_ACTIONS = [
  'adopt',
  'reject',
  'partial_accept',
  'modified_accept',
  'supplement',
  'supersede',
  'request_clarification',
  'generate_reason_draft',
  'start_draft_review',
  'view_detail',
] as const

export type TrizDecisionCenterAllowedAction = (typeof TRIZ_DECISION_CENTER_ALLOWED_ACTIONS)[number]

/** 决策中心 warning codes */
export const TRIZ_DECISION_CENTER_WARNING_CODES = [
  'TRIZ_DC_MISSING_SOURCE',
  'TRIZ_DC_STALE_SOURCE_HASH',
  'TRIZ_DC_INACCESSIBLE_TARGET',
  'TRIZ_DC_PERMISSION_DENIED',
  'TRIZ_DC_AI_FALLBACK',
  'TRIZ_DC_NO_DECISION_LOG',
  'TRIZ_DC_SOURCE_ERROR',
  'TRIZ_DC_CROSS_ORG_REF',
  'TRIZ_DC_REASON_TRUNCATED',
] as const

export type TrizDecisionCenterWarningCode = (typeof TRIZ_DECISION_CENTER_WARNING_CODES)[number]

/** 排序字段 */
export const TRIZ_DECISION_CENTER_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'priority',
  'source_kind',
  'queue_status',
] as const

export type TrizDecisionCenterSortField = (typeof TRIZ_DECISION_CENTER_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// 核心类型
// ---------------------------------------------------------------------------

/** 来源摘要（低敏） */
export interface TrizDecisionCenterSourceDigest {
  /** 来源种类 */
  sourceKind: TrizDecisionCenterSourceKind
  /** 来源唯一 ID */
  sourceId: string
  /** 来源 hash（用于 stale 检测） */
  sourceHash: string
  /** 低敏可读标题 */
  title: string
  /** 来源简要摘要（不含敏感内容） */
  summary: string | null
  /** 导航 ref（如矛盾 ID、artifact ID 等） */
  navigationRef: string | null
  /** 来源是否当前可访问 */
  accessible: boolean
}

/** 队列项 */
export interface TrizDecisionCenterItem {
  /** 稳定 item ID（从来源派生） */
  id: string
  /** 项目 ID */
  projectId: number
  /** 组织 ID */
  organizationId: number

  /** 队列状态 */
  queueStatus: TrizDecisionCenterQueueStatus
  /** 来源摘要 */
  source: TrizDecisionCenterSourceDigest

  /** 低敏主题摘要 */
  subjectSummary: string
  /** 优先级（1-10，10 最高） */
  priority: number
  /** warning 列表 */
  warnings: TrizDecisionCenterWarning[]

  /** 关联的决策日志 ID 列表 */
  relatedDecisionLogIds: number[]
  /** Draft readiness 状态 */
  readiness: TrizDecisionCenterReadinessState
  /** 允许的动作 */
  allowedActions: TrizDecisionCenterAllowedAction[]

  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string

  /** 是否有权限查看详情 */
  hasAccess: boolean
}

/** Warning */
export interface TrizDecisionCenterWarning {
  code: TrizDecisionCenterWarningCode
  message: string
  details?: string[]
}

/** 决策中心摘要 */
export interface TrizDecisionCenterSummary {
  /** 各队列状态计数 */
  queueCounts: Record<TrizDecisionCenterQueueStatus, number>
  /** 各来源种类计数 */
  sourceCounts: Record<TrizDecisionCenterSourceKind, number>
  /** warning 聚合（每种 warning code 的计数） */
  warningCounts: Record<TrizDecisionCenterWarningCode, number>
  /** 最近关键决策（最多 5 条） */
  recentKeyDecisions: TrizDecisionCenterItem[]
  /** 总 item 数 */
  totalItems: number
  /** 可进入 Draft 审查的 item 数 */
  readyForDraftCount: number
  /** 阻塞项数 */
  blockedCount: number
}

/** 决策中心详情 */
export interface TrizDecisionCenterDetail {
  /** 基础 item */
  item: TrizDecisionCenterItem
  /** 证据链（低敏来源摘要列表） */
  evidenceChain: TrizDecisionCenterSourceDigest[]
  /** 关联的决策日志时间线 */
  decisionTimeline: TrizDecisionCenterTimelineEvent[]
  /** 相关 Draft 阻断信息 */
  draftBlockerInfo: TrizDecisionCenterDraftBlockerInfo | null
  /** 推荐理由摘要 */
  rationaleSummary: string | null
  /** 创新方案摘要 */
  workbenchSchemeSummary: string | null
}

/** 决策时间线事件 */
export interface TrizDecisionCenterTimelineEvent {
  id: number
  decisionType: string
  reasonSummary: string
  createdBy: number
  createdAt: string
  hasAccess: boolean
}

/** Draft 阻断信息 */
export interface TrizDecisionCenterDraftBlockerInfo {
  /** 是否被阻断 */
  blocked: boolean
  /** 阻断原因 */
  reason: string | null
  /** 需要的决策类型 */
  requiredDecisionTypes: string[]
  /** 关联的 Draft 候选 ID */
  draftCandidateId: string | null
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 摘要请求 */
export interface TrizDecisionCenterSummaryRequest {
  projectId: number
}

/** 摘要响应 */
export interface TrizDecisionCenterSummaryResponse {
  data: TrizDecisionCenterSummary
}

/** 队列列表过滤参数 */
export interface TrizDecisionCenterListFilters {
  status?: TrizDecisionCenterQueueStatus
  sourceKind?: TrizDecisionCenterSourceKind
  warning?: TrizDecisionCenterWarningCode
  priority?: number
  search?: string
  page?: number
  perPage?: number
  sort?: string
}

/** 队列列表响应 */
export interface TrizDecisionCenterListResponse {
  data: TrizDecisionCenterItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 详情响应 */
export interface TrizDecisionCenterDetailResponse {
  data: TrizDecisionCenterDetail
}

/** Readiness 响应 */
export interface TrizDecisionCenterReadinessResponse {
  data: {
    readyItems: TrizDecisionCenterItem[]
    blockedItems: TrizDecisionCenterItem[]
    staleItems: TrizDecisionCenterItem[]
    summary: {
      totalReady: number
      totalBlocked: number
      totalStale: number
      recommendations: string[]
    }
  }
}

/** 动作请求（创建/补充/废止决策） */
export interface TrizDecisionCenterActionRequest {
  /** 动作类型 */
  action: TrizDecisionCenterAllowedAction
  /** 目标 item ID */
  itemId: string
  /** 来源 refs */
  sourceRefs: {
    kind: string
    id: string
    hash: string
    summary?: string | null
  }[]
  /** 低敏理由 */
  reasonSummary: string
  /** 显式确认元数据 */
  confirmation: {
    confirmed: boolean
    confirmedBy: number
    confirmedAt: string
    sourceHashes: string[]
    warningAcknowledged: boolean
  }
}

/** AI 理由草稿请求 */
export interface TrizDecisionCenterAiDraftRequest {
  itemId: string
  sourceRefs: {
    kind: string
    id: string
    hash: string
  }[]
}

/** AI 理由草稿响应 */
export interface TrizDecisionCenterAiDraftResponse {
  data: {
    draftReason: string
    warnings: TrizDecisionCenterWarning[]
    costSummary: {
      provider: string | null
      model: string | null
      tokens: number
      cost: number | null
      latencyMs: number | null
      budgetDecision: string
      fallback: boolean
    } | null
    isFallback: boolean
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 从来源摘要生成稳定 item ID。
 */
export function computeDecisionCenterItemId(
  sourceKind: TrizDecisionCenterSourceKind,
  sourceId: string,
  sourceHash: string,
): string {
  const input = `${sourceKind}:${sourceId}:${sourceHash}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return `dc-${hash.toString(16).padStart(8, '0')}`
}

/**
 * 比较两个来源 hash 是否相同。
 * 用于 stale 检测。
 */
export function isSourceHashStale(currentHash: string, recordedHash: string): boolean {
  return currentHash !== recordedHash
}

/**
 * 队列分组：按 queue status 分组 items。
 */
export function groupItemsByQueueStatus(
  items: TrizDecisionCenterItem[],
): Record<TrizDecisionCenterQueueStatus, TrizDecisionCenterItem[]> {
  const groups: Record<TrizDecisionCenterQueueStatus, TrizDecisionCenterItem[]> = {
    pending_decision: [],
    missing_reason: [],
    stale_source: [],
    ready_for_draft: [],
    blocked: [],
    recently_decided: [],
  }
  for (const item of items) {
    groups[item.queueStatus].push(item)
  }
  return groups
}

/**
 * 摘要计数：从 items 列表计算队列计数、来源计数、warning 计数。
 */
export function computeDecisionCenterSummary(
  items: TrizDecisionCenterItem[],
): Pick<
  TrizDecisionCenterSummary,
  'queueCounts' | 'sourceCounts' | 'warningCounts' | 'totalItems'
> {
  const queueCounts: Record<TrizDecisionCenterQueueStatus, number> = {
    pending_decision: 0,
    missing_reason: 0,
    stale_source: 0,
    ready_for_draft: 0,
    blocked: 0,
    recently_decided: 0,
  }
  const sourceCounts: Record<TrizDecisionCenterSourceKind, number> = {
    contradiction: 0,
    compiler_triz_analysis: 0,
    recommendation_rationale: 0,
    innovation_workbench: 0,
    draft_blocker: 0,
    decision_log: 0,
  }
  const warningCounts: Record<TrizDecisionCenterWarningCode, number> = {
    TRIZ_DC_MISSING_SOURCE: 0,
    TRIZ_DC_STALE_SOURCE_HASH: 0,
    TRIZ_DC_INACCESSIBLE_TARGET: 0,
    TRIZ_DC_PERMISSION_DENIED: 0,
    TRIZ_DC_AI_FALLBACK: 0,
    TRIZ_DC_NO_DECISION_LOG: 0,
    TRIZ_DC_SOURCE_ERROR: 0,
    TRIZ_DC_CROSS_ORG_REF: 0,
    TRIZ_DC_REASON_TRUNCATED: 0,
  }

  for (const item of items) {
    queueCounts[item.queueStatus]++
    sourceCounts[item.source.sourceKind]++
    for (const w of item.warnings) {
      warningCounts[w.code]++
    }
  }

  return { queueCounts, sourceCounts, warningCounts, totalItems: items.length }
}

/**
 * Warning 聚合：合并相同 code 的 warning，保留最严重的 message。
 */
export function aggregateWarnings(
  warnings: TrizDecisionCenterWarning[],
): TrizDecisionCenterWarning[] {
  const map = new Map<TrizDecisionCenterWarningCode, TrizDecisionCenterWarning>()
  for (const w of warnings) {
    const existing = map.get(w.code)
    if (!existing) {
      map.set(w.code, { ...w })
    } else {
      existing.details = [...(existing.details ?? []), ...(w.details ?? [])]
    }
  }
  return Array.from(map.values())
}

/**
 * 脱敏：移除可能包含敏感信息的字段。
 * 返回安全的 item，不含完整 payload 或 token 类内容。
 */
export function redactSensitiveItemData(item: TrizDecisionCenterItem): TrizDecisionCenterItem {
  return {
    ...item,
    source: {
      ...item.source,
      summary: item.source.accessible
        ? sanitizeDecisionCenterText(item.source.summary ?? '')
        : null,
    },
    subjectSummary: sanitizeDecisionCenterText(item.subjectSummary),
  }
}

/**
 * 文本脱敏：替换疑似 token/密钥/路径。
 */
export function sanitizeDecisionCenterText(text: string): string {
  return text
    .replace(/[A-Za-z0-9+/=]{32,}/g, '[REDACTED]')
    .replace(/(?:\/[a-zA-Z0-9_\-./]+)+/g, '[REDACTED_PATH]')
    .replace(/(?:bearer|token|auth|api[_-]?key)\s+[A-Za-z0-9\-_.+/=]{8,}/gi, '[REDACTED]')
}

/**
 * 稳定排序：按指定字段排序 items。
 */
export function sortDecisionCenterItems(
  items: TrizDecisionCenterItem[],
  sortField: TrizDecisionCenterSortField,
  direction: 'asc' | 'desc' = 'asc',
): TrizDecisionCenterItem[] {
  const sorted = [...items]
  const dir = direction === 'asc' ? 1 : -1

  sorted.sort((a, b) => {
    switch (sortField) {
      case 'created_at':
        return a.createdAt.localeCompare(b.createdAt) * dir
      case 'updated_at':
        return a.updatedAt.localeCompare(b.updatedAt) * dir
      case 'priority':
        return (a.priority - b.priority) * dir
      case 'source_kind':
        return a.source.sourceKind.localeCompare(b.source.sourceKind) * dir
      case 'queue_status':
        return a.queueStatus.localeCompare(b.queueStatus) * dir
      default:
        return 0
    }
  })

  return sorted
}

/**
 * 过滤 items：按 filter 条件过滤。
 */
export function filterDecisionCenterItems(
  items: TrizDecisionCenterItem[],
  filters: TrizDecisionCenterListFilters,
): TrizDecisionCenterItem[] {
  return items.filter((item) => {
    if (filters.status && item.queueStatus !== filters.status) return false
    if (filters.sourceKind && item.source.sourceKind !== filters.sourceKind) return false
    if (filters.warning && !item.warnings.some((w) => w.code === filters.warning)) return false
    if (filters.priority != null && item.priority !== filters.priority) return false
    if (filters.search && !item.subjectSummary.toLowerCase().includes(filters.search.toLowerCase()))
      return false
    return true
  })
}

/**
 * 判断 item 是否可以进入 Draft review。
 */
export function canEnterDraftReview(item: TrizDecisionCenterItem): boolean {
  return (
    item.allowedActions.includes('start_draft_review') &&
    item.readiness === 'ready' &&
    !item.warnings.some((w) => w.code === 'TRIZ_DC_STALE_SOURCE_HASH')
  )
}

/**
 * 判断 action 是否需要显式确认。
 */
export function requiresExplicitConfirmation(action: TrizDecisionCenterAllowedAction): boolean {
  return (
    action === 'adopt' ||
    action === 'reject' ||
    action === 'partial_accept' ||
    action === 'modified_accept' ||
    action === 'supersede'
  )
}

/**
 * 验证确认元数据是否完整。
 */
export function validateConfirmation(
  confirmation: TrizDecisionCenterActionRequest['confirmation'],
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!confirmation) {
    errors.push('confirmation is required')
    return { valid: false, errors }
  }
  if (!confirmation.confirmed) errors.push('confirmation.confirmed must be true')
  if (!confirmation.confirmedBy) errors.push('confirmation.confirmedBy is required')
  if (!confirmation.confirmedAt) errors.push('confirmation.confirmedAt is required')
  if (!confirmation.sourceHashes || confirmation.sourceHashes.length === 0)
    errors.push('confirmation.sourceHashes must not be empty')
  if (!confirmation.warningAcknowledged)
    errors.push('confirmation.warningAcknowledged must be true')
  return { valid: errors.length === 0, errors }
}

/**
 * 从 queue status 确定默认优先级。
 */
export function defaultPriorityForStatus(status: TrizDecisionCenterQueueStatus): number {
  switch (status) {
    case 'blocked':
      return 10
    case 'stale_source':
      return 9
    case 'pending_decision':
      return 7
    case 'missing_reason':
      return 5
    case 'ready_for_draft':
      return 3
    case 'recently_decided':
      return 1
    default:
      return 5
  }
}
