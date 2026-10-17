import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import Project from '#models/project'
import Resource from '#models/resource'
import ResourceAvailabilityException from '#models/resource_availability_exception'
import {
  createWorkingCalendar,
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
} from './gantt_working_calendar.js'

const DAY_MS = 86_400_000
const MAX_WINDOW_DAYS = 366

export interface ResourceCapacityDay {
  date: string
  isWorkingDay: boolean
  baseCapacityHours: number
  capacityHours: number
  exceptionId: number | null
  exceptionStatus: string | null
  exceptionReason: string | null
}

export interface ResourceCapacityResult {
  resourceId: number
  projectId: number
  from: string
  to: string
  days: ResourceCapacityDay[]
  totalBaseCapacityHours: number
  totalCapacityHours: number
}

export default class ResourceAvailabilityService {
  async calculateForResource(
    organizationId: number,
    projectId: number,
    resourceId: number,
    from: string,
    to: string,
  ): Promise<ResourceCapacityResult> {
    const project = await this.projectOrFail(organizationId, projectId)
    const resource = await this.resourceOrFail(projectId, resourceId)
    const dateRange = this.dateRange(from, to)
    const calendar = createWorkingCalendar(project.settings)

    const exceptions = await ResourceAvailabilityException.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('resource_id', resourceId)
      .whereNot('status', 'cancelled')
      .where('start_date', '<=', to)
      .where('end_date', '>=', from)

    const days = dateRange.map((timestamp) => {
      const date = formatIsoDate(timestamp)
      const baseWorkingDay = this.isResourceWorkingDay(resource, calendar, timestamp)
      const baseCapacityHours = baseWorkingDay ? Number(resource.dailyCapacityHours) : 0
      const exception = exceptions.find((item) => {
        const start = item.startDate.toISODate()!
        const end = item.endDate.toISODate()!
        return start <= date && end >= date
      })
      const capacityHours = exception ? Number(exception.capacityOverrideHours) : baseCapacityHours

      return {
        date,
        isWorkingDay: baseWorkingDay,
        baseCapacityHours,
        capacityHours,
        exceptionId: exception?.id ?? null,
        exceptionStatus: exception?.status ?? null,
        exceptionReason: exception?.reason ?? null,
      }
    })

    return {
      resourceId,
      projectId,
      from,
      to,
      days,
      totalBaseCapacityHours: this.roundHours(
        days.reduce((sum, day) => sum + day.baseCapacityHours, 0),
      ),
      totalCapacityHours: this.roundHours(days.reduce((sum, day) => sum + day.capacityHours, 0)),
    }
  }

  async calculateForProject(
    organizationId: number,
    projectId: number,
    from: string,
    to: string,
  ): Promise<ResourceCapacityResult[]> {
    await this.projectOrFail(organizationId, projectId)
    const resources = await Resource.query()
      .where('project_id', projectId)
      .where('status', 'active')
    const results: ResourceCapacityResult[] = []
    for (const resource of resources) {
      results.push(
        await this.calculateForResource(organizationId, projectId, resource.id, from, to),
      )
    }
    return results
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

  private async resourceOrFail(projectId: number, resourceId: number): Promise<Resource> {
    const resource = await Resource.query()
      .where('id', resourceId)
      .where('project_id', projectId)
      .first()
    if (!resource) throw new ResourceNotFoundException('资源不存在')
    return resource
  }

  private dateRange(from: string, to: string): number[] {
    const start = parseIsoDate(from)
    const end = parseIsoDate(to)
    if (end < start) throw new ValidationException('结束日期不能早于开始日期')
    const days = Math.floor((end - start) / DAY_MS) + 1
    if (days > MAX_WINDOW_DAYS) {
      throw new ValidationException(`资源容量查询窗口不能超过 ${MAX_WINDOW_DAYS} 天`)
    }
    return Array.from({ length: days }, (_, index) => start + index * DAY_MS)
  }

  private isResourceWorkingDay(
    resource: Resource,
    calendar: ReturnType<typeof createWorkingCalendar>,
    timestamp: number,
  ): boolean {
    const date = formatIsoDate(timestamp)
    if (calendar.holidays.has(date)) return false
    if (calendar.extraWorkdays.has(date)) return true
    if (resource.capacityCalendarPolicy === 'resource_work_days') {
      const workDays = this.parseWorkDays(resource.workDays)
      return workDays.includes(new Date(timestamp).getUTCDay())
    }
    return isWorkingDay(calendar, timestamp)
  }

  /** 兼容 SQLite 的 JSON 字符串与 PostgreSQL json 列已解析的数组。 */
  private parseWorkDays(value: unknown): number[] {
    let parsed: unknown = value ?? [1, 2, 3, 4, 5]
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        return [1, 2, 3, 4, 5]
      }
    }
    return Array.isArray(parsed) ? parsed.map(Number).filter((day) => day >= 0 && day <= 6) : []
  }

  private roundHours(value: number): number {
    return Math.round(value * 100) / 100
  }
}
