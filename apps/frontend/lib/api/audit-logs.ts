import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

export type AuditLogSeverity = 'info' | 'warning' | 'error' | 'critical'
export type AuditLogAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'export'
  | 'import'
  | 'login'
  | 'logout'
  | 'approve'
  | 'reject'
  | 'ai_generate'
  | 'apply'
  | 'rollback'

export interface AuditLogEntry {
  id: number
  createdAt: string
  action: AuditLogAction
  event: string | null
  severity: AuditLogSeverity
  userId: number | null
  organizationId: number | null
  projectId: number | null
  entityType: string | null
  entityId: number | null
  requestId: string | null
  /** 后端预解析的实名（去代号化）。 */
  userName: string | null
  organizationName: string | null
  entityName: string | null
  projectName: string | null
}

export interface AuditLogDetail extends AuditLogEntry {
  changes: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    truncated?: boolean
  } | null
  metadata: Record<string, unknown> | null
}

export interface AuditLogStats {
  byAction: Record<string, number>
  bySeverity: Record<string, number>
  byDay: Array<{ date: string; count: number }>
}

export interface PaginatedAuditLogs {
  data: AuditLogEntry[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface AuditLogFilters {
  actorId?: number
  action?: AuditLogAction[]
  entityType?: string
  entityId?: number
  severity?: AuditLogSeverity[]
  dateFrom?: string
  dateTo?: string
  requestId?: string
  event?: string
  cursor?: number
  page?: number
  perPage?: number
}

function buildQuery(filters: AuditLogFilters): string {
  const query = new URLSearchParams()
  if (filters.actorId) query.set('actorId', String(filters.actorId))
  if (filters.action?.length) filters.action.forEach((a) => query.append('action', a))
  if (filters.entityType) query.set('entityType', filters.entityType)
  if (filters.entityId) query.set('entityId', String(filters.entityId))
  if (filters.severity?.length) filters.severity.forEach((s) => query.append('severity', s))
  if (filters.dateFrom) query.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) query.set('dateTo', filters.dateTo)
  if (filters.requestId) query.set('requestId', filters.requestId)
  if (filters.event) query.set('event', filters.event)
  if (filters.cursor) query.set('cursor', String(filters.cursor))
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}

const base = '/audit-logs'

export const auditLogsApi = {
  list: (filters: AuditLogFilters = {}) =>
    apiFetchEnvelope<PaginatedAuditLogs>(`${base}${buildQuery(filters)}`),
  show: (id: number) => apiFetch<AuditLogDetail>(`${base}/${id}`),
  stats: (dateFrom?: string, dateTo?: string) => {
    const query = new URLSearchParams()
    if (dateFrom) query.set('dateFrom', dateFrom)
    if (dateTo) query.set('dateTo', dateTo)
    const qs = query.size ? `?${query.toString()}` : ''
    return apiFetch<AuditLogStats>(`${base}/stats${qs}`)
  },
}

export const auditLogKeys = {
  all: ['audit-logs'] as const,
  lists: () => [...auditLogKeys.all, 'list'] as const,
  list: (filters: AuditLogFilters) => [...auditLogKeys.lists(), filters] as const,
  details: () => [...auditLogKeys.all, 'detail'] as const,
  detail: (id: number) => [...auditLogKeys.details(), id] as const,
  stats: (dateFrom?: string, dateTo?: string) =>
    [...auditLogKeys.all, 'stats', dateFrom, dateTo] as const,
}
