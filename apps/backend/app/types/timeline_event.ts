/**
 * 项目活动事件 / Timeline 契约（v2-project-memory-timeline）。
 *
 * Timeline 是项目记忆视图的低敏 DTO，不是 audit_logs 原样透传。
 * 禁止在响应中携带完整 metadata、评论正文、AI prompt/输出、IP、User-Agent、API Key。
 */

/** 事件分类（前端筛选与图标映射）。 */
export type TimelineCategory =
  | 'project'
  | 'task'
  | 'wbs'
  | 'dependency'
  | 'gantt'
  | 'milestone'
  | 'risk'
  | 'change_request'
  | 'document'
  | 'attachment'
  | 'diagram'
  | 'report'
  | 'comment'
  | 'ai_draft'
  | 'draft_layer'
  | 'member'
  | 'other'

/** 重要性：critical/high 视为关键事件候选。 */
export type TimelineImportance = 'low' | 'normal' | 'high' | 'critical'

/**
 * 可见性：
 * - project_member：项目成员可见
 * - admin：组织管理员 / 项目管理者可见
 * - hidden：不进入 Timeline
 */
export type TimelineVisibility = 'project_member' | 'admin' | 'hidden'

/** 触发者摘要（低敏）。 */
export interface TimelineActor {
  id: number | null
  displayName: string
}

/** 目标对象引用（可下钻；不可访问时 targetAccessible=false）。 */
export interface TimelineTargetRef {
  type: string
  id: number | null
  label: string | null
  href: string | null
  accessible: boolean
}

/** 证据引用：指向审计日志，不暴露原始 metadata。 */
export interface TimelineEvidenceRef {
  kind: 'audit_log'
  id: number
}

/** 聚合目标摘要（降噪合并时使用）。 */
export interface TimelineAggregatedTarget {
  type: string
  id: number | null
  label: string | null
}

/**
 * 对外 Timeline 事件 DTO（API 响应）。
 * 前端只渲染本结构，禁止再解析原始审计字段。
 */
export interface TimelineEvent {
  id: string
  organizationId: number
  projectId: number
  /** 稳定语义类型（内部映射码，不直接展示给用户）。 */
  eventType: string
  verb: string
  category: TimelineCategory
  importance: TimelineImportance
  visibility: TimelineVisibility
  occurredAt: string
  actor: TimelineActor
  objectType: string
  objectId: number | null
  summary: string
  secondaryText: string | null
  targetRef: TimelineTargetRef | null
  evidenceRef: TimelineEvidenceRef | null
  /** 是否为关键事件（前端「关键事件」筛选）。 */
  isKeyEvent: boolean
  /** 是否聚合摘要。 */
  isAggregated: boolean
  aggregatedCount: number | null
  aggregatedTargets: TimelineAggregatedTarget[] | null
  /** 实时旁路提示字段（可选）。 */
  realtimeHint?: {
    type: string
    projectId: number
  }
}

/**
 * 内部 ActivityEvent 契约（适配层中间结构）。
 * 未来 `activity_events` 落库时复用同一形状。
 */
export interface ActivityEvent {
  id: string
  organizationId: number
  projectId: number
  source: 'audit_log' | 'activity_events'
  sourceId: number
  eventType: string
  verb: string
  category: TimelineCategory
  importance: TimelineImportance
  visibility: TimelineVisibility
  occurredAt: Date
  actorId: number | null
  objectType: string
  objectId: number | null
  /** 服务端生成的中文摘要（可含目标名占位，脱敏后固化）。 */
  summaryTemplate: string
  objectLabel: string | null
  metadataSnapshot: {
    assigneeId?: number | null
    changedFields?: string[]
    relatedUserIds?: number[]
  } | null
  isKeyEvent: boolean
}

/** 查询筛选。 */
export interface TimelineQueryFilters {
  /** 逗号分隔或数组：category 白名单。 */
  categories?: TimelineCategory[]
  importance?: TimelineImportance[]
  /** 仅关键事件。 */
  keyOnly?: boolean
  /** 与我有关。 */
  relatedToMe?: boolean
  actorId?: number
  from?: Date
  to?: Date
  search?: string
  cursor?: string | null
  perPage?: number
}

export interface TimelineListMeta {
  total: number | null
  perPage: number
  hasMore: boolean
  nextCursor: string | null
  /** 固定标识：无 activity_events 表时仍可派生。 */
  source: 'audit_derived'
}

export interface TimelineListResult {
  data: TimelineEvent[]
  meta: TimelineListMeta
}

/** 实时旁路事件类型。 */
export const TIMELINE_REALTIME_EVENT = 'timeline:activity' as const
