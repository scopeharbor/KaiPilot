import type User from '#models/user'
import CommunicationPlanPolicy from '#policies/communication_plan_policy'
import CommunicationPlanService from '#services/communication_plan_service'
import type { CommunicationPlanListFilters } from '#services/communication_plan_service'
import {
  createCommunicationPlanValidator,
  listCommunicationPlansValidator,
  updateCommunicationPlanValidator,
} from '#validators/communication_plan'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 沟通管理计划控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 纯 HTTP 解析 + 服务调用 + 响应格式化；启停开关经 PATCH isActive 表达
 * （design：PATCH /:id 更新配置或启停状态）。
 */
@inject()
export default class CommunicationPlansController {
  constructor(
    private plans: CommunicationPlanService,
    private policy: CommunicationPlanPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /projects/:projectId/communication-plans —— 分页列表（含启停/类型/频次/渠道过滤）。 */
  async index(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const query = await ctx.request.validateUsing(listCommunicationPlansValidator, {
      data: ctx.request.qs(),
    })
    const filters: CommunicationPlanListFilters = {
      ...query,
      // GET 查询串布尔归一化：'true' / 'false' → boolean
      isActive: query.isActive === undefined ? undefined : query.isActive === 'true',
    }
    const result = await this.plans.list(organizationId, projectId, filters)
    return ctx.response.ok(result)
  }

  /** POST /projects/:projectId/communication-plans —— 新建沟通计划项。 */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createCommunicationPlanValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeManage(actor, organizationId, projectId)

    const plan = await this.plans.create(organizationId, projectId, input, actor.id)
    return ctx.response.created({ data: plan.serialize() })
  }

  /** GET /projects/:projectId/communication-plans/:id —— 详情。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const planId = Number(ctx.params.id)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const plan = await this.plans.get(organizationId, projectId, planId)
    return ctx.response.ok({ data: plan.serialize() })
  }

  /** PATCH /projects/:projectId/communication-plans/:id —— 更新配置或启停状态。 */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateCommunicationPlanValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const planId = Number(ctx.params.id)
    await this.policy.authorizeManage(actor, organizationId, projectId)

    const plan = await this.plans.update(organizationId, projectId, planId, input, actor.id)
    return ctx.response.ok({ data: plan.serialize() })
  }

  /** DELETE /projects/:projectId/communication-plans/:id —— 软删除。 */
  async destroy(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    const planId = Number(ctx.params.id)
    await this.policy.authorizeManage(actor, organizationId, projectId)

    await this.plans.softDelete(organizationId, projectId, planId, actor.id)
    return ctx.response.noContent()
  }
}
