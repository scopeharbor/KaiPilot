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
}

export interface AuditLogDetail extends AuditLogEntry {
  changes: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
    truncated?: boolean
  } | null
  metadata: Record<string, unknown> | null
}

export interface AuditLogQuery {
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

export interface AuditLogStats {
  byAction: Record<string, number>
  bySeverity: Record<string, number>
  byDay: Array<{ date: string; count: number }>
}
