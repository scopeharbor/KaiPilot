import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Resource from '#models/resource'
import ResourceAvailabilityException from '#models/resource_availability_exception'
import type { ResourceAvailabilityExceptionStatus } from '#models/resource_availability_exception'
import AuditService, { AuditEvent } from '#services/audit_service'
import ResourceInvalidationService from '#services/resource_invalidation_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const FORBIDDEN_AVAILABILITY_FIELDS = [
  'externalCalendarUrl',
  'externalCalendarProvider',
  'timesheet',
  'timesheetEntries',
  'clockIn',
  'clockOut',
  'checkIn',
  'checkOut',
  'actualStartTime',
  'actualEndTime',
]

export interface ResourceAvailabilityExceptionInput {
  startDate: string
  endDate: string
  capacityOverrideHours: number
  reason: string
  status?: 'planned' | 'confirmed' | 'cancelled'
}

export interface ResourceAvailabilityExceptionUpdateInput extends Partial<ResourceAvailabilityExceptionInput> {}

export interface ResourceAvailabilityExceptionFilters {
  from?: string
  to?: string
  status?: string
  page?: number
  perPage?: number
}

export default class ResourceAvailabilityExceptionService {
  private invalidation = new ResourceInvalidationService()

  constructor(private audit = new AuditService()) {}

