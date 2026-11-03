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

/** OpenProject 式分组字段（v3-classic-ui-openproject-table）。 */
export const TASK_LIST_GROUP_FIELDS = ['status', 'priority', 'assignee'] as const

export type TaskListGroupField = (typeof TASK_LIST_GROUP_FIELDS)[number]

/** 分组列：状态 / 优先级取原值，负责人取用户 id（未分配为 null）。 */
const GROUP_COLUMNS: Record<TaskListGroupField, string> = {
  status: 'tasks.status',
  priority: 'tasks.priority',
  assignee: 'tasks.assignee_id',
}

export interface TaskListGroupSummary {
  key: string | number | null
  count: number
  estimatedHours: number
  actualHours: number
}

export interface TaskListSums {
  count: number
  estimatedHours: number
  actualHours: number
  progressPercent: number
}

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
  /** 按字段分组：分组字段成为首要排序，并返回整份筛选结果的每组汇总。 */
  groupBy?: TaskListGroupField
  /** 返回整份筛选结果的合计。 */
  sums?: boolean
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
    let query = this.filtered(projectId, filters).preload('assignee').select('tasks.*')

    const terms = this.withGroupTerm(this.parseSort(filters.sort ?? '+name'), filters.groupBy)
    for (const term of terms) {
      const expression = SORT_EXPRESSIONS[term.field]
      query = query
        .orderByRaw(`CASE WHEN ${expression} IS NULL THEN 1 ELSE 0 END ASC`)
        .orderByRaw(`${expression} ${term.direction}`)
    }
    query = query.orderBy('tasks.id', 'asc')

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    const groups = filters.groupBy
      ? await this.groupSummaries(projectId, filters, filters.groupBy, terms[0]!.direction)
      : undefined
    const sums = filters.sums ? await this.sums(projectId, filters) : undefined
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
        ...(groups ? { groups } : {}),
        ...(sums ? { sums } : {}),
      },
    }
  }

  /** 项目内未删除任务 + 筛选条件；列表、分组汇总与合计共用，保证统计口径一致。 */
  private filtered(projectId: number, filters: TaskListViewFilters) {
    let query = Task.query().where('tasks.project_id', projectId).whereNull('tasks.deleted_at')

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
    return query
  }

  /**
   * 分组字段放到排序首位，使同组任务在分页之间连续；用户已按该字段排序时沿用其方向。
   * 总排序字段仍不超过三个。
   */
  private withGroupTerm(terms: SortTerm[], groupBy?: TaskListGroupField): SortTerm[] {
    if (!groupBy) return terms
    const existing = terms.find((term) => term.field === groupBy)
    const groupTerm: SortTerm = existing ?? { field: groupBy, direction: 'asc' }
    return [groupTerm, ...terms.filter((term) => term.field !== groupBy)].slice(0, 3)
  }

  /** 整份筛选结果的每组任务数与工时合计，顺序与分组排序一致（空值组在最后）。 */
  private async groupSummaries(
    projectId: number,
    filters: TaskListViewFilters,
    groupBy: TaskListGroupField,
    direction: SortTerm['direction'],
  ): Promise<TaskListGroupSummary[]> {
    const column = GROUP_COLUMNS[groupBy]
    const order = SORT_EXPRESSIONS[groupBy]
    const rows = await this.filtered(projectId, filters)
      .select(`${column} as group_key`)
      .count('* as total')
      .sum('tasks.estimated_hours as estimated_hours')
      .sum('tasks.actual_hours as actual_hours')
      .groupBy(column)
      .orderByRaw(`CASE WHEN ${order} IS NULL THEN 1 ELSE 0 END ASC`)
      .orderByRaw(`${order} ${direction}`)
      .pojo<{
        group_key: string | number | null
        total: number | string
        estimated_hours: number | string | null
        actual_hours: number | string | null
      }>()
    return rows.map((row) => ({
      key: groupBy === 'assignee' && row.group_key !== null ? Number(row.group_key) : row.group_key,
      count: Number(row.total),
      estimatedHours: toHours(row.estimated_hours),
      actualHours: toHours(row.actual_hours),
    }))
  }

  /** 整份筛选结果的合计：任务数、预计 / 实际工时合计、平均进度（取整）。 */
  private async sums(projectId: number, filters: TaskListViewFilters): Promise<TaskListSums> {
    const [row] = await this.filtered(projectId, filters)
      .count('* as total')
      .sum('tasks.estimated_hours as estimated_hours')
      .sum('tasks.actual_hours as actual_hours')
      .avg('tasks.progress_percent as progress_avg')
      .pojo<{
        total: number | string
        estimated_hours: number | string | null
        actual_hours: number | string | null
        progress_avg: number | string | null
      }>()
    return {
      count: Number(row?.total ?? 0),
      estimatedHours: toHours(row?.estimated_hours ?? null),
      actualHours: toHours(row?.actual_hours ?? null),
      progressPercent: Math.round(Number(row?.progress_avg ?? 0)),
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

/** 工时合计：空值按 0；保留两位小数，避免浮点累加误差外露。 */
function toHours(value: number | string | null): number {
  return Math.round(Number(value ?? 0) * 100) / 100
}
