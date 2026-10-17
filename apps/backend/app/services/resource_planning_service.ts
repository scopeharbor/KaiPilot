import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import TaskResourceRequirement from '#models/task_resource_requirement'
import ResourceAvailabilityService, {
  type ResourceCapacityResult,
} from '#services/resource_availability_service'
import { DateTime } from 'luxon'

const MAX_WINDOW_DAYS = 366

export type ResourceLoadStatus = 'idle' | 'available' | 'full' | 'overloaded' | 'unavailable'

export interface ResourcePlanningFilters {
  from: string
  to: string
  resourceId?: number
  role?: string
  skill?: string
  resourceStatus?: string
  loadStatus?: ResourceLoadStatus
}

export interface ResourcePlanningDay {
  date: string
  capacityHours: number
  allocatedHours: number
  remainingHours: number
  utilizationPercent: number
  allocationPercent: number
  conflictFlags: Array<'overload' | 'unavailable_allocation'>
  taskIds: number[]
  allocationIds: number[]
}

export interface ResourceMatrixRow {
  resourceId: number
  resourceName: string
  role: string
  status: string
  skillTags: string[]
  roleTags: string[]
  dailyCapacityHours: number
  totalCapacityHours: number
  totalAllocatedHours: number
  totalRemainingHours: number
  overallUtilizationPercent: number
  loadStatus: ResourceLoadStatus
  days: ResourcePlanningDay[]
}

export interface ResourceAggregateItem {
  key: string
  resourceCount: number
  capacityHours: number
  allocatedHours: number
  remainingHours: number
  utilizationPercent: number
}

export interface ResourcePlanningTrendDay {
  date: string
  capacityHours: number
  allocatedHours: number
  remainingHours: number
  utilizationPercent: number
  overloadedResources: number
  unavailableAllocations: number
}

export interface ResourcePlanningSummary {
  from: string
  to: string
  totalResources: number
  activeResources: number
  totalCapacityHours: number
  totalAllocatedHours: number
  totalRemainingHours: number
  averageUtilizationPercent: number
  overloadedResources: number
  idleResources: number
  unavailableAllocationDays: number
  unmetRequirements: number
  skillGapCount: number
  conflictCount: number
}

export interface ResourcePlanningResult {
  summary: ResourcePlanningSummary
  matrix: ResourceMatrixRow[]
  aggregates: {
    byRole: ResourceAggregateItem[]
    bySkill: ResourceAggregateItem[]
    byStatus: ResourceAggregateItem[]
    byLoadStatus: ResourceAggregateItem[]
  }
  trends: ResourcePlanningTrendDay[]
  meta: {
    projectId: number
    windowDays: number
    generatedAt: string
  }
}

interface AllocationWindow {
  id: number
  resourceId: number
  taskId: number
  allocationPercent: number
  startDate: string | null
  endDate: string | null
}

export default class ResourcePlanningService {
  constructor(private availability = new ResourceAvailabilityService()) {}

