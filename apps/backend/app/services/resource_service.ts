import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import ResourceCapacityVersion from '#models/resource_capacity_version'
import Project from '#models/project'
import AuditService, { AuditEvent } from '#services/audit_service'
import ResourceInvalidationService from '#services/resource_invalidation_service'
import type { AuthContext } from '#types/auth'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

export interface CreateResourceInput {
  name: string
  email?: string | null
  resourceType?: string
  role?: string
  status?: string
  capacityVersion?: number
  capacityCalendarPolicy?: string
  dailyCapacityHours?: number
  skillTags?: string[]
  roleTags?: string[]
  capacityProfile?: Record<string, unknown> | null
  workDays?: number[]
  timezone?: string
  costPerUnitCents?: number | null
  userId?: number | null
}

export interface UpdateResourceInput extends Partial<CreateResourceInput> {}

export interface ResourceListFilters {
  resourceType?: string
  status?: string
  role?: string
  search?: string
  sort?: string
  page?: number
  perPage?: number
}

@inject()
export default class ResourceService {
  private invalidation = new ResourceInvalidationService()

  constructor(private audit: AuditService) {}

  async create(
    organizationId: number,
    projectId: number,
    input: CreateResourceInput,
    actorUserId: number,
    ctx: AuthContext = {},
  ): Promise<Resource> {
    await this.projectOrFail(organizationId, projectId)

    const resource = await db.transaction(async (trx) => {
      const created = await Resource.create(
        {
          projectId,
          userId: input.userId ?? null,
          name: input.name,
          email: input.email ?? null,
          resourceType: input.resourceType ?? 'human',
          role: input.role ?? 'member',
          status: input.status ?? 'active',
          capacityVersion: input.capacityVersion ?? 1,
          capacityCalendarPolicy: input.capacityCalendarPolicy ?? 'project_working_calendar',
          dailyCapacityHours: input.dailyCapacityHours ?? 8.0,
          skillTags: input.skillTags ? JSON.stringify(input.skillTags) : null,
          roleTags: input.roleTags ? JSON.stringify(input.roleTags) : JSON.stringify([]),
          capacityProfile: input.capacityProfile ? JSON.stringify(input.capacityProfile) : null,
          workDays: input.workDays
            ? JSON.stringify(input.workDays)
            : JSON.stringify([1, 2, 3, 4, 5]),
          timezone: input.timezone ?? 'Asia/Shanghai',
          costPerUnitCents: input.costPerUnitCents ?? null,
        },
        { client: trx },
      )
      await ResourceCapacityVersion.create(
        {
          organizationId,
          projectId,
          resourceId: created.id,
          version: created.capacityVersion,
          baseDailyCapacityHours: created.dailyCapacityHours,
          calendarPolicy: created.capacityCalendarPolicy,
          workDays: created.workDays,
          skillTags: created.skillTags,
          roleTags: created.roleTags,
          status: created.status,
          effectiveFrom: null,
          effectiveTo: null,
          createdBy: actorUserId,
          auditLogId: null,
        },
        { client: trx },
      )
      await this.audit.log({
        event: AuditEvent.RESOURCE_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource',
        entityId: created.id,
        requestId: ctx.requestId ?? null,
        metadata: { name: created.name, resourceType: created.resourceType, role: created.role },
        client: trx,
        strict: true,
      })
      return created
    })
    this.invalidate(organizationId, projectId, actorUserId, resource.id)
    return resource
  }

  async list(
    organizationId: number,
    projectId: number,
    filters: ResourceListFilters = {},
  ): Promise<{
    data: Resource[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)

    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    let query = Resource.query().where('project_id', projectId)

    if (filters.resourceType) query = query.where('resource_type', filters.resourceType)
    if (filters.status) query = query.where('status', filters.status)
    if (filters.role) query = query.where('role', filters.role)
    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      query = query.where((builder) => {
        builder.whereILike('name', keyword).orWhereILike('email', keyword)
      })
    }

    const sortField = this.parseSortField(filters.sort ?? '-createdAt')
    query = query.orderBy(sortField.column, sortField.direction)

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

  async get(organizationId: number, projectId: number, resourceId: number): Promise<Resource> {
    await this.projectOrFail(organizationId, projectId)
    const resource = await Resource.query()
      .where('id', resourceId)
      .where('project_id', projectId)
      .preload('allocations')
      .first()
    if (!resource) {
      throw new ResourceNotFoundException('资源不存在')
    }
    return resource
  }

