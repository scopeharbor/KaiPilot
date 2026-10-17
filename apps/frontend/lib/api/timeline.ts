import { apiFetchEnvelope } from '@/lib/api-client'

/**
 * 项目记忆 Timeline API 契约（v2-project-memory-timeline）。
 *
 * 前端只消费服务端已脱敏的 TimelineEvent DTO：不接收原始 audit metadata、
 * 评论正文、AI prompt/输出、IP、User-Agent 或 API Key。
 */

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

export type TimelineImportance = 'low' | 'normal' | 'high' | 'critical'
export type TimelineVisibility = 'project_member' | 'admin' | 'hidden'

export interface TimelineActor {
  id: number | null
  displayName: string
}

export interface TimelineTargetRef {
  type: string
  id: number | null
  label: string | null
  href: string | null
  accessible: boolean
}

export interface TimelineEvidenceRef {
  kind: 'audit_log'
  id: number
}

export interface TimelineAggregatedTarget {
  type: string
  id: number | null
  label: string | null
}

export interface TimelineEvent {
  id: string
  organizationId: number
  projectId: number
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
  isKeyEvent: boolean
  isAggregated: boolean
  aggregatedCount: number | null
  aggregatedTargets: TimelineAggregatedTarget[] | null
}

export interface TimelineListMeta {
  total: number | null
  perPage: number
  hasMore: boolean
  nextCursor: string | null
  source: 'audit_derived'
}

export interface TimelineListResponse {
  data: TimelineEvent[]
  meta: TimelineListMeta
}

/** 前端筛选态（写入 URL search params）。 */
export interface TimelineFilters {
  categories?: TimelineCategory[]
  importance?: TimelineImportance[]
  keyOnly?: boolean
  relatedToMe?: boolean
  search?: string
  from?: string
  to?: string
  perPage?: number
}

function buildQuery(filters: TimelineFilters, cursor?: string | null): string {
  const params = new URLSearchParams()
  if (filters.categories && filters.categories.length > 0) {
    params.set('category', filters.categories.join(','))
  }
  if (filters.importance && filters.importance.length > 0) {
    params.set('importance', filters.importance.join(','))
  }
  if (filters.keyOnly) params.set('keyOnly', 'true')
  if (filters.relatedToMe) params.set('relatedToMe', 'true')
  if (filters.search) params.set('search', filters.search)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}

export const timelineApi = {
  list: (projectId: number, filters: TimelineFilters, cursor?: string | null) =>
    apiFetchEnvelope<TimelineListResponse>(
      `/projects/${projectId}/timeline?${buildQuery(filters, cursor)}`,
    ),
}

export const timelineKeys = {
  all: ['timeline'] as const,
  lists: (projectId: number) => [...timelineKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: TimelineFilters) =>
    [...timelineKeys.lists(projectId), filters] as const,
}
