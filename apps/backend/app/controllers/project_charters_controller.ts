import type User from '#models/user'
import ProjectCharterPolicy from '#policies/project_charter_policy'
import ProjectCharterService from '#services/project_charter_service'
import {
  approveCharterValidator,
  createCharterValidator,
  updateCharterValidator,
} from '#validators/project_charter'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * 项目章程控制器（v3-chart-gallery-data-foundation，design D5）。
 *
 * 纯 HTTP 解析 + 服务调用 + 响应格式化；业务规则/审批状态机在
 * ProjectCharterService，跨租户 404 由服务层 projectOrFail 保证。
 */
@inject()
export default class ProjectChartersController {
  constructor(
    private charters: ProjectCharterService,
    private policy: ProjectCharterPolicy,
  ) {}

  private user(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private orgId(ctx: HttpContext): number {
    return ctx.tenant!.organizationId
  }

  /** GET /projects/:projectId/charter —— 章程详情（未创建返回 data: null）。 */
  async show(ctx: HttpContext) {
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeView(this.user(ctx), organizationId, projectId)

    const charter = await this.charters.get(organizationId, projectId)
    return ctx.response.ok({ data: charter?.serialize() ?? null })
  }

  /** POST /projects/:projectId/charter —— 首次创建章程草案（draft, version 1）。 */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createCharterValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeUpdate(actor, organizationId, projectId)

    const charter = await this.charters.create(organizationId, projectId, input, actor.id)
    return ctx.response.ok({ data: charter.serialize() })
  }

  /** PATCH /projects/:projectId/charter —— 编辑草案态/被驳回态章程。 */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateCharterValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeUpdate(actor, organizationId, projectId)

    const charter = await this.charters.update(organizationId, projectId, input, actor.id)
    return ctx.response.ok({ data: charter.serialize() })
  }

  /** POST /projects/:projectId/charter/submit —— 提交审批（draft|rejected → pending_approval）。 */
  async submit(ctx: HttpContext) {
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeSubmit(actor, organizationId, projectId)

    const charter = await this.charters.submit(organizationId, projectId, actor.id)
    return ctx.response.ok({ data: charter.serialize() })
  }

  /** POST /projects/:projectId/charter/approve —— 审批决议（approve/reject）。 */
  async approve(ctx: HttpContext) {
    const { action } = await ctx.request.validateUsing(approveCharterValidator)
    const actor = this.user(ctx)
    const organizationId = this.orgId(ctx)
    const projectId = Number(ctx.params.projectId)
    await this.policy.authorizeApprove(actor, organizationId, projectId)

    const charter = await this.charters.approve(organizationId, projectId, action, actor.id)
    return ctx.response.ok({ data: charter.serialize() })
  }
}