  async list(
    organizationId: number,
    projectId: number,
    resourceId: number,
    filters: ResourceAvailabilityExceptionFilters = {},
  ): Promise<{
    data: ResourceAvailabilityException[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)
    await this.resourceOrFail(projectId, resourceId)
    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    let query = ResourceAvailabilityException.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('resource_id', resourceId)
    if (filters.status) query = query.where('status', filters.status)
    if (filters.from) query = query.where('end_date', '>=', filters.from)
    if (filters.to) query = query.where('start_date', '<=', filters.to)

    const paginator = await query
      .orderBy('start_date', 'asc')
      .orderBy('id', 'asc')
      .paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  async create(
    organizationId: number,
    projectId: number,
    resourceId: number,
    input: ResourceAvailabilityExceptionInput,
    actorUserId: number,
    rawKeys: string[] = Object.keys(input),
    client?: TransactionClientContract,
  ): Promise<ResourceAvailabilityException> {
    this.rejectForbiddenFields(rawKeys)
    const normalized = this.normalizeCreateInput(input)
    const exception = await this.inTransaction(client, async (transaction) => {
      await this.projectOrFail(organizationId, projectId, transaction)
      await this.resourceOrFail(projectId, resourceId, transaction)
      const created = await ResourceAvailabilityException.create(
        {
          organizationId,
          projectId,
          resourceId,
          startDate: DateTime.fromISO(normalized.startDate),
          endDate: DateTime.fromISO(normalized.endDate),
          capacityOverrideHours: normalized.capacityOverrideHours,
          reason: normalized.reason,
          status: normalized.status,
          createdBy: actorUserId,
          auditLogId: null,
        },
        { client: transaction },
      )
      await this.audit.log({
        event: AuditEvent.RESOURCE_AVAILABILITY_EXCEPTION_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_availability_exception',
        entityId: created.id,
        metadata: {
          resourceId,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          capacityOverrideHours: normalized.capacityOverrideHours,
          status: normalized.status,
        },
        client: transaction,
        strict: true,
      })
      return created
    })
    this.invalidate(organizationId, projectId, actorUserId, exception.id)
    return exception
  }

  async update(
    organizationId: number,
    projectId: number,
    resourceId: number,
    exceptionId: number,
    input: ResourceAvailabilityExceptionUpdateInput,
    actorUserId: number,
    rawKeys: string[] = Object.keys(input),
    client?: TransactionClientContract,
  ): Promise<ResourceAvailabilityException> {
    this.rejectForbiddenFields(rawKeys)
    const updated = await this.inTransaction(client, async (transaction) => {
      const exception = await this.getMutable(
        organizationId,
        projectId,
        resourceId,
        exceptionId,
        transaction,
      )
      const normalized = this.normalizeUpdateInput(input, exception)

      exception.startDate = DateTime.fromISO(normalized.startDate)
      exception.endDate = DateTime.fromISO(normalized.endDate)
      exception.capacityOverrideHours = normalized.capacityOverrideHours
      exception.reason = normalized.reason
      exception.status = normalized.status
      exception.useTransaction(transaction)
      await exception.save()

      await this.audit.log({
        event: AuditEvent.RESOURCE_AVAILABILITY_EXCEPTION_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_availability_exception',
        entityId: exception.id,
        metadata: { resourceId, changed: Object.keys(input) },
        client: transaction,
        strict: true,
      })
      return exception
    })
    this.invalidate(organizationId, projectId, actorUserId, updated.id)
    return updated
  }

  async delete(
    organizationId: number,
    projectId: number,
    resourceId: number,
    exceptionId: number,
    actorUserId: number,
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.inTransaction(client, async (transaction) => {
      const exception = await this.getMutable(
        organizationId,
        projectId,
        resourceId,
        exceptionId,
        transaction,
      )
      exception.useTransaction(transaction)
      await exception.delete()
      await this.audit.log({
        event: AuditEvent.RESOURCE_AVAILABILITY_EXCEPTION_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_availability_exception',
        entityId: exception.id,
        metadata: { resourceId },
        client: transaction,
        strict: true,
      })
    })
    this.invalidate(organizationId, projectId, actorUserId, exceptionId)
  }

  private normalizeCreateInput(input: ResourceAvailabilityExceptionInput) {
    return this.validateInput({
      startDate: input.startDate,
      endDate: input.endDate,
      capacityOverrideHours: input.capacityOverrideHours,
      reason: input.reason,
      status: input.status ?? 'planned',
    })
  }

  private normalizeUpdateInput(
    input: ResourceAvailabilityExceptionUpdateInput,
    current: ResourceAvailabilityException,
  ) {
    return this.validateInput({
      startDate: input.startDate ?? current.startDate.toISODate()!,
      endDate: input.endDate ?? current.endDate.toISODate()!,
      capacityOverrideHours:
        input.capacityOverrideHours !== undefined
          ? input.capacityOverrideHours
          : Number(current.capacityOverrideHours),
      reason: input.reason ?? current.reason,
      status: input.status ?? current.status,
    })
  }

  private validateInput(input: {
    startDate: string
    endDate: string
    capacityOverrideHours: number
    reason: string
    status: string
  }) {
    const start = DateTime.fromISO(input.startDate)
    const end = DateTime.fromISO(input.endDate)
    if (!start.isValid || !end.isValid) throw new ValidationException('资源可用性例外日期无效')
    if (end < start) throw new ValidationException('结束日期不能早于开始日期')
    if (input.capacityOverrideHours < 0 || input.capacityOverrideHours > 24) {
      throw new ValidationException('容量覆写小时数必须在 0 到 24 之间')
    }
    const reason = input.reason.trim()
    if (!reason || reason.length > 255) {
      throw new ValidationException('资源可用性例外原因不能为空且不能超过 255 个字符')
    }
    if (!['planned', 'confirmed', 'cancelled'].includes(input.status)) {
      throw new ValidationException('资源可用性例外状态无效')
    }
    return {
      ...input,
      reason,
      status: input.status as ResourceAvailabilityExceptionStatus,
    }
  }

  private rejectForbiddenFields(rawKeys: string[]): void {
    const forbidden = rawKeys.filter((key) => FORBIDDEN_AVAILABILITY_FIELDS.includes(key))
    if (forbidden.length > 0) {
      throw new ValidationException('资源可用性不支持成员个人日历、打卡或 timesheet 字段', {
        details: { fields: forbidden },
      })
    }
  }

  private invalidate(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    entityId: number,
  ): void {
    this.invalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'resource_availability_changed',
      entityType: 'resource_availability_exception',
      entityId,
    })
  }

  private async getMutable(
    organizationId: number,
    projectId: number,
    resourceId: number,
    exceptionId: number,
    client: TransactionClientContract,
  ): Promise<ResourceAvailabilityException> {
    await this.projectOrFail(organizationId, projectId, client)
    await this.resourceOrFail(projectId, resourceId, client)
    const exception = await ResourceAvailabilityException.query({ client })
      .where('id', exceptionId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('resource_id', resourceId)
      .first()
    if (!exception) throw new ResourceNotFoundException('资源可用性例外不存在')
    return exception
  }

  private async projectOrFail(
    organizationId: number,
    projectId: number,
    client?: TransactionClientContract,
  ): Promise<Project> {
    let query = Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
    if (client) query = query.useTransaction(client)
    const project = await query.first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }

  private async resourceOrFail(
    projectId: number,
    resourceId: number,
    client?: TransactionClientContract,
  ): Promise<Resource> {
    let query = Resource.query().where('id', resourceId).where('project_id', projectId)
    if (client) query = query.useTransaction(client)
    const resource = await query.first()
    if (!resource) throw new ResourceNotFoundException('资源不存在')
    return resource
  }

  private async inTransaction<T>(
    client: TransactionClientContract | undefined,
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : db.transaction(operation)
  }
}
