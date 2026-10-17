import { ValidationException } from '#exceptions/api_exception'
import Task from '#models/task'
import TaskService from '#services/task_service'
import type { TaskPriority, TaskStatus } from '#services/task_status_machine'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'

export const TASK_LIST_SORT_FIELDS = [
  'name',
  'priority',
  'status',
  'assignee',
  'progressPercent',
  'endDate',
  'estimatedHours',
  'actualHours',
  'createdAt',
  'updatedAt',
] as const

export type TaskListSortField = (typeof TASK_LIST_SORT_FIELDS)[number]

export interface TaskListViewFilters {
  search?: string
  statuses?: TaskStatus[]
  priorities?: TaskPriority[]
  assigneeIds?: number[]
  dateFrom?: string
  dateTo?: string
  sort?: string
  page?: number
  perPage?: number
}

interface SortTerm {
  field: TaskListSortField
  direction: 'asc' | 'desc'
}

const SORT_EXPRESSIONS: Record<TaskListSortField, string> = {
  name: 'LOWER(tasks.name)',
  priority:
    "CASE tasks.priority WHEN 'lowest' THEN 0 WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'highest' THEN 4 ELSE 99 END",
  status:
    "CASE tasks.status WHEN 'not_started' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'blocked' THEN 2 WHEN 'on_hold' THEN 3 WHEN 'completed' THEN 4 WHEN 'cancelled' THEN 5 ELSE 99 END",
  assignee:
    '(SELECT LOWER(COALESCE(users.full_name, users.email)) FROM users WHERE users.id = tasks.assignee_id)',
  progressPercent: 'tasks.progress_percent',
  endDate: 'tasks.end_date',
  estimatedHours: 'tasks.estimated_hours',
  actualHours: 'tasks.actual_hours',
  createdAt: 'tasks.created_at',
  updatedAt: 'tasks.updated_at',
}

@inject()
export default class TaskListViewService {
  constructor(private tasks: TaskService) {}

  async list(organizationId: number, projectId: number, filters: TaskListViewFilters = {}) {
    await this.tasks.assertProjectAccess(organizationId, projectId)
    this.assertDateRange(filters.dateFrom, filters.dateTo)

    const page = filters.page ?? 1
    const perPage = filters.perPage ?? 50
    let query = Task.query()
      .where('tasks.project_id', projectId)
      .whereNull('tasks.deleted_at')
      .preload('assignee')
      .select('tasks.*')

    if (filters.statuses?.length) query = query.whereIn('tasks.status', filters.statuses)
    if (filters.priorities?.length) query = query.whereIn('tasks.priority', filters.priorities)
    if (filters.assigneeIds?.length) {
      query = query.whereIn('tasks.assignee_id', filters.assigneeIds)
    }
    if (filters.dateFrom) query = query.where('tasks.end_date', '>=', filters.dateFrom)
    if (filters.dateTo) query = query.where('tasks.end_date', '<=', filters.dateTo)

    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      const numericId = /^\d+$/.test(filters.search) ? Number(filters.search) : null
      query = query.where((builder) => {
        builder.whereILike('tasks.name', keyword)
        if (numericId && Number.isSafeInteger(numericId)) builder.orWhere('tasks.id', numericId)
      })
    }

    for (const term of this.parseSort(filters.sort ?? '+name')) {
      const expression = SORT_EXPRESSIONS[term.field]
      query = query
        .orderByRaw(`CASE WHEN ${expression} IS NULL THEN 1 ELSE 0 END ASC`)
        .orderByRaw(`${expression} ${term.direction}`)
    }
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

  private parseSort(value: string): SortTerm[] {
    const terms = value.split(',')
    if (terms.length > 3) throw new ValidationException('列表最多支持三个排序字段')

    const seen = new Set<string>()
    return terms.map((term) => {
      const field = term.slice(1) as TaskListSortField
      if (
        !['+', '-'].includes(term[0] ?? '') ||
        !TASK_LIST_SORT_FIELDS.includes(field) ||
        seen.has(field)
      ) {
        throw new ValidationException('列表排序字段无效或重复')
      }
      seen.add(field)
      return { field, direction: term[0] === '-' ? 'desc' : 'asc' }
    })
  }

  private assertDateRange(dateFrom?: string, dateTo?: string) {
    for (const value of [dateFrom, dateTo]) {
      if (value && !DateTime.fromISO(value).isValid) {
        throw new ValidationException('截止日期格式无效')
      }
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new ValidationException('截止日期起点不得晚于终点')
    }
  }
}
