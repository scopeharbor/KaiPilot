import { scheduleProjectSignalDetection } from '#services/project_signal/signal_auto_detect'
import TaskPolicy from '#policies/task_policy'
import KanbanService from '#services/kanban_service'
import TaskService from '#services/task_service'
import { taskDto } from '#types/dto'
import { listKanbanColumnValidator, moveKanbanTaskValidator } from '#validators/kanban'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class KanbanController {
  constructor(
    private kanban: KanbanService,
    private tasks: TaskService,
    private policy: TaskPolicy,
  ) {}

  async index(ctx: HttpContext) {
    const filters = await ctx.request.validateUsing(listKanbanColumnValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.kanban.listColumn(
      ctx.tenant!.organizationId,
      Number(ctx.params.projectId),
      filters,
    )
    return ctx.response.ok({
      data: result.data.map((task) => taskDto(task)),
      meta: result.meta,
    })
  }

  async move(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(moveKanbanTaskValidator)
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const target = await this.tasks.getForAuthorize(organizationId, projectId, input.taskId)
    await this.policy.authorizeUpdate(user, organizationId, projectId, target)

    const task = await this.kanban.move(organizationId, projectId, input, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    // 任务状态变了：后台按规则重新检测该项目的信号（节流、不阻塞响应）
    scheduleProjectSignalDetection({ organizationId, projectId, user })
    return ctx.response.ok({
      data: taskDto(task),
      meta: { warnings: this.kanban.warningsFor(input.taskId) },
    })
  }
}
