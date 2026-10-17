import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import type { CalendarFullResponse, CalendarFullFilters } from '#types/calendar_item'
import TaskService from '#services/task_service'
import MilestoneService from '#services/milestone_service'
import Project from '#models/project'
import Task from '#models/task'
import db from '@adonisjs/lucid/services/db'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import {
  taskToCalendarItem,
  milestoneToCalendarItem,
  buildWorkingCalendarContext,
  isWindowTooLarge,
  sortCalendarItems,
} from './calendar_item_mapper.js'

@inject()
export default class ProjectCalendarService {
  constructor(
    private tasks: TaskService,
    private milestones: MilestoneService,
  ) {}

  /**
   * Calendar 统一查询入口。
   *
   * mode=deadline → 截止日模式（V1 兼容，委托 TaskCalendarService）
   * mode=schedule  → 完整排程模式（V2，区间相交查询 + 里程碑聚合 + 工作日历上下文）
   */
  async list(
    organizationId: number,
    projectId: number,
    filters: CalendarFullFilters,
  ): Promise<CalendarFullResponse> {
    await this.tasks.assertProjectAccess(organizationId, projectId)

    const { from: computedFrom, to: computedTo } = this.computeDateRange(
      filters.view,
      filters.anchorDate,
    )
    const dateFrom = filters.dateFrom ?? computedFrom
    const dateTo = filters.dateTo ?? computedTo

    this.validateDateRange(dateFrom, dateTo)

    if (isWindowTooLarge(dateFrom, dateTo)) {
      throw new ValidationException('日期窗口过大，请缩小查询范围（最大 18 个月）')
    }

    const page = filters.page ?? 1
    const perPage = Math.min(filters.perPage ?? 200, 200)
    const today = DateTime.now().toISODate()!

    // 读取项目工作日历
    const project = await this.projectOrFail(organizationId, projectId)
    const workingCalendarContext = buildWorkingCalendarContext(
      project.settings as Record<string, unknown> | null | undefined,
    )

    if (filters.mode === 'deadline') {
      return this.listDeadlineMode(
        organizationId,
        projectId,
        {
          ...filters,
          dateFrom,
          dateTo,
          page,
          perPage,
        },
        today,
        workingCalendarContext,
      )
    }

    return this.listScheduleMode(
      organizationId,
      projectId,
      {
        ...filters,
        dateFrom,
        dateTo,
        page,
        perPage,
      },
      today,
      workingCalendarContext,
    )
  }

  /**
   * Schedule 模式：按区间相交查询 + 里程碑聚合 + 工作日历上下文。
   */
  private async listScheduleMode(
    organizationId: number,
    projectId: number,
    filters: Readonly<{
      view: 'month' | 'week' | 'day'
      anchorDate: string
      dateFrom: string
      dateTo: string
      status?: string
      priority?: string
      assigneeIds?: string
      search?: string
      itemTypes?: string
      page: number
      perPage: number
    }>,
    today: string,
    workingCalendarContext: ReturnType<typeof buildWorkingCalendarContext>,
  ): Promise<CalendarFullResponse> {
    const itemTypes = filters.itemTypes
      ? new Set(filters.itemTypes.split(','))
      : new Set(['task', 'milestone'])

    let tasks: Task[] = []
    let unscheduledCount = 0

    if (itemTypes.has('task')) {
      tasks = await this.queryIntersectingTasks(projectId, filters)
      const unscheduledRow = await db
        .from('tasks')
        .where('project_id', projectId)
        .whereNull('deleted_at')
        .whereNull('start_date')
        .whereNull('end_date')
        .count('* as count')
        .first()
      unscheduledCount = Number(unscheduledRow?.count ?? 0)
    }

    let calendarMilestones: ReturnType<typeof milestoneToCalendarItem>[] = []
    if (itemTypes.has('milestone')) {
      const allMilestones = await this.milestones.listForProject(organizationId, projectId)
      for (const m of allMilestones) {
        const plannedDate = m.milestone.plannedDate?.toISODate()
        if (plannedDate && plannedDate >= filters.dateFrom && plannedDate <= filters.dateTo) {
          calendarMilestones.push(milestoneToCalendarItem(m, today))
        }
      }
    }

    const taskItems = tasks.map((task) => taskToCalendarItem(task, today))
    const allItems = sortCalendarItems([...taskItems, ...calendarMilestones])

    const total = allItems.length
    // 这段时间没有排期：给出前后最近一次排期日期，界面可「跳到最近有任务的月份」
    const nearestScheduled =
      total === 0 && itemTypes.has('task')
        ? await this.nearestScheduledDates(projectId, filters.dateFrom, filters.dateTo)
        : undefined
    const totalPages = Math.max(1, Math.ceil(total / filters.perPage))
    const start = (filters.page - 1) * filters.perPage
    const pagedItems = allItems.slice(start, start + filters.perPage)

    return {
      data: pagedItems,
      meta: {
        total,
        page: filters.page,
        perPage: filters.perPage,
        totalPages,
        unscheduledCount,
        truncated: total > filters.perPage * filters.page,
        ...(nearestScheduled ? { nearestScheduled } : {}),
      },
      workingCalendar: workingCalendarContext,
    }
  }