  async getPlanning(
    organizationId: number,
    projectId: number,
    filters: ResourcePlanningFilters,
  ): Promise<ResourcePlanningResult> {
    await this.projectOrFail(organizationId, projectId)
    const windowDays = this.validateWindow(filters.from, filters.to)
    const resources = await this.loadResources(projectId, filters)
    const capacities = await this.capacityMap(organizationId, projectId, filters.from, filters.to)
    const allocations = await this.loadAllocations(resources, filters.from, filters.to)

    const rows = resources.map((resource) =>
      this.buildRow(resource, capacities.get(resource.id), allocations.get(resource.id) ?? []),
    )
    const matrix = filters.loadStatus
      ? rows.filter((row) => row.loadStatus === filters.loadStatus)
      : rows
    const unmetRequirements = await this.countUnmetRequirements(
      organizationId,
      projectId,
      filters.from,
      filters.to,
      resources,
    )
    const unavailableAllocationDays = matrix.reduce(
      (sum, row) =>
        sum + row.days.filter((day) => day.conflictFlags.includes('unavailable_allocation')).length,
      0,
    )
    const overloadDays = matrix.reduce(
      (sum, row) => sum + row.days.filter((day) => day.conflictFlags.includes('overload')).length,
      0,
    )

    return {
      summary: {
        from: filters.from,
        to: filters.to,
        totalResources: matrix.length,
        activeResources: matrix.filter((row) => row.status === 'active').length,
        totalCapacityHours: this.round(
          matrix.reduce((sum, row) => sum + row.totalCapacityHours, 0),
        ),
        totalAllocatedHours: this.round(
          matrix.reduce((sum, row) => sum + row.totalAllocatedHours, 0),
        ),
        totalRemainingHours: this.round(
          matrix.reduce((sum, row) => sum + Math.max(0, row.totalRemainingHours), 0),
        ),
        averageUtilizationPercent: this.weightedUtilization(matrix),
        overloadedResources: matrix.filter((row) => row.loadStatus === 'overloaded').length,
        idleResources: matrix.filter((row) => row.loadStatus === 'idle').length,
        unavailableAllocationDays,
        unmetRequirements,
        skillGapCount: unmetRequirements,
        conflictCount: overloadDays + unavailableAllocationDays + unmetRequirements,
      },
      matrix,
      aggregates: {
        byRole: this.aggregateBy(matrix, (row) => row.role || '未设置角色'),
        bySkill: this.aggregateBySkills(matrix),
        byStatus: this.aggregateBy(matrix, (row) => row.status || 'unknown'),
        byLoadStatus: this.aggregateBy(matrix, (row) => row.loadStatus),
      },
      trends: this.buildTrends(matrix),
      meta: {
        projectId,
        windowDays,
        generatedAt: DateTime.utc().toISO()!,
      },
    }
  }

  private async loadResources(
    projectId: number,
    filters: ResourcePlanningFilters,
  ): Promise<Resource[]> {
    let query = Resource.query().where('project_id', projectId)
    if (filters.resourceId) query = query.where('id', filters.resourceId)
    if (filters.resourceStatus) query = query.where('status', filters.resourceStatus)
    if (filters.role) query = query.where('role', filters.role)
    const resources = await query.orderBy('name', 'asc').orderBy('id', 'asc')
    return filters.skill
      ? resources.filter((resource) =>
          this.parseJsonList(resource.skillTags).includes(filters.skill!),
        )
      : resources
  }

  private async capacityMap(
    organizationId: number,
    projectId: number,
    from: string,
    to: string,
  ): Promise<Map<number, ResourceCapacityResult>> {
    const results = await this.availability.calculateForProject(organizationId, projectId, from, to)
    return new Map(results.map((result) => [result.resourceId, result]))
  }

  private async loadAllocations(
    resources: Resource[],
    from: string,
    to: string,
  ): Promise<Map<number, AllocationWindow[]>> {
    if (resources.length === 0) return new Map()
    const allocations = await ResourceAllocation.query()
      .whereIn(
        'resource_id',
        resources.map((resource) => resource.id),
      )
      .where((query) => query.whereNull('start_date').orWhere('start_date', '<=', to))
      .where((query) => query.whereNull('end_date').orWhere('end_date', '>=', from))

    const map = new Map<number, AllocationWindow[]>()
    for (const allocation of allocations) {
      const bucket = map.get(allocation.resourceId) ?? []
      bucket.push({
        id: allocation.id,
        resourceId: allocation.resourceId,
        taskId: allocation.taskId,
        allocationPercent: Number(allocation.allocationPercent),
        startDate: allocation.startDate?.toISODate() ?? null,
        endDate: allocation.endDate?.toISODate() ?? null,
      })
      map.set(allocation.resourceId, bucket)
    }
    return map
  }

