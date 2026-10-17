import ResourceDemandForecastingPolicy from '#policies/resource_demand_forecasting_policy'
import ResourceDemandForecastingService from '#services/resource_demand_forecasting_service'
import { ResourceDemandForecastingAiAdvisor } from '#services/resource_demand_forecasting_ai'
import {
  buildForecastAiAdvisoryAuditPayload,
  ResourceDemandForecastingAuditEvent,
} from '#services/resource_demand_forecasting_audit'
import {
  forecastSummaryValidator,
  forecastDemandCurvesValidator,
  forecastGapAnalysisValidator,
  forecastProjectDriversValidator,
  forecastSkillDriversValidator,
  forecastTrendBaselineValidator,
  forecastDrillDownValidator,
  forecastAiAdvisoryValidator,
  normalizeForecastQuery,
} from '#validators/resource_demand_forecasting'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * 资源需求预测 Controller（v3-resource-demand-forecasting §4.3）。
 *
 * 职责严格限定：认证 → 参数解析与校验 → Policy 调用 → Service 调用 → 响应格式化。
 * 聚合口径、脱敏与降级逻辑全部在 ResourceDemandForecastingService。
 * 路由：`GET /api/v1/organizations/:organizationId/resource-demand-forecasting/*`
 *
 * 所有端点只读；不创建/修改/删除任何资源、分配、任务或项目事实。
 */
@inject()
export default class ResourceDemandForecastingController {
  constructor(
    private readonly service: ResourceDemandForecastingService,
    private readonly policy: ResourceDemandForecastingPolicy,
  ) {}

  private getAiAdvisor(): ResourceDemandForecastingAiAdvisor {
    // AI advisory 使用测试模式降级——生产环境需配置 AIGateway adapter
    return new ResourceDemandForecastingAiAdvisor(
      { provider: 'deferred', model: 'deferred', isReal: false } as any,
      true,
    )
  }

  // ── 参数提取 ──────────────────────────────────────────────────────────────

  private async resolveOrganizationId(ctx: HttpContext): Promise<number> {
    const id = Number(ctx.params.organizationId)
    if (!Number.isFinite(id) || id <= 0) {
      ctx.response.badRequest({
        error: { code: 'VALIDATION_ERROR', message: 'organizationId 必须为正整数' },
      })
      return 0 // will be caught by caller
    }
    return id
  }

  // ── KPI 计算辅助 ──────────────────────────────────────────────────────────

