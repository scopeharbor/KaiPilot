import ProjectDashboardService from '#services/project_dashboard_service'
import RecommendationPolicy from '#policies/recommendation_policy'
import RiskPolicy from '#policies/risk_policy'
import ContradictionPolicy from '#policies/contradiction_policy'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'

@inject()
export default class ProjectDashboardController {
  constructor(
    private dashboard: ProjectDashboardService,
    private riskPolicy: RiskPolicy,
    private contradictionPolicy: ContradictionPolicy,
    private recommendationPolicy: RecommendationPolicy,
  ) {}

  async show(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = ctx.tenant!.organizationId
    const projectId = Number(ctx.params.id)

    // 检查用户权限
    const hasRiskView = await this.riskPolicy
      .view(user, organizationId, projectId)
      .catch(() => false)
    const hasResourceView = hasRiskView
    const hasChangeImpactView = hasRiskView
    const hasContradictionView = await this.contradictionPolicy
      .view(user, organizationId, projectId)
      .catch(() => false)
    const hasRecommendationView = await this.recommendationPolicy
      .canView(user, organizationId)
      .catch(() => false)

    const result = await this.dashboard.get(
      organizationId,
      projectId,
      user,
      hasRiskView,
      hasResourceView,
      hasChangeImpactView,
      hasContradictionView,
      hasRecommendationView,
    )
    return ctx.response.ok({ data: result })
  }
}
