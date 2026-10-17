import ChangeImpactAnalysisPolicy from '#policies/change_impact_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import ChangeImpactAnalysisService from '#services/change_impact/analysis_service'
import AiExplanationService from '#services/change_impact/ai_explanation_service'
import type { AnalysisScope } from '@aiproj/types'
import {
  createImpactAnalysisValidator,
  listImpactAnalysesValidator,
  confirmAnalysisValidator,
  confirmStaleAnalysisValidator,
  aiExplanationValidator,
} from '#validators/change_impact'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * V2 变更影响分析 Controller（v2-change-management-impact-analysis §6.3）。
 *
 * 嵌套路由：/projects/:projectId/change-requests/:changeRequestId/impact-analyses
 * 扁平路由：/impact-analyses/:id
 */
@inject()
export default class ChangeImpactController {
  constructor(
    private service: ChangeImpactAnalysisService,
    private aiExplanation: AiExplanationService,
    private policy: ChangeImpactAnalysisPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  // ──────── 嵌套路由 ────────

  /** POST /projects/:projectId/change-requests/:changeRequestId/impact-analyses */
  async createAnalysis(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const changeRequestId = Number(ctx.params.changeRequestId)
    const input = await ctx.request.validateUsing(createImpactAnalysisValidator)

    await this.assertCreate(user, organizationId, projectId)
    const scope: Partial<AnalysisScope> | undefined = input.scope
      ? {
          dimensions: input.scope.dimensions,
          maxPropagationDepth: input.scope.maxPropagationDepth,
          includeEvidenceDetails: input.scope.includeEvidenceDetails,
        }
      : undefined

    const analysis = await this.service.createAnalysis(
      organizationId,
      projectId,
      changeRequestId,
      user.id,
      scope,
      ctx.request.id(),
    )

    return ctx.response.created({ data: analysis })
  }

  /** GET /projects/:projectId/change-requests/:changeRequestId/impact-analyses */
  async listAnalyses(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.projectId)
    const changeRequestId = Number(ctx.params.changeRequestId)
    const filters = await ctx.request.validateUsing(listImpactAnalysesValidator, {
      data: ctx.request.qs(),
    })

    await this.assertView(user, organizationId, projectId)

    const { data, meta } = await this.service.listAnalyses(
      projectId,
      changeRequestId,
      filters.page,
      filters.perPage,
    )

    return ctx.response.ok({ data, meta })
  }

  // ──────── 扁平路由 ────────

  /** GET /impact-analyses/:id */
  async getAnalysis(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const id = Number(ctx.params.id)

    // 扁平路由不带 projectId，从记录解析（组织隔离）
    const analysis = await this.service.getAnalysisInOrg(id, organizationId)
    const projectId = analysis.projectId

    await this.assertView(user, organizationId, projectId)

    const items = await this.service.getAnalysisItems(id)

    // 过期检测
    const stale = await this.service.detectStale(id, projectId)
    if (stale.isStale && analysis.status !== 'stale') {
      await this.service.markStale(id, projectId, stale.reason ?? '过期', user.id, ctx.request.id())
      analysis.status = 'stale' as any
      analysis.staleReason = stale.reason
    }

    return ctx.response.ok({
      data: {
        ...analysis.serialize(),
        items,
        isStale: stale.isStale,
        staleReason: stale.reason,
      },
    })
  }

  /** POST /impact-analyses/:id/refresh */
  async refreshAnalysis(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const id = Number(ctx.params.id)

    // 扁平路由不带 projectId，从记录解析（组织隔离）
    const existing = await this.service.getAnalysisInOrg(id, organizationId)
    const projectId = existing.projectId

    await this.assertRefresh(user, organizationId, projectId)

    const analysis = await this.service.refreshAnalysis(
      organizationId,
      projectId,
      existing.changeRequestId,
      user.id,
      undefined,
      ctx.request.id(),
    )

    return ctx.response.ok({ data: analysis })
  }

  /** POST /impact-analyses/:id/confirm */
  async confirmAnalysis(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const id = Number(ctx.params.id)
    const input = await ctx.request.validateUsing(confirmAnalysisValidator)

    const resolved = await this.service.getAnalysisInOrg(id, organizationId)
    const projectId = resolved.projectId

    await this.assertConfirm(user, organizationId, projectId)

    const analysis = await this.service.confirmAnalysis(
      id,
      projectId,
      user.id,
      input.reason,
      ctx.request.id(),
    )

    return ctx.response.ok({ data: analysis })
  }

  /** POST /impact-analyses/:id/confirm-stale */
  async confirmStaleAnalysis(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const id = Number(ctx.params.id)
    const input = await ctx.request.validateUsing(confirmStaleAnalysisValidator)

    const resolved = await this.service.getAnalysisInOrg(id, organizationId)
    const projectId = resolved.projectId

    await this.assertConfirm(user, organizationId, projectId)

    const analysis = await this.service.confirmStaleAnalysis(
      id,
      projectId,
      user.id,
      input.reason,
      ctx.request.id(),
    )

    return ctx.response.ok({ data: analysis })
  }

  /** POST /impact-analyses/:id/ai-explanation */
  async generateAiExplanation(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const id = Number(ctx.params.id)
    const input = await ctx.request.validateUsing(aiExplanationValidator)

    const analysis = await this.service.getAnalysisInOrg(id, organizationId)
    const projectId = analysis.projectId

    await this.assertAiExplanation(user, organizationId, projectId)

    const explanation = await this.aiExplanation.generateExplanation(
      id,
      projectId,
      user.id,
      input.focus,
      ctx.request.id(),
    )

    return ctx.response.ok({ data: explanation })
  }

  // ──────── 权限辅助 ────────

  private async assertView(user: User, orgId: number, projectId: number) {
    const allowed = await this.policy.view(user, orgId, projectId)
    if (!allowed) this.throwDenied(user.id, orgId, 'view')
  }

  private async assertCreate(user: User, orgId: number, projectId: number) {
    const allowed = await this.policy.create(user, orgId, projectId)
    if (!allowed) this.throwDenied(user.id, orgId, 'create')
  }

  private async assertRefresh(user: User, orgId: number, projectId: number) {
    const allowed = await this.policy.refresh(user, orgId, projectId)
    if (!allowed) this.throwDenied(user.id, orgId, 'refresh')
  }

  private async assertConfirm(user: User, orgId: number, projectId: number) {
    const allowed = await this.policy.confirm(user, orgId, projectId)
    if (!allowed) this.throwDenied(user.id, orgId, 'confirm')
  }

  private async assertAiExplanation(user: User, orgId: number, projectId: number) {
    const allowed = await this.policy.generateAiExplanation(user, orgId, projectId)
    if (!allowed) this.throwDenied(user.id, orgId, 'ai_explanation')
  }

  private async throwDenied(userId: number, organizationId: number, action: string) {
    await this.audit.log({
      event: AuditEvent.PERMISSION_DENIED,
      userId,
      organizationId,
      entityType: 'change_impact_analysis',
      metadata: { action, reason: '权限不足' },
    })
    const { PermissionDeniedException } = await import('#exceptions/api_exception')
    throw new PermissionDeniedException('无权执行此操作')
  }
}
