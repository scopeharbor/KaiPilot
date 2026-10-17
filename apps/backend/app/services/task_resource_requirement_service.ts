import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import ResourceAllocation from '#models/resource_allocation'
import Task from '#models/task'
import TaskResourceRequirement from '#models/task_resource_requirement'
import AuditService, { AuditEvent } from '#services/audit_service'
import ResourceInvalidationService from '#services/resource_invalidation_service'
import type {
  TaskResourceRequirementPriority,
  TaskResourceRequirementStatus,
} from '#models/task_resource_requirement'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

const MAX_SKILL_TAGS = 50
const MAX_SKILL_TAG_LENGTH = 64

export interface CreateTaskResourceRequirementInput {
  taskId: number
  role: string
  skillTags?: string[]
  allocationPercent?: number | null
  estimatedPersonDays?: number | null
  startDate: string
  endDate: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  status?: 'open' | 'matched' | 'fulfilled' | 'cancelled'
  sourceKind?: 'manual' | 'compiler' | 'ai_candidate' | 'rule_suggestion'
  sourceRef?: string | null
}

export interface UpdateTaskResourceRequirementInput {
  role?: string
  skillTags?: string[] | null
  allocationPercent?: number | null
  estimatedPersonDays?: number | null
  startDate?: string
  endDate?: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  status?: 'open' | 'matched' | 'fulfilled' | 'cancelled'
  sourceKind?: 'manual' | 'compiler' | 'ai_candidate' | 'rule_suggestion'
  sourceRef?: string | null
}

type TaskResourceRequirementSourceKind = 'manual' | 'compiler' | 'ai_candidate' | 'rule_suggestion'

interface NormalizedRequirementInput {
  role: string
  skillTags: string | null
  allocationPercent: number | null
  estimatedPersonDays: number | null
  startDate: string
  endDate: string
  priority: TaskResourceRequirementPriority
  status: TaskResourceRequirementStatus
  sourceKind: TaskResourceRequirementSourceKind
  sourceRef: string | null
}

export interface TaskResourceRequirementListFilters {
  taskId?: number
  role?: string
  status?: string
  from?: string
  to?: string
  page?: number
  perPage?: number
}

export default class TaskResourceRequirementService {
  private invalidation = new ResourceInvalidationService()

  constructor(private audit = new AuditService()) {}

  async create(
    organizationId: number,
    projectId: number,
    input: CreateTaskResourceRequirementInput,
    actorUserId: number,
    client?: TransactionClientContract,
  ): Promise<TaskResourceRequirement> {
    const requirement = await this.inTransaction(client, async (transaction) => {
      await this.projectOrFail(organizationId, projectId, transaction)
      const task = await this.taskOrFail(projectId, input.taskId, transaction)
      const normalized = this.normalizeCreateInput(input, task)

      const createdRequirement = await TaskResourceRequirement.create(
        {
          organizationId,
          projectId,
          taskId: input.taskId,
          role: normalized.role,
          skillTags: normalized.skillTags,
          allocationPercent: normalized.allocationPercent,
          estimatedPersonDays: normalized.estimatedPersonDays,
          startDate: DateTime.fromISO(normalized.startDate),
          endDate: DateTime.fromISO(normalized.endDate),
          priority: normalized.priority,
          status: normalized.status,
          sourceKind: normalized.sourceKind,
          sourceRef: normalized.sourceRef,
          createdBy: actorUserId,
          auditLogId: null,
        },
        { client: transaction },
      )
      await this.audit.log({
        event: AuditEvent.RESOURCE_REQUIREMENT_CREATED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'task_resource_requirement',
        entityId: createdRequirement.id,
        metadata: {
          taskId: input.taskId,
          role: normalized.role,
          skillCount: this.parseSkillTags(normalized.skillTags).length,
          sourceKind: normalized.sourceKind,
        },
        client: transaction,
        strict: true,
      })
      return createdRequirement
    })
    this.invalidate(organizationId, projectId, actorUserId, requirement.id)
    return requirement
  }

  async list(
    organizationId: number,
    projectId: number,
    filters: TaskResourceRequirementListFilters = {},
  ): Promise<{
    data: TaskResourceRequirement[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.projectOrFail(organizationId, projectId)
    const page = Math.max(1, filters.page ?? 1)
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20))

    let query = TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (filters.taskId) query = query.where('task_id', filters.taskId)
    if (filters.role) query = query.where('role', filters.role)
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