  async getForAuthorize(
    organizationId: number,
    projectId: number,
    resourceId: number,
    client?: TransactionClientContract,
  ): Promise<Resource> {
    return client
      ? this.getMutable(organizationId, projectId, resourceId, client)
      : this.get(organizationId, projectId, resourceId)
  }

  async update(
    organizationId: number,
    projectId: number,
    resourceId: number,
    input: UpdateResourceInput,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<Resource> {
    const updated = await this.inTransaction(client, async (transaction) => {
      const resource = await this.getMutable(organizationId, projectId, resourceId, transaction)

      if (input.name !== undefined) resource.name = input.name
      if (input.email !== undefined) resource.email = input.email
      if (input.resourceType !== undefined) resource.resourceType = input.resourceType
      if (input.role !== undefined) resource.role = input.role
      if (input.status !== undefined) resource.status = input.status
      if (input.capacityVersion !== undefined) resource.capacityVersion = input.capacityVersion
      if (input.capacityCalendarPolicy !== undefined)
        resource.capacityCalendarPolicy = input.capacityCalendarPolicy
      if (input.dailyCapacityHours !== undefined)
        resource.dailyCapacityHours = input.dailyCapacityHours
      if (input.skillTags !== undefined) resource.skillTags = JSON.stringify(input.skillTags)
      if (input.roleTags !== undefined) resource.roleTags = JSON.stringify(input.roleTags)
      if (input.capacityProfile !== undefined)
        resource.capacityProfile = input.capacityProfile
          ? JSON.stringify(input.capacityProfile)
          : null
      if (input.workDays !== undefined) resource.workDays = JSON.stringify(input.workDays)
      if (input.timezone !== undefined) resource.timezone = input.timezone
      if (input.costPerUnitCents !== undefined) resource.costPerUnitCents = input.costPerUnitCents
      if (input.userId !== undefined) resource.userId = input.userId

      resource.useTransaction(transaction)
      await resource.save()

      await this.audit.log({
        event: AuditEvent.RESOURCE_UPDATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource',
        entityId: resource.id,
        requestId: ctx.requestId ?? null,
        metadata: { name: resource.name, changed: Object.keys(input) },
        client: transaction,
        strict: true,
      })

      return resource
    })
    this.invalidate(organizationId, projectId, actorUserId, updated.id)
    return client ? updated : this.get(organizationId, projectId, resourceId)
  }

  async delete(
    organizationId: number,
    projectId: number,
    resourceId: number,
    actorUserId: number,
    ctx: AuthContext = {},
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.inTransaction(client, async (transaction) => {
      const resource = await this.getMutable(organizationId, projectId, resourceId, transaction)

      const activeAllocations = await ResourceAllocation.query({ client: transaction })
        .where('resource_id', resourceId)
        .where((q) => {
          q.whereNull('end_date').orWhere('end_date', '>=', DateTime.now().toISODate())
        })
        .count('*', 'total')
      if (Number(activeAllocations[0]?.$extras?.total ?? 0) > 0) {
        throw new ValidationException('该资源仍有未结束的分配，请先重新分配或清理后再删除', {
          status: 422,
          code: '422',
        } as never)
      }

      resource.deletedAt = DateTime.now()
      resource.useTransaction(transaction)
      await resource.save()

      await this.audit.log({
        event: AuditEvent.RESOURCE_DELETED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource',
        entityId: resource.id,
        requestId: ctx.requestId ?? null,
        client: transaction,
        strict: true,
      })
    })
    this.invalidate(organizationId, projectId, actorUserId, resourceId)
  }

  private invalidate(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    resourceId: number,
  ): void {
    this.invalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'resource_changed',
      entityType: 'resource',
      entityId: resourceId,
    })
  }

  private async inTransaction<T>(
    client: TransactionClientContract | undefined,
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : db.transaction(operation)
  }

  private async getMutable(
    organizationId: number,
    projectId: number,
    resourceId: number,
    client: TransactionClientContract,
  ): Promise<Resource> {
    await this.projectOrFail(organizationId, projectId, client)
    const resource = await Resource.query({ client })
      .where('id', resourceId)
      .where('project_id', projectId)
      .first()
    if (!resource) {
      throw new ResourceNotFoundException('资源不存在')
    }
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

  private parseSortField(sort: string): { column: string; direction: 'asc' | 'desc' } {
    const direction = sort.startsWith('-') ? 'desc' : 'asc'
    const field = sort.replace(/^[+-]/, '')
    const columnMap: Record<string, string> = {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      name: 'name',
      resourceType: 'resource_type',
      role: 'role',
      status: 'status',
      dailyCapacityHours: 'daily_capacity_hours',
    }
    return { column: columnMap[field] ?? 'created_at', direction }
  }
}
