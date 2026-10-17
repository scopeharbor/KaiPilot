import PortfolioDashboardService from '#services/portfolio_dashboard_service'
import PortfolioDashboardPolicy from '#policies/portfolio_dashboard_policy'
import RiskPolicy from '#policies/risk_policy'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

/**
 * PMO 组合 Dashboard Controller（v3-pmo-portfolio-dashboard §3.5）。
 *
 * 职责：HTTP 解析与响应格式化。业务逻辑在 PortfolioDashboardService。
 * 路由：/api/v1/pmo/portfolio-dashboard/*
 */
@inject()
export default class PortfolioDashboardController {
  constructor(
    private dashboard: PortfolioDashboardService,
    private policy: PortfolioDashboardPolicy,
    private riskPolicy: RiskPolicy,
  ) {}

  /** GET /api/v1/pmo/portfolio-dashboard/summary */
  async summary(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    // 维度权限探测
    const hasRiskView = await this.riskPolicy.view(user, organizationId, 0).catch(() => false)
    const hasResourceView = hasRiskView
    const hasPredictionView = hasRiskView
    const hasHealthView = hasRiskView
    const hasTrafficLight = false // traffic-light 仍在开发中

    const result = await this.dashboard.getSummary(
      organizationId,
      user,
      hasTrafficLight,
      hasRiskView,
      hasResourceView,
      hasPredictionView,
      hasHealthView,
    )
    return ctx.response.ok({ data: result })
  }

  /** GET /api/v1/pmo/portfolio-dashboard/projects */
  async projects(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const result = await this.dashboard.getProjects(
      organizationId,
      user,
      ctx.request.qs() as any,
      false, // traffic-light 仍在开发中
    )
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/pmo/portfolio-dashboard/groups */
  async groups(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const result = await this.dashboard.getGroupSlices(
      organizationId,
      user,
      ctx.request.qs() as any,
    )
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/pmo/portfolio-dashboard/trends */
  async trends(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const result = await this.dashboard.getTrends(organizationId, user, ctx.request.qs() as any)
    return ctx.response.ok({ data: result.data, meta: result.meta })
  }

  /** GET /api/v1/pmo/portfolio-dashboard/metrics/:metricKey */
  async metricDetail(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeView(user, organizationId)

    const result = await this.dashboard.getMetricDetail(organizationId, user, {
      metricKey: ctx.params.metricKey,
      ...ctx.request.qs(),
    })
    return ctx.response.ok({ data: result })
  }
}
