import { ResourceNotFoundException } from '#exceptions/api_exception'
import type AuditLog from '#models/audit_log'
import db from '@adonisjs/lucid/services/db'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { DateTime } from 'luxon'
import { isPg } from '#services/dialect/dialect_helper'

export interface AuditLogListFilters {
  actorId?: number | null
  action?: string[] | null
  entityType?: string | null
  entityId?: number | null
  severity?: string[] | null
  dateFrom?: string | null
  dateTo?: string | null
  requestId?: string | null
  event?: string | null
  cursor?: number | null
  page?: number | null
  perPage?: number | null
}

interface ListResult {
  data: AuditLog[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export default class AuditLogQueryService {
  private static PER_PAGE_MAX = 100
  private static PER_PAGE_DEFAULT = 20

  async list(
    scope: ModelQueryBuilderContract<typeof AuditLog>,
    filters: AuditLogListFilters,
  ): Promise<ListResult> {
    let query = scope.clone()

    if (filters.actorId) {
      query = query.where('user_id', filters.actorId)
    }
    if (filters.action && filters.action.length > 0) {
      query = query.whereIn('action', filters.action)
    }
    if (filters.entityType) {
      query = query.where('entity_type', filters.entityType)
    }
    if (filters.entityId) {
      query = query.where('entity_id', filters.entityId)
    }
    if (filters.severity && filters.severity.length > 0) {
      query = query.whereIn('severity', filters.severity)
    }
    if (filters.dateFrom) {
      query = query.where('created_at', '>=', filters.dateFrom)
    }
    if (filters.dateTo) {
      query = query.where('created_at', '<=', filters.dateTo)
    }
    if (filters.requestId) {
      query = query.where('request_id', filters.requestId)
    }
    if (filters.event) {
      // 必须 CAST：metadata 在 PostgreSQL 上是 json 列，直接 LIKE 会报
      // operator does not exist: json ~~ unknown（42883）；SQLite 把 json 当文本所以察觉不到。
      // CAST(... AS TEXT) 两种方言都成立且语义一致，故不走方言分支。
      query = query.whereRaw('CAST(metadata AS TEXT) LIKE ?', [`%"event":"${filters.event}"%`])
    }

    const perPage = Math.min(
      filters.perPage ?? AuditLogQueryService.PER_PAGE_DEFAULT,
      AuditLogQueryService.PER_PAGE_MAX,
    )

    const countResult = (await query.clone().count('* as total')) as unknown as Array<{
      total: number
    }>
    const total = Number(countResult[0]?.total ?? 0)

    if (filters.cursor) {
      query = query.where('id', '<', filters.cursor)
    }
    query = query.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(perPage)

    const data = await query

    const page = filters.page ?? 1
    const totalPages = Math.max(1, Math.ceil(total / perPage))

    return { data, meta: { total, page, totalPages, perPage } }
  }

  async show(scope: ModelQueryBuilderContract<typeof AuditLog>, id: number): Promise<AuditLog> {
    const query = scope.clone().where('id', id)
    const record = await query.first()
    if (!record) {
      throw new ResourceNotFoundException('审计记录不存在')
    }
    return record
  }

  async stats(
    scope: ModelQueryBuilderContract<typeof AuditLog>,
    dateFrom?: string | null,
    dateTo?: string | null,
  ): Promise<{
    byAction: Record<string, number>
    bySeverity: Record<string, number>
    byDay: Array<{ date: string; count: number }>
  }> {
    const now = DateTime.now()
    const defaultFrom = dateFrom ?? now.minus({ days: 30 }).toISODate()!
    const defaultTo = dateTo ?? now.toISODate()!
    const defaultToEnd = `${defaultTo}T23:59:59.999Z`

    const base = scope
      .clone()
      .where('created_at', '>=', defaultFrom)
      .where('created_at', '<=', defaultToEnd)

    const actionRows = await base.clone().groupBy('action').select('action').count('* as count')
    const severityRows = await base
      .clone()
      .groupBy('severity')
      .select('severity')
      .count('* as count')

    // v3-multitenant-isolation-architecture §4.1：byDay 必须从同一 scope 派生。
    // 旧实现直接 `db.query().from('audit_logs')`，绕过组织过滤，会把其它组织的
    // 每日审计条数计入返回值（跨租户计数侧信道）。
    // 按天分组的表达式按方言取：SQLite 的 strftime 在 PG 上不存在（42883 → 500）。
    const dayExpr = isPg()
      ? "to_char(created_at, 'YYYY-MM-DD')"
      : "strftime('%Y-%m-%d', created_at)"
    const dayRows = await base
      .clone()
      .groupByRaw(dayExpr)
      .select(db.raw(`${dayExpr} as date`))
      .count('* as count')
      .orderByRaw(dayExpr)

    const byAction: Record<string, number> = {}
    for (const row of actionRows) {
      byAction[row.action] = Number((row as any).$extras?.count ?? (row as any).count ?? 0)
    }

    const bySeverity: Record<string, number> = {}
    for (const row of severityRows) {
      bySeverity[row.severity] = Number((row as any).$extras?.count ?? (row as any).count ?? 0)
    }

    // 经模型查询构造器聚合时，date/count 落在 $extras 上；保留原始字段回退。
    const byDay: Array<{ date: string; count: number }> = (dayRows as any[]).map((row: any) => ({
      date: String(row.$extras?.date ?? row.date ?? ''),
      count: Number(row.$extras?.count ?? row.count ?? 0),
    }))

    return { byAction, bySeverity, byDay }
  }
}
