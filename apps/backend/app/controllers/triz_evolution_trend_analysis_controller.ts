import TrizEvolutionTrendPolicy from '#policies/triz_evolution_trend_policy'
import TrizEvolutionTrendAnalysisService from '#services/triz_evolution_trend_analysis_service'
import {
  createEvolutionTrendAnalysisValidator,
  listEvolutionTrendAnalysesValidator,
  listTrendScoresValidator,
  listTrendRisksValidator,
  historyComparisonValidator,
  reviewTrendRiskValidator,
  handoffPreviewValidator,
} from '#validators/triz_evolution_trend'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { AuditEvent } from '#services/audit_service'
import AuditService from '#services/audit_service'

@inject()
export default class TrizEvolutionTrendAnalysisController {
  constructor(
    private service: TrizEvolutionTrendAnalysisService,
    private policy: TrizEvolutionTrendPolicy,
    private auditService: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }
  private orgProject(ctx: HttpContext): { organizationId: number; projectId: number } {
    return { organizationId: ctx.tenant!.organizationId, projectId: Number(ctx.params.projectId) }
  }

  private async guard(
    ctx: HttpContext,
    ability: 'view' | 'manage' | 'aiExplain',
    message: string,
  ): Promise<{ user: User; organizationId: number; projectId: number } | null> {
    const user = this.currentUser(ctx)
    const { organizationId, projectId } = this.orgProject(ctx)
    const allowed = await this.policy[ability](user, organizationId, projectId)
    if (!allowed) {
      await this.auditService.log({
        event: AuditEvent.TRIZ_EVOLUTION_TREND_PERMISSION_DENIED,
        userId: user.id,
        organizationId,
        projectId,
        metadata: { ability },
      })
      ctx.response.status(403).json({ error: { code: 'PERMISSION_DENIED', message } })
      return null
    }
    return { user, organizationId, projectId }
  }

  async create(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权创建 TRIZ 进化趋势分析运行')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const payload = await ctx.request.validateUsing(createEvolutionTrendAnalysisValidator)
    // 校验器里 trendId/sourceNote 是可选（缺省即 undefined），契约里是必填可空，
    // 这里补齐成 null 再进 Service，而不是用断言把差异藏起来
    const result = await this.service.createRun(organizationId, projectId, user.id, {
      ...payload,
      manualTrendSignals: payload.manualTrendSignals?.map((s) => ({
        ...s,
        trendId: s.trendId ?? null,
        sourceNote: s.sourceNote ?? null,
      })),
    })
    return ctx.response.ok({ data: { ...result.run, trends: result.trends, risks: result.risks } })
  }

  async index(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 进化趋势分析运行')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const filters = await ctx.request.validateUsing(listEvolutionTrendAnalysesValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listRuns(organizationId, projectId, filters)
    await this.auditService.log({
      event: AuditEvent.TRIZ_EVOLUTION_TREND_READ,
      userId: user.id,
      organizationId,
      projectId,
      metadata: { runCount: result.meta.total, page: result.meta.page },
    })
    return ctx.response.ok(result)
  }

  async show(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 进化趋势分析运行')
    if (!guard) return
    const { organizationId, projectId } = guard
    const runId = Number(ctx.params.runId)
    const run = await this.service.getRun(organizationId, projectId, runId)
    if (!run)
      return ctx.response
        .status(404)
        .json({ error: { code: 'RESOURCE_NOT_FOUND', message: '分析运行不存在' } })
    return ctx.response.ok({ data: run })
  }

  async trends(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 进化趋势评分')
    if (!guard) return
    const { organizationId, projectId } = guard
    const runId = Number(ctx.params.runId)
    const filters = await ctx.request.validateUsing(listTrendScoresValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listTrends(organizationId, projectId, runId, filters)
    return ctx.response.ok(result)
  }

  async risks(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 进化趋势风险候选')
    if (!guard) return
    const { organizationId, projectId } = guard
    const runId = Number(ctx.params.runId)
    const filters = await ctx.request.validateUsing(listTrendRisksValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.listRisks(organizationId, projectId, runId, filters)
    return ctx.response.ok(result)
  }

  async history(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'view', '无权查看 TRIZ 进化趋势历史对比')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const runId = Number(ctx.params.runId)
    const query = await ctx.request.validateUsing(historyComparisonValidator, {
      data: ctx.request.qs(),
    })
    const result = await this.service.historyComparison(
      organizationId,
      projectId,
      user.id,
      runId,
      query,
    )
    return ctx.response.ok({ data: result })
  }

  async explain(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'aiExplain', '无权生成 TRIZ 进化趋势说明')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const runId = Number(ctx.params.runId)
    const riskId = Number(ctx.params.riskId)
    const result = await this.service.explainRisk(organizationId, projectId, user.id, runId, riskId)
    return ctx.response.ok({ data: result })
  }

  async review(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权审查 TRIZ 进化趋势风险候选')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const runId = Number(ctx.params.runId)
    const riskId = Number(ctx.params.riskId)
    const payload = await ctx.request.validateUsing(reviewTrendRiskValidator)
    const result = await this.service.reviewRisk(
      organizationId,
      projectId,
      user.id,
      runId,
      riskId,
      payload,
    )
    return ctx.response.ok({ data: result })
  }

  async workbenchPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成 Workbench 预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const payload = await ctx.request.validateUsing(handoffPreviewValidator)
    const result = await this.service.workbenchPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.riskId),
      payload.currentSourceHashes,
    )
    return ctx.response.ok({ data: result })
  }

  async decisionPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成决策预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const payload = await ctx.request.validateUsing(handoffPreviewValidator)
    const result = await this.service.decisionPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.riskId),
      payload.currentSourceHashes,
    )
    return ctx.response.ok({ data: result })
  }

  async draftPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成草案预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const payload = await ctx.request.validateUsing(handoffPreviewValidator)
    const result = await this.service.draftPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.riskId),
      payload.currentSourceHashes,
    )
    return ctx.response.ok({ data: result })
  }

  async riskPreview(ctx: HttpContext) {
    const guard = await this.guard(ctx, 'manage', '无权生成风险预览')
    if (!guard) return
    const { user, organizationId, projectId } = guard
    const payload = await ctx.request.validateUsing(handoffPreviewValidator)
    const result = await this.service.riskPreview(
      organizationId,
      projectId,
      user.id,
      Number(ctx.params.runId),
      Number(ctx.params.riskId),
      payload.currentSourceHashes,
    )
    return ctx.response.ok({ data: result })
  }
}
