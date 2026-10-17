import TaskListViewService from '#services/task_list_view_service'
import { taskDto } from '#types/dto'
import { listTaskViewValidator } from '#validators/task_list_view'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { TaskPriority, TaskStatus } from '#services/task_status_machine'

const split = <T extends string>(value?: string | T[]) =>
  value ? ((Array.isArray(value) ? value : value.split(',').filter(Boolean)) as T[]) : undefined

const numericList = (value?: string | number[]) =>
  value ? (Array.isArray(value) ? value : value.split(',').map(Number)) : undefined

@inject()
export default class TaskListViewController {
  constructor(private listView: TaskListViewService) {}

  async index(ctx: HttpContext) {
    const filters = await ctx.request.validateUsing(listTaskViewValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.listView.list(
      ctx.tenant!.organizationId,
      Number(ctx.params.projectId),
      {
        search: filters.search,
        statuses: split<TaskStatus>(filters.status),
        priorities: split<TaskPriority>(filters.priority),
        assigneeIds: numericList(filters.assigneeId),
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        sort: Array.isArray(filters.sort) ? filters.sort.join(',') : filters.sort,
        page: filters.page,
        perPage: filters.perPage,
      },
    )

    return ctx.response.ok({
      data: result.data.map((task) => taskDto(task)),
      meta: result.meta,
    })
  }
}