  private computeMeta(
    total: number,
    query: Record<string, unknown>,
  ): { total: number; page: number; perPage: number; totalPages: number } {
    const page = (query.page as number) ?? 1
    const perPage = (query.perPage as number) ?? 50
    return { total, page, perPage, totalPages: Math.ceil(total / perPage) }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/summary */
  async summary(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastSummaryValidator.validate(qs)
    const query = normalizeForecastQuery(validated)
    const access = this.policy.buildAccessContext(user, organizationId)

    const result = await this.service.getSummary(organizationId, query as any, access)
    return ctx.response.ok({ data: result })
  }

  // ── Demand Curves ────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/demand-curves */
  async demandCurves(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastDemandCurvesValidator.validate(qs)
    const query = normalizeForecastQuery(validated)
    const access = this.policy.buildAccessContext(user, organizationId)

    const result = await this.service.getDemandCurves(organizationId, query as any, access)
    return ctx.response.ok({ data: result })
  }

  // ── Gap Analysis ────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/gap-analysis */
  async gapAnalysis(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastGapAnalysisValidator.validate(qs)
    const query = normalizeForecastQuery(validated)
    const access = this.policy.buildAccessContext(user, organizationId)

    const result = await this.service.getGapAnalysis(organizationId, query as any, access)
    return ctx.response.ok({ data: result })
  }

  // ── Project Drivers ──────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/project-drivers */
  async projectDrivers(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastProjectDriversValidator.validate(qs)
    const query = normalizeForecastQuery(validated)
    const access = this.policy.buildAccessContext(user, organizationId)

    const result = await this.service.getProjectDrivers(organizationId, query as any, access)

    const page = (query as any).page ?? 1
    const perPage = (query as any).perPage ?? 50
    const start = (page - 1) * perPage
    const paged = result.slice(start, start + perPage)

    return ctx.response.ok({
      data: paged,
      meta: this.computeMeta(result.length, query as any),
    })
  }

  // ── Skill Drivers ────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/skill-drivers */
  async skillDrivers(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastSkillDriversValidator.validate(qs)
    const query = normalizeForecastQuery(validated)
    const access = this.policy.buildAccessContext(user, organizationId)

    const result = await this.service.getSkillDrivers(organizationId, query as any, access)

    const page = (query as any).page ?? 1
    const perPage = (query as any).perPage ?? 50
    const start = (page - 1) * perPage
    const paged = result.slice(start, start + perPage)

    return ctx.response.ok({
      data: paged,
      meta: this.computeMeta(result.length, query as any),
    })
  }

  // ── Trend Baseline ───────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/trend-baseline */
  async trendBaseline(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastTrendBaselineValidator.validate(qs)
    const query = normalizeForecastQuery(validated)
    const access = this.policy.buildAccessContext(user, organizationId)

    const result = await this.service.getTrendBaseline(organizationId, query as any, access)
    return ctx.response.ok({ data: result })
  }

  // ── Drill-Down ──────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/drill-down */
  async drillDown(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    const qs = ctx.request.qs() as Record<string, unknown>
    const validated = await forecastDrillDownValidator.validate(qs)

    const access = this.policy.buildAccessContext(user, organizationId)

    // drill-down 必须重新授权目标
    await this.policy.authorizeDrillDown(
      user,
      organizationId,
      (validated as any).targetType,
      (validated as any).targetId,
    )

    const result = await this.service.getDrillDown(organizationId, validated as any, access)
    return ctx.response.ok({ data: result })
  }

  // ── AI Advisory ──────────────────────────────────────────────────────────

  /** GET /api/v1/organizations/:organizationId/resource-demand-forecasting/ai-advisory */
  async aiAdvisory(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = await this.resolveOrganizationId(ctx)
    if (ctx.response.getStatus() >= 400) return

    await this.policy.authorizeForecastRead(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    await forecastAiAdvisoryValidator.validate(qs)

    const query = normalizeForecastQuery({
      startDate: qs.startDate ?? new Date().toISOString().slice(0, 10),
      endDate:
        qs.endDate ?? new Date(Date.now() + 12 * 7 * 86400 * 1000).toISOString().slice(0, 10),
      granularity: qs.granularity ?? 'week',
    })
    const access = this.policy.buildAccessContext(user, organizationId)

    // 获取预测摘要用于构建低敏 advisory 输入
    const summary = await this.service.getSummary(organizationId, query as any, access)
    const gapAnalysis = await this.service.getGapAnalysis(organizationId, query as any, access)

    // 构建低敏输入
    const metricsText = Object.entries(summary.metrics)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ')

    const advisor = this.getAiAdvisor()
    const result = await advisor.generateAdvisory(organizationId, {
      summaryText:
        `预测窗口 ${summary.window.startDate} ~ ${summary.window.endDate}，` +
        `粒度 ${summary.window.granularity}，` +
        `置信度 ${summary.overallConfidence}，` +
        `指标：${metricsText}`,
      topGaps: gapAnalysis.gaps.slice(0, 10).map((g) => ({
        role: g.role,
        skill: g.skill,
        gapHours: g.gapHours,
      })),
    })

    // 低敏审计
    try {
      const { default: AuditService } = await import('#services/audit_service')
      const auditService = new AuditService()
      const payload = buildForecastAiAdvisoryAuditPayload(
        user,
        organizationId,
        result.model,
        result.warnings.length === 0 ? 'success' : 'degraded',
        summary.freshness.freshnessHash,
      )
      await auditService.log({
        event: ResourceDemandForecastingAuditEvent.FORECAST_AI_ADVISORY,
        severity: 'info',
        userId: payload.actorId,
        organizationId: payload.organizationId,
        metadata: payload as unknown as Record<string, unknown>,
      })
    } catch {
      // 审计失败不影响响应
    }

    return ctx.response.ok({ data: result })
  }
}
