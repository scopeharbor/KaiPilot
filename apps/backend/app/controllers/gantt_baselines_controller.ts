import type User from '#models/user'
import GanttBaselinePolicy from '#policies/gantt_baseline_policy'
import GanttBaselineService from '#services/gantt_baseline_service'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class GanttBaselinesController {
  constructor(
    private baselines: GanttBaselineService,
    private policy: GanttBaselinePolicy,
  ) {}

  async show(ctx: HttpContext) {
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const user = ctx.auth.getUserOrFail() as User
    await this.policy.authorizeView(user, organizationId, projectId)
    const baseline = await this.baselines.get(organizationId, projectId)
    return ctx.response.ok({ data: baseline?.serialize() ?? null })
  }

  async store(ctx: HttpContext) {
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const user = ctx.auth.getUserOrFail() as User
    await this.policy.authorizeSave(user, organizationId, projectId)
    const baseline = await this.baselines.save(organizationId, projectId, user.id, {
      requestId: ctx.request.id() ?? null,
    })
    return ctx.response.ok({ data: baseline.serialize() })
  }
}
