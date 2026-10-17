import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import Project from '#models/project'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

export interface DateAllocationSummary {
  date: string
  totalAllocatedPercent: number
  allocatedHours: number
  capacityHours: number
}

export interface ResourceLoadItem {
  resourceId: number
  resourceName: string
  role: string
  dailyCapacityHours: number
  days: DateAllocationSummary[]
  overallUtilizationPercent: number
}

export interface ResourceLoadResult {
  from: string
  to: string
  resources: ResourceLoadItem[]
  teamAverageUtilizationPercent: number
}

export interface TrendDay {
  date: string
  totalHours: number
  capacityHours: number
  utilizationPercent: number
}

export interface TrendResult {
  from: string
  to: string
  totalResources: number
  days: TrendDay[]
}

@inject()
export default class ResourceLoadService {
  async load(
    organizationId: number,
    projectId: number,
    from: string,
    to: string,
    view: string = 'team',
    resourceId?: number,
  ): Promise<ResourceLoadResult | TrendResult> {
    await this.projectOrFail(organizationId, projectId)

    const fromDate = DateTime.fromISO(from)
    const toDate = DateTime.fromISO(to)
    const dateRange = this.generateDateRange(fromDate, toDate)

    if (view === 'trend') {
      return this.trendLoad(organizationId, projectId, fromDate, toDate, dateRange)
    }

    return this.teamLoad(organizationId, projectId, fromDate, toDate, dateRange, resourceId)
  }