  /** 窗口之前最近的排期日（取截止日优先）与之后最近的排期日（取开始日优先）。 */
  private async nearestScheduledDates(
    projectId: number,
    dateFrom: string,
    dateTo: string,
  ): Promise<{ before: string | null; after: string | null }> {
    const base = () => db.from('tasks').where('project_id', projectId).whereNull('deleted_at')
    const afterRow = await base()
      .whereRaw('COALESCE(start_date, end_date) > ?', [dateTo])
      .min({ value: db.raw('COALESCE(start_date, end_date)') })
      .first()
    const beforeRow = await base()
      .whereRaw('COALESCE(end_date, start_date) < ?', [dateFrom])
      .max({ value: db.raw('COALESCE(end_date, start_date)') })
      .first()
    const iso = (value: unknown): string | null => {
      if (!value) return null
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value).slice(0, 10)
    }
    return { before: iso(beforeRow?.value), after: iso(afterRow?.value) }
  }

  /**
   * Deadline 模式委托。
   */
  private async listDeadlineMode(
    _organizationId: number,
    projectId: number,
    filters: {
      dateFrom: string
      dateTo: string
      page: number
      perPage: number
      status?: string
      priority?: string
      assigneeIds?: string
      search?: string
    },
    today: string,
    workingCalendarContext: ReturnType<typeof buildWorkingCalendarContext>,
  ): Promise<CalendarFullResponse> {
    let query = Task.query()
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .preload('assignee')
      .select('*')
      .where('end_date', '>=', filters.dateFrom)
      .where('end_date', '<=', filters.dateTo)

    query = this.applyTaskFilters(query, filters)

    const paginator = await query
      .orderByRaw("COALESCE(end_date, '9999-12-31') ASC")
      .orderBy('id', 'asc')
      .paginate(filters.page, filters.perPage)

    const rows = paginator.all()
    const meta = paginator.getMeta()

    const items = sortCalendarItems(rows.map((task) => taskToCalendarItem(task, today)))

    return {
      data: items,
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
      workingCalendar: workingCalendarContext,
    }
  }

  /**
   * 区间相交查询（schedule 模式）。
   * 覆盖完整区间、单端日期任务。
   */
  private async queryIntersectingTasks(
    projectId: number,
    filters: {
      dateFrom: string
      dateTo: string
      status?: string
      priority?: string
      assigneeIds?: string
      search?: string
    },
  ): Promise<Task[]> {
    const query = Task.query()
      .where('project_id', projectId)
      .whereNull('deleted_at')
      .preload('assignee')
      .select('*')
      .where((builder) => {
        // 区间相交：有完整日期范围的
        builder
          .whereNotNull('start_date')
          .whereNotNull('end_date')
          .where('start_date', '<=', filters.dateTo)
          .where('end_date', '>=', filters.dateFrom)
          // 仅有 end_date（截止日单点）
          .orWhere((q) => {
            q.whereNull('start_date')
              .whereNotNull('end_date')
              .where('end_date', '>=', filters.dateFrom)
              .where('end_date', '<=', filters.dateTo)
          })
          // 仅有 start_date（开始日单点）
          .orWhere((q) => {
            q.whereNotNull('start_date')
              .whereNull('end_date')
              .where('start_date', '>=', filters.dateFrom)
              .where('start_date', '<=', filters.dateTo)
          })
      })

    this.applyTaskFilters(query, filters)

    return query.orderByRaw("COALESCE(start_date, end_date, '9999-12-31') ASC").orderBy('id', 'asc')
  }

  private applyTaskFilters(
    query: any,
    filters: { status?: string; priority?: string; assigneeIds?: string; search?: string },
  ) {
    if (filters.status) {
      const statuses = filters.status.split(',').filter(Boolean)
      if (statuses.length) void query.whereIn('status', statuses)
    }
    if (filters.priority) {
      const priorities = filters.priority.split(',').filter(Boolean)
      if (priorities.length) void query.whereIn('priority', priorities)
    }
    if (filters.assigneeIds) {
      const ids = filters.assigneeIds
        .split(',')
        .map(Number)
        .filter((n) => Number.isFinite(n))
      if (ids.length) void query.whereIn('assignee_id', ids)
    }
    if (filters.search) {
      const keyword = `%${filters.search.replace(/[%_]/g, '\\$&')}%`
      void query.whereILike('name', keyword)
    }
    return query
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

  private computeDateRange(
    view: 'month' | 'week' | 'day',
    anchorDate: string,
  ): { from: string; to: string } {
    const anchor = DateTime.fromISO(anchorDate)
    switch (view) {
      case 'month': {
        const start = anchor.startOf('month')
        const end = anchor.endOf('month')
        return { from: start.toISODate()!, to: end.toISODate()! }
      }
      case 'week': {
        const start = anchor.startOf('week')
        const end = anchor.endOf('week')
        return { from: start.toISODate()!, to: end.toISODate()! }
      }
      case 'day': {
        return { from: anchorDate, to: anchorDate }
      }
    }
  }

  /**
   * 截止日模式也要展示工作日历与封网窗口（只读上下文，不影响任务日期）。
   * 组织隔离与软删除校验与完整模式一致。
   */
  async workingCalendarContext(organizationId: number, projectId: number) {
    const project = await this.projectOrFail(organizationId, projectId)
    return buildWorkingCalendarContext(
      project.settings as Record<string, unknown> | null | undefined,
    )
  }

  private async projectOrFail(organizationId: number, projectId: number): Promise<Project> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
    if (!project) {
      throw new ResourceNotFoundException('项目不存在')
    }
    return project
  }
}
