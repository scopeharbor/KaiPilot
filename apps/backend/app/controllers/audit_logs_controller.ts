import AuditLog from '#models/audit_log'
import Organization from '#models/organization'
import Project from '#models/project'
import User from '#models/user'
import AuditLogPolicy from '#policies/audit_log_policy'
import AuditLogQueryService from '#services/audit_log_query_service'
import { auditLogDetailDto, auditLogListItemDto, type AuditLogNames } from '#types/dto'
import {
  listAuditLogsValidator,
  showAuditLogValidator,
  statsAuditLogsValidator,
} from '#validators/audit_logs'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

function toArray(value: string | string[] | undefined | null): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) return value
  return value.split(',').filter(Boolean)
}

/**
 * 批量把审计条目的 userId/organizationId/projectId/(项目实体) 解析为可读名称。
 * 一次 whereIn 预取，避免逐条查询与前端拿到裸数字 ID（polish-v1-ui-and-assignment）。
 */
async function resolveAuditNames(logs: AuditLog[]): Promise<Map<number, AuditLogNames>> {
  const userIds = new Set<number>()
  const orgIds = new Set<number>()
  const projectIds = new Set<number>()
  for (const log of logs) {
    if (log.userId !== null) userIds.add(Number(log.userId))
    if (log.organizationId !== null) orgIds.add(Number(log.organizationId))
    if (log.projectId !== null) projectIds.add(Number(log.projectId))
    if (log.entityType === 'project' && log.entityId !== null) projectIds.add(Number(log.entityId))
  }

  const [users, orgs, projects] = await Promise.all([
    userIds.size ? User.query().whereIn('id', [...userIds]) : Promise.resolve([]),
    orgIds.size ? Organization.query().whereIn('id', [...orgIds]) : Promise.resolve([]),
    projectIds.size ? Project.query().whereIn('id', [...projectIds]) : Promise.resolve([]),
  ])

  const userMap = new Map(users.map((u) => [u.id, u.fullName || u.email || `用户#${u.id}`]))
  const orgMap = new Map(orgs.map((o) => [o.id, o.name]))
  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  const result = new Map<number, AuditLogNames>()
  for (const log of logs) {
    const entityName =
      log.entityType === 'project' && log.entityId !== null
        ? (projectMap.get(Number(log.entityId)) ?? null)
        : null
    result.set(log.id, {
      userName: log.userId !== null ? (userMap.get(Number(log.userId)) ?? null) : null,
      organizationName:
        log.organizationId !== null ? (orgMap.get(Number(log.organizationId)) ?? null) : null,
      entityName,
      projectName: log.projectId !== null ? (projectMap.get(Number(log.projectId)) ?? null) : null,
    })
  }
  return result
}

@inject()
export default class AuditLogsController {
  constructor(
    private query: AuditLogQueryService,
    private policy: AuditLogPolicy,
  ) {}

  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const filters = await ctx.request.validateUsing(listAuditLogsValidator, {
      data: ctx.request.qs(),
    })
    const scope = this.policy.scope(user, ctx.tenant?.organizationId)
    const { data, meta } = await this.query.list(scope, {
      actorId: filters.actorId,
      action: toArray(filters.action),
      entityType: filters.entityType,
      entityId: filters.entityId,
      severity: toArray(filters.severity),
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      requestId: filters.requestId,
      event: filters.event,
      cursor: filters.cursor,
      page: filters.page,
      perPage: filters.perPage,
    })
    const names = await resolveAuditNames(data)
    return ctx.response.ok({
      data: data.map((log) => auditLogListItemDto(log, names.get(log.id) ?? {})),
      meta,
    })
  }

  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const params = await ctx.request.validateUsing(showAuditLogValidator, {
      data: { id: ctx.params.id },
    })
    const scope = this.policy.scope(user, ctx.tenant?.organizationId)
    const record = await this.query.show(scope, params.id)
    const names = await resolveAuditNames([record])
    return ctx.response.ok({ data: auditLogDetailDto(record, names.get(record.id) ?? {}) })
  }

  async stats(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const filters = await ctx.request.validateUsing(statsAuditLogsValidator, {
      data: ctx.request.qs(),
    })
    const scope = this.policy.scope(user, ctx.tenant?.organizationId)
    const result = await this.query.stats(scope, filters.dateFrom, filters.dateTo)
    return ctx.response.ok({ data: result })
  }
}
