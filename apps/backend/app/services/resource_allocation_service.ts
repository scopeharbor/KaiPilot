import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Task from '#models/task'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import ResourceConflictService, {
  type ResourceConflictResult,
} from '#services/resource_conflict_service'
import ResourceInvalidationService from '#services/resource_invalidation_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

export interface CreateAllocationInput {
  taskId: number
  allocationType?: string
  allocationPercent?: number
  startDate?: string
  endDate?: string
  plannedUnits?: number | null
  actualUnits?: number | null
}

export interface UpdateAllocationInput {
  allocationType?: string
  allocationPercent?: number
  startDate?: string | null
  endDate?: string | null
  plannedUnits?: number | null
  actualUnits?: number | null
}

export interface AllocationWriteResult {
  data: ResourceAllocation
  warningSummary: ResourceConflictResult
}

@inject()
export default class ResourceAllocationService {
  private conflicts = new ResourceConflictService()
  private invalidation = new ResourceInvalidationService()

  constructor(private audit: AuditService) {}

  async create(
    organizationId: number,
    projectId: number,
    resourceId: number,
    input: CreateAllocationInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<ResourceAllocation> {
    const allocation = await this.inTransaction(client, async (trx) => {
      await this.projectOrFail(organizationId, projectId, trx)
      await this.resourceOrFail(organizationId, projectId, resourceId, trx)

      const task = await Task.query({ client: trx })
        .where('id', input.taskId)
        .where('project_id', projectId)
        .first()
      if (!task) {
        throw new ValidationException('任务不存在或不属于当前项目')
      }

      if (input.startDate && input.endDate && input.endDate < input.startDate) {
        throw new ValidationException('结束日期不能早于开始日期')
      }

      const defaultStart = task.startDate?.toISODate()
      const defaultEnd = task.endDate?.toISODate()

      const created = await ResourceAllocation.create(
        {
          resourceId,
          taskId: input.taskId,
          allocationType: input.allocationType ?? 'assigned',
          allocationPercent: input.allocationPercent ?? 100.0,
          startDate: input.startDate
            ? DateTime.fromISO(input.startDate)
            : defaultStart
              ? DateTime.fromISO(defaultStart)
              : null,
          endDate: input.endDate
            ? DateTime.fromISO(input.endDate)
            : defaultEnd
              ? DateTime.fromISO(defaultEnd)
              : null,
          plannedUnits: input.plannedUnits ?? null,
          actualUnits: input.actualUnits ?? null,
        },
        { client: trx },
      )
      await this.audit.log({
        event: AuditEvent.RESOURCE_ALLOCATION_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_allocation',
        entityId: created.id,
        requestId: ctx.requestId ?? null,
        metadata: {
          resourceId,
          taskId: input.taskId,
          allocationPercent: input.allocationPercent ?? 100.0,
        },
        client: trx,
        strict: true,
      })
      return created
    })
    this.invalidate(organizationId, projectId, actorUserId, allocation.id)
    return allocation
  }

  async createWithWarnings(
    organizationId: number,
    projectId: number,
    resourceId: number,
    input: CreateAllocationInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<AllocationWriteResult> {
    const allocation = await this.create(
      organizationId,
      projectId,
      resourceId,
      input,
      actorUserId,
      ctx,
      client,
    )
    const warningSummary = await this.conflicts.summarizeAllocation(
      organizationId,
      projectId,
      allocation.id,
    )
    return { data: allocation, warningSummary }
  }

  async listByResource(
    organizationId: number,
    projectId: number,
    resourceId: number,
    filters: { allocationType?: string; page?: number; perPage?: number } = {},
  ): Promise<{
    data: ResourceAllocation[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)
    await this.resourceOrFail(organizationId, projectId, resourceId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    let query = ResourceAllocation.query().where('resource_id', resourceId)

    if (filters.allocationType) query = query.where('allocation_type', filters.allocationType)

    const paginator = await query.paginate(page, perPage)
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

  async update(
    organizationId: number,
    projectId: number,
    allocationId: number,
    input: UpdateAllocationInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<ResourceAllocation> {
    const updated = await this.inTransaction(client, async (transaction) => {
      const allocation = await this.getAllocationMutable(
        organizationId,
        projectId,
        allocationId,
        transaction,
      )

      const nextStart =
        input.startDate !== undefined
          ? input.startDate
          : (allocation.startDate?.toISODate() ?? null)
      const nextEnd =
        input.endDate !== undefined ? input.endDate : (allocation.endDate?.toISODate() ?? null)
      if (nextStart && nextEnd && nextEnd < nextStart) {
        throw new ValidationException('结束日期不能早于开始日期')
      }

      if (input.allocationType !== undefined) allocation.allocationType = input.allocationType
      if (input.allocationPercent !== undefined)
        allocation.allocationPercent = input.allocationPercent
      if (input.startDate !== undefined)
        allocation.startDate = input.startDate ? DateTime.fromISO(input.startDate) : null
      if (input.endDate !== undefined)
        allocation.endDate = input.endDate ? DateTime.fromISO(input.endDate) : null
      if (input.plannedUnits !== undefined) allocation.plannedUnits = input.plannedUnits
      if (input.actualUnits !== undefined) allocation.actualUnits = input.actualUnits

      allocation.useTransaction(transaction)
      await allocation.save()

      await this.audit.log({
        event: AuditEvent.RESOURCE_ALLOCATION_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_allocation',
        entityId: allocation.id,
        requestId: ctx.requestId ?? null,
        metadata: { resourceId: allocation.resourceId, changed: Object.keys(input) },
        client: transaction,
        strict: true,
      })

      return allocation
    })
    this.invalidate(organizationId, projectId, actorUserId, updated.id)
    return client ? updated : updated
  }

  async updateWithWarnings(
    organizationId: number,
    projectId: number,
    allocationId: number,
    input: UpdateAllocationInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<AllocationWriteResult> {
    const allocation = await this.update(
      organizationId,
      projectId,
      allocationId,
      input,
      actorUserId,
      ctx,
      client,
    )
    const warningSummary = await this.conflicts.summarizeAllocation(
      organizationId,
      projectId,
      allocation.id,
    )
    return { data: allocation, warningSummary }
  }

  async delete(
    organizationId: number,
    projectId: number,
    allocationId: number,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.inTransaction(client, async (transaction) => {
      const allocation = await this.getAllocationMutable(
        organizationId,
        projectId,
        allocationId,
        transaction,
      )

      allocation.useTransaction(transaction)
      await allocation.delete()

      await this.audit.log({
        event: AuditEvent.RESOURCE_ALLOCATION_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_allocation',
        entityId: allocation.id,
        requestId: ctx.requestId ?? null,
        client: transaction,
        strict: true,
      })
    })
    this.invalidate(organizationId, projectId, actorUserId, allocationId)
  }

  private invalidate(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    allocationId: number,
  ): void {
    this.invalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'resource_allocation_changed',
      entityType: 'resource_allocation',
      entityId: allocationId,
    })
  }

  private async inTransaction<T>(
    client: TransactionClientContract | undefined,
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : db.transaction(operation)
  }

  private async getAllocationMutable(
    _organizationId: number,
    projectId: number,
    allocationId: number,
    client: TransactionClientContract,
  ): Promise<ResourceAllocation> {
    const allocation = await ResourceAllocation.query({ client }).where('id', allocationId).first()
    if (!allocation) {
      throw new ResourceNotFoundException('分配记录不存在')
    }

    const resource = await Resource.query({ client }).where('id', allocation.resourceId).first()
    if (!resource || Number(resource.projectId) !== projectId) {
      throw new ResourceNotFoundException('分配记录不存在')
    }

    await this.projectOrFail(_organizationId, projectId, client)
    return allocation
  }

  private async resourceOrFail(
    _organizationId: number,
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
}
