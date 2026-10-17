import { ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import TaskService from '#services/task_service'
import type { TaskPriority, TaskStatus } from '#services/task_status_machine'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

export type CalendarView = 'month' | 'week' | 'day'

export interface TaskCalendarFilters {
  view: CalendarView
  anchorDate: string
  dateFrom?: string
  dateTo?: string
  search?: string
  status?: TaskStatus[]
  priority?: TaskPriority[]
  assigneeIds?: number[]
  page?: number
  perPage?: number
}

function computeDateRange(view: CalendarView, anchorDate: string): { from: string; to: string } {
  const anchor = DateTime.fromISO(anchorDate)
  if (!anchor.isValid) {
    throw new ValidationException('锚点日期格式无效')
  }

  switch (view) {
    case 'day':
      return { from: anchor.toISODate()!, to: anchor.toISODate()! }
    case 'week': {
      const start = anchor.startOf('week')
      const end = anchor.endOf('week')
      return { from: start.toISODate()!, to: end.toISODate()! }
    }
    case 'month': {
      const start = anchor.startOf('month').startOf('week')
      const end = anchor.endOf('month').endOf('week')
      return { from: start.toISODate()!, to: end.toISODate()! }
    }
  }
}

const split = <T extends string>(value?: string | T[]) =>
  value ? ((Array.isArray(value) ? value : value.split(',').filter(Boolean)) as T[]) : undefined

const numericList = (value?: string | number[]) =>
  value ? (Array.isArray(value) ? value : value.split(',').map(Number)) : undefined

@inject()
export default class TaskCalendarService {
  constructor(private tasks: TaskService) {}

  async list(organizationId: number, projectId: number, filters: TaskCalendarFilters) {
    await this.tasks.assertProjectAccess(organizationId, projectId)

    const { from: computedFrom, to: computedTo } = computeDateRange(
      filters.view,
      filters.anchorDate,
    )
    const dateFrom = filters.dateFrom ?? computedFrom
    const dateTo = filters.dateTo ?? computedTo

    this.validateDateRange(dateFrom, dateTo)

    const page = filters.page ?? 1
    const perPage = Math.min(filters.perPage ?? 200, 200)

    let query = Task.query()
      .where('tasks.project_id', projectId)
      .whereNull('tasks.deleted_at')
      .preload('assignee')
      .select('tasks.*')
      .where('tasks.end_date', '>=', dateFrom)
      .where('tasks.end_date', '<=', dateTo)

    const statuses = split<TaskStatus>(filters.status)
    const priorities = split<TaskPriority>(filters.priority)
    const assigneeIds = numericList(filters.assigneeIds)

    if (statuses?.length) query = query.whereIn('tasks.status', statuses)
    if (priorities?.length) query = query.whereIn('tasks.priority', priorities)
    if (assigneeIds?.length) query = query.whereIn('tasks.assignee_id', assigneeIds)

    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      const numericId = /^\d+$/.test(filters.search) ? Number(filters.search) : null
      query = query.where((builder) => {
        builder.whereILike('tasks.name', keyword)
        if (numericId && Number.isSafeInteger(numericId)) builder.orWhere('tasks.id', numericId)
      })
    }

    query = query.orderByRaw("COALESCE(tasks.end_date, '9999-12-31') ASC")
    query = query.orderBy('tasks.id', 'asc')

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

  private validateDateRange(dateFrom: string, dateTo: string) {
    for (const value of [dateFrom, dateTo]) {
      if (!DateTime.fromISO(value).isValid) {
        throw new ValidationException('日期格式无效')
      }
    }
    if (dateFrom > dateTo) {
      throw new ValidationException('日期起始不得晚于结束')
    }
  }
}