  private buildRow(
    resource: Resource,
    capacity: ResourceCapacityResult | undefined,
    allocations: AllocationWindow[],
  ): ResourceMatrixRow {
    const days =
      capacity?.days.map((capacityDay) => {
        const dayAllocations = allocations.filter((allocation) =>
          this.overlapsDate(allocation, capacityDay.date),
        )
        const allocationPercent = dayAllocations.reduce(
          (sum, allocation) => sum + allocation.allocationPercent,
          0,
        )
        const allocatedHours = this.round((allocationPercent / 100) * capacityDay.capacityHours)
        const remainingHours = this.round(capacityDay.capacityHours - allocatedHours)
        const conflictFlags: ResourcePlanningDay['conflictFlags'] = []
        if (allocationPercent > 100) conflictFlags.push('overload')
        if (capacityDay.capacityHours === 0 && allocationPercent > 0) {
          conflictFlags.push('unavailable_allocation')
        }

        return {
          date: capacityDay.date,
          capacityHours: this.round(capacityDay.capacityHours),
          allocatedHours,
          remainingHours,
          utilizationPercent:
            capacityDay.capacityHours > 0
              ? this.round((allocatedHours / capacityDay.capacityHours) * 100)
              : allocationPercent > 0
                ? 100
                : 0,
          allocationPercent: this.round(allocationPercent),
          conflictFlags,
          taskIds: Array.from(new Set(dayAllocations.map((allocation) => allocation.taskId))),
          allocationIds: dayAllocations.map((allocation) => allocation.id),
        }
      }) ?? []

    const totalCapacityHours = this.round(days.reduce((sum, day) => sum + day.capacityHours, 0))
    const totalAllocatedHours = this.round(days.reduce((sum, day) => sum + day.allocatedHours, 0))
    const totalRemainingHours = this.round(totalCapacityHours - totalAllocatedHours)
    const overallUtilizationPercent =
      totalCapacityHours > 0 ? this.round((totalAllocatedHours / totalCapacityHours) * 100) : 0

    return {
      resourceId: resource.id,
      resourceName: resource.name,
      role: resource.role,
      status: resource.status,
      skillTags: this.parseJsonList(resource.skillTags),
      roleTags: this.parseJsonList(resource.roleTags),
      dailyCapacityHours: Number(resource.dailyCapacityHours),
      totalCapacityHours,
      totalAllocatedHours,
      totalRemainingHours,
      overallUtilizationPercent,
      loadStatus: this.resolveLoadStatus(days, totalCapacityHours, totalAllocatedHours),
      days,
    }
  }

  private async countUnmetRequirements(
    organizationId: number,
    projectId: number,
    from: string,
    to: string,
    resources: Resource[],
  ): Promise<number> {
    const requirements = await TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereNotIn('status', ['cancelled', 'fulfilled'])
      .where('start_date', '<=', to)
      .where('end_date', '>=', from)
    return requirements.filter((requirement) => {
      const skills = this.parseJsonList(requirement.skillTags)
      return !resources.some((resource) => this.resourceMatches(resource, requirement.role, skills))
    }).length
  }

  private resourceMatches(resource: Resource, role: string, skills: string[]): boolean {
    const roles = new Set([resource.role, ...this.parseJsonList(resource.roleTags)])
    if (!roles.has(role)) return false
    const resourceSkills = new Set(this.parseJsonList(resource.skillTags))
    return skills.every((skill) => resourceSkills.has(skill))
  }

