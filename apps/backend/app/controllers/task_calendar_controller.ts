import TaskCalendarService from '#services/task_calendar_service'
import ProjectCalendarService from '#services/calendar/project_calendar_service'
import type { TaskStatus, TaskPriority } from '#services/task_status_machine'
import { taskCalendarValidator } from '#validators/task_calendar'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

const split = <T extends string>(value?: string | T[]) =>
  value ? ((Array.isArray(value) ? value : value.split(',').filter(Boolean)) as T[]) : undefined

const numericList = (value?: string | number[]) =>
  value ? (Array.isArray(value) ? value : value.split(',').map(Number)) : undefined

interface TaskRow {
  id: number
  name: string
  status: string
  priority: string
  taskType: string
  startDate: string | null
  endDate: string | null
  projectId: number
  assignee?: Record<string, unknown> | null
}

/**
 * Calendar 控制器。
 *
 * 支持 V1 截止日模式（mode=deadline，不传即默认）与 V2 完整排程模式（mode=schedule）。
 */
@inject()
export default class TaskCalendarController {
  constructor(
    private calendar: TaskCalendarService,
    private fullCalendar: ProjectCalendarService,
  ) {}

  async index(ctx: HttpContext) {
    const filters = await ctx.request.validateUsing(taskCalendarValidator, {
      data: ctx.request.qs(),
    })

    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    // 不传 mode 或 mode=deadline → V1 截止日模式（向后兼容）
    if (!filters.mode || filters.mode === 'deadline') {
      const result = await this.calendar.list(organizationId, projectId, {
        view: filters.view,
        anchorDate: filters.anchorDate,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        search: filters.search,
        status: split(filters.status as unknown as string) as TaskStatus[] | undefined,
        priority: split<TaskPriority>(filters.priority),
        assigneeIds: numericList(filters.assigneeId),
        page: filters.page,
        perPage: filters.perPage,
      })

      return ctx.response.ok({
        data: result.data.map((task) => {
          const t = task as unknown as TaskRow
          return {
            id: t.id,
            name: t.name,
            status: t.status,
            priority: t.priority,
            taskType: t.taskType,
            startDate: t.startDate,
            endDate: t.endDate,
            assignee: t.assignee ?? null,
            projectId: t.projectId,
          }
        }),
        meta: result.meta,
        workingCalendar: await this.fullCalendar.workingCalendarContext(organizationId, projectId),
      })
    }

    // mode=schedule → V2 完整排程模式
    // 将校验器输出转为字符串（CalendarFullFilters 接受 string | undefined）
    const statusStr = Array.isArray(filters.status) ? filters.status.join(',') : filters.status
    const priorityStr = Array.isArray(filters.priority)
      ? filters.priority.join(',')
      : filters.priority
    const assigneeStr = Array.isArray(filters.assigneeId)
      ? filters.assigneeId.join(',')
      : filters.assigneeId
    const itemTypesStr = Array.isArray(filters.itemTypes)
      ? filters.itemTypes.join(',')
      : filters.itemTypes

    const result = await this.fullCalendar.list(organizationId, projectId, {
      mode: 'schedule',
      view: filters.view,
      anchorDate: filters.anchorDate,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      search: filters.search,
      status: statusStr,
      priority: priorityStr,
      assigneeIds: assigneeStr,
      itemTypes: itemTypesStr,
      page: filters.page,
      perPage: filters.perPage,
    })

    return ctx.response.ok(result)
  }
}
