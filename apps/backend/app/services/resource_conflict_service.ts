import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Task from '#models/task'
import TaskResourceRequirement from '#models/task_resource_requirement'
import ResourcePlanningService, {
  type ResourceMatrixRow,
  type ResourcePlanningFilters,
} from '#services/resource_planning_service'

export type ResourceConflictType =
  | 'overload'
  | 'unavailable_allocation'
  | 'requirement_gap'
  | 'allocation_window_overflow'
  | 'illegal_reference'

export interface ResourceConflict {
  type: ResourceConflictType
  severity: 'warning' | 'blocking'
  resourceId: number | null
  taskId: number | null
  requirementId: number | null
  allocationId: number | null
  from: string
  to: string
  reason: string
  suggestion: string
}

export interface ResourceConflictResult {
  data: ResourceConflict[]
  meta: {
    total: number
    warningCount: number
    blockingCount: number
    generatedAt: string
  }
}

export default class ResourceConflictService {
  constructor(private planning = new ResourcePlanningService()) {}

  async listConflicts(
    organizationId: number,
    projectId: number,
    filters: ResourcePlanningFilters,
  ): Promise<ResourceConflictResult> {
    await this.projectOrFail(organizationId, projectId)
    if (!filters.from || !filters.to) throw new ValidationException('必须提供资源冲突日期窗口')

    const [planning, illegalReferences, windowOverflow, requirementGaps] = await Promise.all([
      this.planning.getPlanning(organizationId, projectId, filters),
      this.detectIllegalReferences(projectId, filters.from, filters.to),
      this.detectWindowOverflow(projectId, filters.from, filters.to),
      this.detectRequirementGaps(organizationId, projectId, filters.from, filters.to),
    ])

    const conflicts = [
      ...this.matrixConflicts(planning.matrix),
      ...requirementGaps,
      ...windowOverflow,
      ...illegalReferences,
    ].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1
      return a.from.localeCompare(b.from) || a.type.localeCompare(b.type)
    })

    return {
      data: conflicts,
      meta: {
        total: conflicts.length,
        warningCount: conflicts.filter((conflict) => conflict.severity === 'warning').length,
        blockingCount: conflicts.filter((conflict) => conflict.severity === 'blocking').length,
        generatedAt: new Date().toISOString(),
      },
    }
  }

  async summarizeAllocation(
    organizationId: number,
    projectId: number,
    allocationId: number,
  ): Promise<ResourceConflictResult> {
    const allocation = await ResourceAllocation.query().where('id', allocationId).first()
    if (!allocation) throw new ResourceNotFoundException('分配记录不存在')
    const task = await Task.query()
      .where('id', allocation.taskId)
      .where('project_id', projectId)
      .first()
    const from = allocation.startDate?.toISODate() ?? task?.startDate?.toISODate()
    const to = allocation.endDate?.toISODate() ?? task?.endDate?.toISODate()
    if (!from || !to) {
      return {
        data: [],
        meta: {
          total: 0,
          warningCount: 0,
          blockingCount: 0,
          generatedAt: new Date().toISOString(),
        },
      }
    }

    const conflicts = await this.listConflicts(organizationId, projectId, {
      from,
      to,
      resourceId: allocation.resourceId,
    })
    const data = conflicts.data.filter(
      (conflict) =>
        conflict.allocationId === allocationId ||
        (conflict.resourceId === allocation.resourceId &&
          (conflict.taskId === null || conflict.taskId === allocation.taskId)),
    )
    return {
      data,
      meta: {
        total: data.length,
        warningCount: data.filter((conflict) => conflict.severity === 'warning').length,
        blockingCount: data.filter((conflict) => conflict.severity === 'blocking').length,
        generatedAt: new Date().toISOString(),
      },
    }
  }

  private matrixConflicts(rows: ResourceMatrixRow[]): ResourceConflict[] {
    const conflicts: ResourceConflict[] = []
    for (const row of rows) {
      for (const day of row.days) {
        if (day.conflictFlags.includes('overload')) {
          conflicts.push({
            type: 'overload',
            severity: 'warning',
            resourceId: row.resourceId,
            taskId: day.taskIds[0] ?? null,
            requirementId: null,
            allocationId: day.allocationIds[0] ?? null,
            from: day.date,
            to: day.date,
            reason: `${row.resourceName} 在 ${day.date} 的分配比例为 ${day.allocationPercent}%，超过 100%。`,
            suggestion: '检查同日分配，必要时调整比例、拆分任务或改派候选资源。',
          })
        }
        if (day.conflictFlags.includes('unavailable_allocation')) {
          conflicts.push({
            type: 'unavailable_allocation',
            severity: 'warning',
            resourceId: row.resourceId,
            taskId: day.taskIds[0] ?? null,
            requirementId: null,
            allocationId: day.allocationIds[0] ?? null,
            from: day.date,
            to: day.date,
            reason: `${row.resourceName} 在 ${day.date} 可用容量为 0，但仍存在资源分配。`,
            suggestion: '确认该日期是否为请假、节假日或资源例外，并通过 preview 调整分配窗口。',
          })
        }
      }
    }
    return conflicts
  }

  private async detectRequirementGaps(
    organizationId: number,
    projectId: number,
    from: string,
    to: string,
  ): Promise<ResourceConflict[]> {
    const [resources, requirements] = await Promise.all([
      Resource.query().where('project_id', projectId).where('status', 'active'),
      TaskResourceRequirement.query()
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereNotIn('status', ['cancelled', 'fulfilled'])
        .where('start_date', '<=', to)
        .where('end_date', '>=', from),
    ])

    return requirements
      .filter(
        (requirement) =>
          !resources.some((resource) => this.matchesRequirement(resource, requirement)),
      )
      .map((requirement) => ({
        type: 'requirement_gap',
        severity: 'warning',
        resourceId: null,
        taskId: requirement.taskId,
        requirementId: requirement.id,
        allocationId: null,
        from: requirement.startDate.toISODate()!,
        to: requirement.endDate.toISODate()!,
        reason: `任务资源需求缺少候选资源：角色 ${requirement.role}，技能 ${this.parseJsonList(requirement.skillTags).join('、') || '未设置'}`,
        suggestion: '补充资源技能标签、调整需求条件，或手动创建可审查的资源建议。',
      }))
  }

  private async detectWindowOverflow(
    projectId: number,
    from: string,
    to: string,
  ): Promise<ResourceConflict[]> {
    const resources = await Resource.query().where('project_id', projectId)
    if (resources.length === 0) return []
    const allocations = await ResourceAllocation.query()
      .whereIn(
        'resource_id',
        resources.map((resource) => resource.id),
      )
      .where((query) => query.whereNull('start_date').orWhere('start_date', '<=', to))
      .where((query) => query.whereNull('end_date').orWhere('end_date', '>=', from))

    const tasks = await Task.query().whereIn(
      'id',
      Array.from(new Set(allocations.map((allocation) => allocation.taskId))),
    )
    const taskMap = new Map(tasks.map((task) => [task.id, task]))

    return allocations
      .filter((allocation) => {
        const task = taskMap.get(allocation.taskId)
        if (!task) return false
        const allocationStart = allocation.startDate?.toISODate()
        const allocationEnd = allocation.endDate?.toISODate()
        const taskStart = task.startDate?.toISODate()
        const taskEnd = task.endDate?.toISODate()
        return Boolean(
          (allocationStart && taskStart && allocationStart < taskStart) ||
          (allocationEnd && taskEnd && allocationEnd > taskEnd),
        )
      })
      .map((allocation) => ({
        type: 'allocation_window_overflow',
        severity: 'warning',
        resourceId: allocation.resourceId,
        taskId: allocation.taskId,
        requirementId: null,
        allocationId: allocation.id,
        from: allocation.startDate?.toISODate() ?? from,
        to: allocation.endDate?.toISODate() ?? to,
        reason: '资源分配窗口超出任务开始或结束日期。',
        suggestion: '将分配窗口收敛到任务日期内，或先正式调整任务日期。',
      }))
  }

  private async detectIllegalReferences(
    projectId: number,
    from: string,
    to: string,
  ): Promise<ResourceConflict[]> {
    const [resources, tasks] = await Promise.all([
      Resource.query().where('project_id', projectId),
      Task.query().where('project_id', projectId),
    ])
    const resourceIds = resources.map((resource) => resource.id)
    const taskIds = tasks.map((task) => task.id)
    if (resourceIds.length === 0 && taskIds.length === 0) return []

    const allocations = await ResourceAllocation.query()
      .where((query) => {
        if (resourceIds.length > 0) query.whereIn('resource_id', resourceIds)
        if (taskIds.length > 0) query.orWhereIn('task_id', taskIds)
      })
      .where((query) => query.whereNull('start_date').orWhere('start_date', '<=', to))
      .where((query) => query.whereNull('end_date').orWhere('end_date', '>=', from))

    const resourceSet = new Set(resourceIds)
    const taskSet = new Set(taskIds)
    return allocations
      .filter(
        (allocation) => !resourceSet.has(allocation.resourceId) || !taskSet.has(allocation.taskId),
      )
      .map((allocation) => ({
        type: 'illegal_reference',
        severity: 'blocking',
        resourceId: allocation.resourceId,
        taskId: allocation.taskId,
        requirementId: null,
        allocationId: allocation.id,
        from: allocation.startDate?.toISODate() ?? from,
        to: allocation.endDate?.toISODate() ?? to,
        reason: '资源分配引用了当前项目外的资源或任务。',
        suggestion: '删除非法引用，并通过当前项目的正式资源分配接口重新创建。',
      }))
  }

  private matchesRequirement(resource: Resource, requirement: TaskResourceRequirement): boolean {
    const roles = new Set([resource.role, ...this.parseJsonList(resource.roleTags)])
    if (!roles.has(requirement.role)) return false
    const resourceSkills = new Set(this.parseJsonList(resource.skillTags))
    return this.parseJsonList(requirement.skillTags).every((skill) => resourceSkills.has(skill))
  }

  private parseJsonList(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
    return project
  }
}