  private aggregateBy(
    rows: ResourceMatrixRow[],
    keyFor: (row: ResourceMatrixRow) => string,
  ): ResourceAggregateItem[] {
    const map = new Map<string, ResourceMatrixRow[]>()
    for (const row of rows) {
      const key = keyFor(row)
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return Array.from(map.entries())
      .map(([key, bucket]) => this.aggregateBucket(key, bucket))
      .sort((a, b) => a.key.localeCompare(b.key, 'zh-Hans-CN'))
  }

  private aggregateBySkills(rows: ResourceMatrixRow[]): ResourceAggregateItem[] {
    const map = new Map<string, ResourceMatrixRow[]>()
    for (const row of rows) {
      const skills = row.skillTags.length > 0 ? row.skillTags : ['未设置技能']
      for (const skill of skills) {
        map.set(skill, [...(map.get(skill) ?? []), row])
      }
    }
    return Array.from(map.entries())
      .map(([key, bucket]) => this.aggregateBucket(key, bucket))
      .sort((a, b) => a.key.localeCompare(b.key, 'zh-Hans-CN'))
  }

  private aggregateBucket(key: string, rows: ResourceMatrixRow[]): ResourceAggregateItem {
    const capacityHours = this.round(rows.reduce((sum, row) => sum + row.totalCapacityHours, 0))
    const allocatedHours = this.round(rows.reduce((sum, row) => sum + row.totalAllocatedHours, 0))
    return {
      key,
      resourceCount: rows.length,
      capacityHours,
      allocatedHours,
      remainingHours: this.round(capacityHours - allocatedHours),
      utilizationPercent:
        capacityHours > 0 ? this.round((allocatedHours / capacityHours) * 100) : 0,
    }
  }

  private buildTrends(rows: ResourceMatrixRow[]): ResourcePlanningTrendDay[] {
    const dates = Array.from(new Set(rows.flatMap((row) => row.days.map((day) => day.date)))).sort()
    return dates.map((date) => {
      const days = rows.map((row) => row.days.find((day) => day.date === date)).filter(Boolean)
      const capacityHours = this.round(days.reduce((sum, day) => sum + day!.capacityHours, 0))
      const allocatedHours = this.round(days.reduce((sum, day) => sum + day!.allocatedHours, 0))
      return {
        date,
        capacityHours,
        allocatedHours,
        remainingHours: this.round(capacityHours - allocatedHours),
        utilizationPercent:
          capacityHours > 0 ? this.round((allocatedHours / capacityHours) * 100) : 0,
        overloadedResources: days.filter((day) => day!.conflictFlags.includes('overload')).length,
        unavailableAllocations: days.filter((day) =>
          day!.conflictFlags.includes('unavailable_allocation'),
        ).length,
      }
    })
  }

  private resolveLoadStatus(
    days: ResourcePlanningDay[],
    totalCapacityHours: number,
    totalAllocatedHours: number,
  ): ResourceLoadStatus {
    if (days.some((day) => day.conflictFlags.includes('overload'))) return 'overloaded'
    if (totalCapacityHours === 0) return totalAllocatedHours > 0 ? 'overloaded' : 'unavailable'
    if (totalAllocatedHours === 0) return 'idle'
    const utilization = (totalAllocatedHours / totalCapacityHours) * 100
    if (utilization >= 95) return 'full'
    return 'available'
  }

  private weightedUtilization(rows: ResourceMatrixRow[]): number {
    const capacity = rows.reduce((sum, row) => sum + row.totalCapacityHours, 0)
    const allocated = rows.reduce((sum, row) => sum + row.totalAllocatedHours, 0)
    return capacity > 0 ? this.round((allocated / capacity) * 100) : 0
  }

  private overlapsDate(allocation: AllocationWindow, date: string): boolean {
    if (allocation.startDate && allocation.startDate > date) return false
    if (allocation.endDate && allocation.endDate < date) return false
    return true
  }

  private validateWindow(from: string, to: string): number {
    const start = DateTime.fromISO(from)
    const end = DateTime.fromISO(to)
    if (!start.isValid || !end.isValid) throw new ValidationException('资源规划日期无效')
    if (end < start) throw new ValidationException('结束日期不能早于开始日期')
    const days = Math.floor(end.diff(start, 'days').days) + 1
    if (days > MAX_WINDOW_DAYS) {
      throw new ValidationException(`资源规划查询窗口不能超过 ${MAX_WINDOW_DAYS} 天`)
    }
    return days
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

  private parseJsonList(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100
  }
}
