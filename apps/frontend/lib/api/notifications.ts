import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

/** 通知类型（与后端 NotificationType 一致）。 */
export type NotificationType =
  | 'task_assigned'
  | 'task_unassigned'
  | 'task_blocked'
  | 'task_completed'
  | 'task_schedule_changed'
  | 'task_predecessor_pending'
  | 'comment_added'
  | 'attachment_added'
  | 'project_archived'
  | 'project_restored'
  | 'milestone_due'
  | 'milestone_overdue'
  | 'ai_draft_confirmed'
  | 'ai_draft_imported'
  | 'report_exported'
  | 'report_export_failed'
  | 'general'

/** 通知严重级别。 */
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'critical'

/** 通知目标引用（多态）。 */
export interface NotificationTarget {
  type: string
  id: number
}

/** 通知对外 DTO（V2 扩展：含 hiddenAt 和低敏摘要）。 */
export interface Notification {
  id: number
  organizationId: number
  recipientId: number
  type: NotificationType
  title: string
  body: string | null
  severity: NotificationSeverity
  projectId: number | null
  target: NotificationTarget | null
  actionUrl: string | null
  readAt: string | null
  hiddenAt: string | null
  /** 目标资源访问状态：accessible / inaccessible / unknown */
  accessStatus?: 'accessible' | 'inaccessible' | 'unknown' | null
  /** 低敏目标摘要 */
  targetSummary?: {
    type: string
    status?: string
    genericTitle?: string
  } | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface NotificationListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface NotificationListResponse {
  data: Notification[]
  meta: NotificationListMeta
}

export interface UnreadCountResponse {
  unreadCount: number
}

export interface MarkReadResponse {
  success: boolean
  readAt: string
}

export interface MarkAllReadResponse {
  success: boolean
  markedCount: number
}

// ---------- 通知中心 V2 新增类型 ----------

/** 通知类型分组（用于通知中心视图切换）。 */
export type NotificationTypeGroup =
  'all' | 'unread' | 'mentions' | 'assignments' | 'approvals' | 'system'

/** 通知中心筛选参数。 */
export interface NotificationCenterFilters {
  status?: 'read' | 'unread' | 'all'
  typeGroup?: NotificationTypeGroup
  type?: NotificationType
  severity?: NotificationSeverity
  projectId?: number
  dateFrom?: string
  dateTo?: string
  relatedToMe?: boolean
  hidden?: 'include' | 'exclude' | 'only'
  page?: number
  perPage?: number
}

/** 批量操作类型。 */
export type NotificationBatchAction = 'mark_read' | 'mark_unread' | 'hide'

/** 批量操作请求。 */
export interface NotificationBatchRequest {
  action: NotificationBatchAction
  notificationIds?: number[]
}

/** 批量操作响应。 */
export interface NotificationBatchResponse {
  success: boolean
  affectedCount: number
  action: NotificationBatchAction
}

/** 列表查询过滤参数。 */
export interface NotificationListFilters {
  page?: number
  perPage?: number
  status?: 'read' | 'unread' | 'all'
  type?: NotificationType
  severity?: NotificationSeverity
  projectId?: number
  dateFrom?: string
  dateTo?: string
  typeGroup?: NotificationTypeGroup
  hidden?: 'include' | 'exclude' | 'only'
}

function buildQuery(filters: NotificationListFilters): string {
  const params = new URLSearchParams()
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  if (filters.status) params.set('status', filters.status)
  if (filters.type) params.set('type', filters.type)
  if (filters.severity) params.set('severity', filters.severity)
  if (filters.projectId) params.set('projectId', String(filters.projectId))
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.typeGroup) params.set('typeGroup', filters.typeGroup)
  if (filters.hidden) params.set('hidden', filters.hidden)
  return params.size ? `?${params.toString()}` : ''
}

/**
 * 通知 API：
 * - GET  /api/v1/notifications          列表（支持通知中心筛选参数）
 * - GET  /api/v1/notifications/unread-count  未读数
 * - PATCH /api/v1/notifications/:id/read   单条已读
 * - PATCH /api/v1/notifications/read-all    全部已读
 * - POST /api/v1/notifications/batch      批量操作（V2 通知中心新增）
 */
export const notificationsApi = {
  /** 通知列表（支持通知中心扩展参数）。 */
  list: (filters: NotificationListFilters = {}) =>
    apiFetchEnvelope<NotificationListResponse>(`/notifications${buildQuery(filters)}`),

  /** 未读通知数量。 */
  unreadCount: () => apiFetch<UnreadCountResponse>('/notifications/unread-count'),

  /** 标记单条已读。 */
  markRead: (notificationId: number) =>
    apiFetch<MarkReadResponse>(`/notifications/${notificationId}/read`, { method: 'PATCH' }),

  /** 全部标记已读。 */
  markAllRead: () => apiFetch<MarkAllReadResponse>('/notifications/read-all', { method: 'PATCH' }),

  /** 批量操作通知（V2 通知中心）。 */
  batch: (request: NotificationBatchRequest) =>
    apiFetch<NotificationBatchResponse>('/notifications/batch', {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    }),
}

/**
 * TanStack Query 分层 keys：
 * - all: 通知全局命名空间
 * - lists: 列表键
 * - list: 含过滤条件
 * - unread: 未读数独立键
 */
export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (filters: NotificationListFilters = {}) => [...notificationKeys.lists(), filters] as const,
  unread: () => [...notificationKeys.all, 'unread'] as const,
}
