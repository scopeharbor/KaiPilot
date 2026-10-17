import ContradictionPolicy from '#policies/contradiction_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import AiContradictionExplanationService from '#services/triz_contradiction/ai_explanation_service'
import ProjectContradictionService from '#services/triz_contradiction/project_contradiction_service'
import {
  confirmContradictionValidator,
  dismissContradictionValidator,
  explainContradictionValidator,
  listContradictionsValidator,
  refreshContradictionsValidator,
} from '#validators/triz_contradiction'
import { PermissionDeniedException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class ContradictionsController {
  constructor(
    private service: ProjectContradictionService,
    private aiExplanation: AiContradictionExplanationService,
    private policy: ContradictionPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  async index(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.assertView(user, organizationId, projectId)
    const filters = await ctx.request.validateUsing(listContradictionsValidator, {
      data: ctx.request.qs(),
    })
    const { data, meta } = await this.service.list(organizationId, projectId, filters)
    return ctx.response.ok({ data: data.map((item) => this.service.toDTO(item)), meta })
  }

  async show(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.assertView(user, organizationId, projectId)
    const record = await this.service.get(
      organizationId,
      projectId,
      Number(ctx.params.contradictionId),
    )
    return ctx.response.ok({ data: this.service.toDTO(record) })
  }

  async refresh(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.assertManage(user, organizationId, projectId)
    await ctx.request.validateUsing(refreshContradictionsValidator)
    const data = await this.service.createOrUpdate(
      organizationId,
      projectId,
      user.id,
      ctx.request.id(),
    )
    return ctx.response.ok({ data })
  }

  async confirm(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.assertManage(user, organizationId, projectId)
    await ctx.request.validateUsing(confirmContradictionValidator)
    const record = await this.service.confirm(
      organizationId,
      projectId,
      Number(ctx.params.contradictionId),
      user.id,
      ctx.request.id(),
    )
    return ctx.response.ok({ data: this.service.toDTO(record) })
  }

  async dismiss(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.assertManage(user, organizationId, projectId)
    const input = await ctx.request.validateUsing(dismissContradictionValidator)
    const record = await this.service.dismiss(
      organizationId,
      projectId,
      Number(ctx.params.contradictionId),
      user.id,
      input.reason,
      ctx.request.id(),
    )
    return ctx.response.ok({ data: this.service.toDTO(record) })
  }

  async explain(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    await this.assertExplain(user, organizationId, projectId)
    const input = await ctx.request.validateUsing(explainContradictionValidator)
    const data = await this.aiExplanation.explain({
      organizationId,
      projectId,
      contradictionId: Number(ctx.params.contradictionId),
      userId: user.id,
      focus: input.focus,
      requestId: ctx.request.id(),
    })
    return ctx.response.ok({ data })
  }

  private async assertView(user: User, organizationId: number, projectId: number) {
    if (await this.policy.view(user, organizationId, projectId)) return
    await this.logDenied(user.id, organizationId, projectId, 'view')
    throw new PermissionDeniedException('无矛盾查看权限')
  }

  private async assertManage(user: User, organizationId: number, projectId: number) {
    if (await this.policy.manage(user, organizationId, projectId)) return
    await this.logDenied(user.id, organizationId, projectId, 'manage')
    throw new PermissionDeniedException('无矛盾管理权限')
  }

  private async assertExplain(user: User, organizationId: number, projectId: number) {
    if (await this.policy.explain(user, organizationId, projectId)) return
    await this.logDenied(user.id, organizationId, projectId, 'explain')
    throw new PermissionDeniedException('无矛盾 AI 解释权限')
  }

  private async logDenied(
    userId: number,
    organizationId: number,
    projectId: number,
    action: string,
  ) {
    await this.audit.log({
      event: AuditEvent.PERMISSION_DENIED,
      userId,
      organizationId,
      projectId,
      entityType: 'project_contradiction',
      metadata: { action, reason: '权限不足' },
    })
  }
}