  async get(
    organizationId: number,
    projectId: number,
    requirementId: number,
    client?: TransactionClientContract,
  ): Promise<TaskResourceRequirement> {
    await this.projectOrFail(organizationId, projectId, client)
    const requirement = await this.requirementQuery(organizationId, projectId, client)
      .where('id', requirementId)
      .first()
    if (!requirement) throw new ResourceNotFoundException('资源需求不存在')
    return requirement
  }

  async update(
    organizationId: number,
    projectId: number,
    requirementId: number,
    input: UpdateTaskResourceRequirementInput,
    actorUserId?: number,
    client?: TransactionClientContract,
  ): Promise<TaskResourceRequirement> {
    const requirement = await this.inTransaction(client, async (transaction) => {
      const requirementToUpdate = await this.get(
        organizationId,
        projectId,
        requirementId,
        transaction,
      )
      const task = await this.taskOrFail(projectId, requirementToUpdate.taskId, transaction)
      const normalized = this.normalizeUpdateInput(input, requirementToUpdate, task)

      requirementToUpdate.role = normalized.role
      requirementToUpdate.skillTags = normalized.skillTags
      requirementToUpdate.allocationPercent = normalized.allocationPercent
      requirementToUpdate.estimatedPersonDays = normalized.estimatedPersonDays
      requirementToUpdate.startDate = DateTime.fromISO(normalized.startDate)
      requirementToUpdate.endDate = DateTime.fromISO(normalized.endDate)
      requirementToUpdate.priority = normalized.priority
      requirementToUpdate.status = normalized.status
      requirementToUpdate.sourceKind = normalized.sourceKind
      requirementToUpdate.sourceRef = normalized.sourceRef
      requirementToUpdate.useTransaction(transaction)
      await requirementToUpdate.save()
      await this.audit.log({
        event: AuditEvent.RESOURCE_REQUIREMENT_UPDATED,
        userId: actorUserId ?? null,
        organizationId,
        projectId,
        entityType: 'task_resource_requirement',
        entityId: requirementToUpdate.id,
        metadata: { taskId: requirementToUpdate.taskId, changed: Object.keys(input) },
        client: transaction,
        strict: true,
      })
      return requirementToUpdate
    })
    this.invalidate(organizationId, projectId, actorUserId ?? 0, requirement.id)
    return requirement
  }

  async delete(
    organizationId: number,
    projectId: number,
    requirementId: number,
    actorUserId?: number,
    client?: TransactionClientContract,
  ): Promise<void> {
    await this.inTransaction(client, async (transaction) => {
      const requirementToDelete = await this.get(
        organizationId,
        projectId,
        requirementId,
        transaction,
      )
      const taskId = requirementToDelete.taskId
      requirementToDelete.useTransaction(transaction)
      await requirementToDelete.delete()
      await this.audit.log({
        event: AuditEvent.RESOURCE_REQUIREMENT_DELETED,
        userId: actorUserId ?? null,
        organizationId,
        projectId,
        entityType: 'task_resource_requirement',
        entityId: requirementToDelete.id,
        metadata: { taskId },
        client: transaction,
        strict: true,
      })
    })
    this.invalidate(organizationId, projectId, actorUserId ?? 0, requirementId)
  }

  async countAllocationsForTask(taskId: number): Promise<number> {
    const rows = await ResourceAllocation.query().where('task_id', taskId).count('*', 'total')
    return Number(rows[0]?.$extras?.total ?? 0)
  }

  private requirementQuery(
    organizationId: number,
    projectId: number,
    client?: TransactionClientContract,
  ) {
    const query = TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
    return client ? query.useTransaction(client) : query
  }

