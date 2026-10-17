import ChangeRequestPolicy from '#policies/change_request_policy'
import ChangeRequestService from '#services/change_request_service'
import {
  createChangeRequestValidator,
  decisionValidator,
  listChangeRequestsValidator,
  updateChangeRequestValidator,
} from '#validators/change_request'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 变更请求控制器（simple-change-approval）。
 *
 * 嵌套路由 `/projects/:projectId/change-requests`：index/store。
 * 扁平路由 `/change-requests/:id`：show/update + 动作端点。
 */
@inject()
export default class ChangeRequestsController {
  constructor(
    private service: ChangeRequestService,
    private policy: ChangeRequestPolicy,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  private auditContext({ request }: HttpContext) {
    return {
      requestId: request.id() ?? null,
    }
  }

  // ──────── 嵌套路由（/projects/:projectId/change-requests）──────

  /** GET /projects/:projectId/change-requests */
  async index(ctx: HttpContext) {
    const projectId = Number(ctx.params.projectId)
    const organizationId = ctx.tenant!.organizationId
    const filters = await ctx.request.validateUsing(listChangeRequestsValidator, {
      data: ctx.request.qs(),
    })
    const { data, meta } = await this.service.list(organizationId, projectId, filters)
    return ctx.response.ok({ data, meta })
  }

  /** POST /projects/:projectId/change-requests */
  async store(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(createChangeRequestValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)

    await this.policy.authorizeCreate(user, organizationId, projectId)

    const cr = await this.service.createDraft(
      organizationId,
      projectId,
      {
        title: input.title,
        description: input.description,
        changeType: input.changeType,
        priority: input.priority,
        impactSummary: input.impactSummary,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.created({ data: cr })
  }

  // ──────── 扁平路由（/change-requests/:id）──────

  /** GET /change-requests/:id */
  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const cr = await this.service.findInOrgOrFail(organizationId, Number(ctx.params.id))
    const projectId = Number(cr.projectId)

    await this.policy.authorizeView(user, organizationId, projectId)

    return ctx.response.ok({ data: cr })
  }

  /** PATCH /change-requests/:id */
  async update(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(updateChangeRequestValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeUpdate(user, organizationId, projectId, existing)

    const cr = await this.service.update(
      organizationId,
      projectId,
      crId,
      {
        title: input.title,
        description: input.description,
        changeType: input.changeType,
        priority: input.priority,
        impactSummary: input.impactSummary,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  // ──────── 动作端点 ────────

  /** POST /change-requests/:id/submit */
  async submit(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeSubmit(user, organizationId, projectId, existing)

    const cr = await this.service.submit(
      organizationId,
      projectId,
      crId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/approve */
  async approve(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(decisionValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeApprove(user, organizationId, projectId, existing)

    const cr = await this.service.approve(
      organizationId,
      projectId,
      crId,
      {
        decisionReason: input.decisionReason,
        conditions: input.conditions,
        impactAnalysisId: input.impactAnalysisId,
        confirmStaleReason: input.confirmStaleReason,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/reject */
  async reject(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(decisionValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeApprove(user, organizationId, projectId, existing)

    const cr = await this.service.reject(
      organizationId,
      projectId,
      crId,
      {
        decisionReason: input.decisionReason,
        impactAnalysisId: input.impactAnalysisId,
        confirmStaleReason: input.confirmStaleReason,
      },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/return */
  async returnForRevision(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(decisionValidator)
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeApprove(user, organizationId, projectId, existing)

    const cr = await this.service.returnForRevision(
      organizationId,
      projectId,
      crId,
      { decisionReason: input.decisionReason },
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/mark-implemented */
  async markImplemented(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeMarkImplemented(user, organizationId, projectId, existing)

    const cr = await this.service.markImplemented(
      organizationId,
      projectId,
      crId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/close */
  async close(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeClose(user, organizationId, projectId)

    const cr = await this.service.close(
      organizationId,
      projectId,
      crId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/cancel */
  async cancel(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeCancel(user, organizationId, projectId, existing)

    const cr = await this.service.cancel(
      organizationId,
      projectId,
      crId,
      user.id,
      this.auditContext(ctx),
    )
    return ctx.response.ok({ data: cr })
  }

  /** POST /change-requests/:id/ai-impact — AI 影响分析建议（待确认，不自动保存） */
  async aiImpact(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const crId = Number(ctx.params.id)

    const existing = await this.service.findInOrgOrFail(organizationId, crId)
    const projectId = Number(existing.projectId)

    await this.policy.authorizeView(user, organizationId, projectId)

    const result = await this.service.generateAiImpactSuggestions(
      organizationId,
      projectId,
      crId,
      user.id,
    )
    return ctx.response.ok({ data: result })
  }
}
