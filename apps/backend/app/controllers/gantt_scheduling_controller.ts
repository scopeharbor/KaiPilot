import type User from '#models/user'
import GanttSchedulingPolicy from '#policies/gantt_scheduling_policy'
import GanttSchedulingService from '#services/gantt_scheduling_service'
import { ganttScheduleValidator } from '#validators/gantt_schedule'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class GanttSchedulingController {
  constructor(
    private scheduling: GanttSchedulingService,
    private policy: GanttSchedulingPolicy,
  ) {}

  async schedule(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(ganttScheduleValidator)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const user = ctx.auth.getUserOrFail() as User
    await this.scheduling.assertAccess(organizationId, projectId, input.taskId)
    await this.policy.authorize(user, organizationId, projectId)
    const result = await this.scheduling.execute(
      organizationId,
      projectId,
      {
        mode: input.mode,
        taskId: input.taskId,
        operation: input.operation,
        startDate: input.startDate,
        endDate: input.endDate,
        autoSchedule: input.autoSchedule ?? true,
        previewToken: input.previewToken,
      },
      user.id,
      { requestId: ctx.request.id() ?? null },
    )
    return ctx.response.ok({ data: result })
  }
}