  private async inTransaction<T>(
    client: TransactionClientContract | undefined,
    operation: (transaction: TransactionClientContract) => Promise<T>,
  ): Promise<T> {
    return client ? operation(client) : db.transaction(operation)
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

  private async taskOrFail(
    projectId: number,
    taskId: number,
    client: TransactionClientContract,
  ): Promise<Task> {
    const task = await Task.query({ client })
      .where('id', taskId)
      .where('project_id', projectId)
      .first()
    if (!task) throw new ResourceNotFoundException('任务不存在')
    return task
  }

  private normalizeCreateInput(input: CreateTaskResourceRequirementInput, task: Task) {
    return this.validateInput(
      {
        role: input.role,
        skillTags: input.skillTags ? JSON.stringify(input.skillTags) : null,
        allocationPercent: input.allocationPercent ?? null,
        estimatedPersonDays: input.estimatedPersonDays ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        priority: input.priority ?? 'medium',
        status: input.status ?? 'open',
        sourceKind: input.sourceKind ?? 'manual',
        sourceRef: input.sourceRef ?? null,
      },
      task,
    )
  }

  private normalizeUpdateInput(
    input: UpdateTaskResourceRequirementInput,
    current: TaskResourceRequirement,
    task: Task,
  ) {
    return this.validateInput(
      {
        role: input.role ?? current.role,
        skillTags:
          input.skillTags !== undefined
            ? input.skillTags
              ? JSON.stringify(input.skillTags)
              : null
            : current.skillTags,
        allocationPercent:
          input.allocationPercent !== undefined
            ? input.allocationPercent
            : current.allocationPercent,
        estimatedPersonDays:
          input.estimatedPersonDays !== undefined
            ? input.estimatedPersonDays
            : current.estimatedPersonDays,
        startDate: input.startDate ?? current.startDate.toISODate()!,
        endDate: input.endDate ?? current.endDate.toISODate()!,
        priority: input.priority ?? current.priority,
        status: input.status ?? current.status,
        sourceKind: input.sourceKind ?? current.sourceKind,
        sourceRef: input.sourceRef !== undefined ? input.sourceRef : current.sourceRef,
      },
      task,
    )
  }

  private validateInput(
    input: {
      role: string
      skillTags: string | null
      allocationPercent: number | null
      estimatedPersonDays: number | null
      startDate: string
      endDate: string
      priority: string
      status: string
      sourceKind: string
      sourceRef: string | null
    },
    task: Task,
  ): NormalizedRequirementInput {
    if (!input.role.trim() || input.role.length > 80) {
      throw new ValidationException('资源需求角色不能为空且不能超过 80 个字符')
    }
    const skills = this.parseSkillTags(input.skillTags)
    if (skills.length > MAX_SKILL_TAGS) {
      throw new ValidationException(`技能标签不能超过 ${MAX_SKILL_TAGS} 个`)
    }
    if (skills.some((skill) => skill.length > MAX_SKILL_TAG_LENGTH)) {
      throw new ValidationException(`技能标签不能超过 ${MAX_SKILL_TAG_LENGTH} 个字符`)
    }
    if (input.allocationPercent === null && input.estimatedPersonDays === null) {
      throw new ValidationException('资源需求必须提供投入比例或估算人天')
    }
    if (input.allocationPercent !== null && input.allocationPercent <= 0) {
      throw new ValidationException('投入比例必须大于 0')
    }
    if (input.estimatedPersonDays !== null && input.estimatedPersonDays <= 0) {
      throw new ValidationException('估算人天必须大于 0')
    }
    const start = DateTime.fromISO(input.startDate)
    const end = DateTime.fromISO(input.endDate)
    if (!start.isValid || !end.isValid) throw new ValidationException('资源需求日期无效')
    if (end < start) throw new ValidationException('结束日期不能早于开始日期')

    const taskStart = task.startDate?.toISODate()
    const taskEnd = task.endDate?.toISODate()
    if (taskStart && input.startDate < taskStart) {
      throw new ValidationException('资源需求开始日期不能早于任务开始日期')
    }
    if (taskEnd && input.endDate > taskEnd) {
      throw new ValidationException('资源需求结束日期不能晚于任务结束日期')
    }

    const priorityValues = ['low', 'medium', 'high', 'critical']
    if (!priorityValues.includes(input.priority))
      throw new ValidationException('资源需求优先级无效')
    const statusValues = ['open', 'matched', 'fulfilled', 'cancelled']
    if (!statusValues.includes(input.status)) throw new ValidationException('资源需求状态无效')
    const sourceValues = ['manual', 'compiler', 'ai_candidate', 'rule_suggestion']
    if (!sourceValues.includes(input.sourceKind)) throw new ValidationException('资源需求来源无效')

    return {
      ...input,
      role: input.role.trim(),
      skillTags: skills.length > 0 ? JSON.stringify(skills) : null,
      allocationPercent: input.allocationPercent === null ? null : Number(input.allocationPercent),
      estimatedPersonDays:
        input.estimatedPersonDays === null ? null : Number(input.estimatedPersonDays),
      priority: input.priority as TaskResourceRequirementPriority,
      status: input.status as TaskResourceRequirementStatus,
      sourceKind: input.sourceKind as TaskResourceRequirementSourceKind,
    }
  }

  private parseSkillTags(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.map((skill) => String(skill).trim()).filter(Boolean)
        : []
    } catch {
      throw new ValidationException('技能标签格式无效')
    }
  }

  private invalidate(
    organizationId: number,
    projectId: number,
    actorUserId: number,
    requirementId: number,
  ): void {
    this.invalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'resource_requirement_changed',
      entityType: 'task_resource_requirement',
      entityId: requirementId,
    })
  }
}