  /**
   * `work_days` 在 SQLite 下是 JSON 字符串，在 PostgreSQL 的 json 列下驱动已解析成数组。
   * 直接 `JSON.parse(数组)` 会把数组转成 "1,2,3" 再解析而抛错（开发库实测 500）。
   */
  private parseWorkDays(value: unknown): number[] {
    const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]
    let parsed: unknown = value
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value)
      } catch {
        return DEFAULT_WORK_DAYS
      }
    }
    if (!Array.isArray(parsed)) return DEFAULT_WORK_DAYS
    return parsed.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  }

  private async teamLoad(
    _organizationId: number,
    projectId: number,
    fromDate: DateTime,
    toDate: DateTime,
    dateRange: DateTime[],
    resourceId?: number,
  ): Promise<ResourceLoadResult> {
    let resourcesQuery = Resource.query().where('project_id', projectId).where('status', 'active')

    if (resourceId) {
      resourcesQuery = resourcesQuery.where('id', resourceId)
    }

    const resources = await resourcesQuery
    if (resources.length === 0) {
      return {
        from: fromDate.toISODate()!,
        to: toDate.toISODate()!,
        resources: [],
        teamAverageUtilizationPercent: 0,
      }
    }

    const resourceIds = resources.map((r) => r.id)
    const allocations = await ResourceAllocation.query()
      .whereIn('resource_id', resourceIds)
      .where((q) => {
        q.whereNull('start_date').orWhere('start_date', '<=', toDate.toISODate()!)
      })
      .where((q) => {
        q.whereNull('end_date').orWhere('end_date', '>=', fromDate.toISODate()!)
      })

    const allocationMap = new Map<number, ResourceAllocation[]>()
    for (const a of allocations) {
      const list = allocationMap.get(a.resourceId) ?? []
      list.push(a)
      allocationMap.set(a.resourceId, list)
    }

    let totalUtilizationSum = 0
    const items: ResourceLoadItem[] = resources.map((r) => {
      const days = dateRange.map((date) => {
        const dayOfWeek = date.weekday === 7 ? 0 : date.weekday
        const workDays = this.parseWorkDays(r.workDays)
        const isWorkDay = workDays.includes(dayOfWeek)

        if (!isWorkDay) {
          return {
            date: date.toISODate()!,
            totalAllocatedPercent: 0,
            allocatedHours: 0,
            capacityHours: 0,
          }
        }

        const dateStr = date.toISODate()!
        const resourceAllocs = allocationMap.get(r.id) ?? []
        let dayAllocatedPercent = 0
        for (const a of resourceAllocs) {
          const aStart = a.startDate?.toISODate()
          const aEnd = a.endDate?.toISODate()
          if (aStart && aStart > dateStr) continue
          if (aEnd && aEnd < dateStr) continue
          dayAllocatedPercent += a.allocationPercent
        }
        const capacityHours = r.dailyCapacityHours
        const allocatedHours = (dayAllocatedPercent / 100) * capacityHours

        return {
          date: dateStr,
          totalAllocatedPercent: dayAllocatedPercent,
          allocatedHours: Math.round(allocatedHours * 100) / 100,
          capacityHours,
        }
      })

      const totalAllocated = days.reduce((sum, d) => sum + d.allocatedHours, 0)
      const totalCapacity = days.reduce((sum, d) => sum + d.capacityHours, 0)
      const utilization =
        totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 10000) / 100 : 0

      totalUtilizationSum += utilization

      return {
        resourceId: r.id,
        resourceName: r.name,
        role: r.role,
        dailyCapacityHours: r.dailyCapacityHours,
        days,
        overallUtilizationPercent: utilization,
      }
    })

    const teamAvg =
      items.length > 0 ? Math.round((totalUtilizationSum / items.length) * 100) / 100 : 0

    return {
      from: fromDate.toISODate()!,
      to: toDate.toISODate()!,
      resources: items,
      teamAverageUtilizationPercent: teamAvg,
    }
  }

  private async trendLoad(
    _organizationId: number,
    projectId: number,
    fromDate: DateTime,
    toDate: DateTime,
    dateRange: DateTime[],
  ): Promise<TrendResult> {
    const resources = await Resource.query()
      .where('project_id', projectId)
      .where('status', 'active')

    const resourceIds = resources.map((r) => r.id)
    const totalCapacityPerDay = resources.reduce((sum, r) => sum + r.dailyCapacityHours, 0)

    const days: TrendDay[] = dateRange.map((date) => {
      const dateStr = date.toISODate()!
      return {
        date: dateStr,
        totalHours: 0,
        capacityHours: totalCapacityPerDay,
        utilizationPercent: 0,
      }
    })

    if (resourceIds.length > 0) {
      const allocations = await ResourceAllocation.query()
        .whereIn('resource_id', resourceIds)
        .where((q) => {
          q.whereNull('start_date').orWhere('start_date', '<=', toDate.toISODate()!)
        })
        .where((q) => {
          q.whereNull('end_date').orWhere('end_date', '>=', fromDate.toISODate()!)
        })

      const resourceMap = new Map<number, Resource>()
      for (const r of resources) resourceMap.set(r.id, r)

      for (const [i, day] of days.entries()) {
        const dateStr = day.date
        let dayTotalHours = 0
        for (const a of allocations) {
          const aStart = a.startDate?.toISODate()
          const aEnd = a.endDate?.toISODate()
          if (aStart && aStart > dateStr) continue
          if (aEnd && aEnd < dateStr) continue
          const res = resourceMap.get(a.resourceId)
          if (!res) continue

          const dayOfWeek = dateRange[i].weekday === 7 ? 0 : dateRange[i].weekday
          const workDays = this.parseWorkDays(res.workDays)
          if (!workDays.includes(dayOfWeek)) continue

          const allocHours = (a.allocationPercent / 100) * res.dailyCapacityHours
          dayTotalHours += allocHours
        }
        day.totalHours = Math.round(dayTotalHours * 100) / 100
        day.utilizationPercent =
          totalCapacityPerDay > 0
            ? Math.round((dayTotalHours / totalCapacityPerDay) * 10000) / 100
            : 0
      }
    }

    return {
      from: fromDate.toISODate()!,
      to: toDate.toISODate()!,
      totalResources: resources.length,
      days,
    }
  }

  private generateDateRange(from: DateTime, to: DateTime): DateTime[] {
    const dates: DateTime[] = []
    let current = from
    while (current <= to) {
      dates.push(current)
      current = current.plus({ days: 1 })
    }
    return dates
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<void> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) throw new ResourceNotFoundException('项目不存在')
  }
}
