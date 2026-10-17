import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import BiRiskHeatmapPolicy from '#policies/bi_risk_heatmap_policy'
import BiRiskHeatmapService from '#services/bi_risk_heatmap_service'
import {
  biRiskHeatmapParamsValidator,
  biRiskHeatmapQueryValidator,
  normalizeBiRiskHeatmapQuery,
} from '#validators/bi_risk_heatmap'
import {
  BI_RISK_HEATMAP_DEFAULT_WINDOW,
  BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION,
  BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION,
  BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
  BI_RISK_HEATMAP_COMPARE_MODES,
  BI_RISK_HEATMAP_SORT_KEYS,
  type BiRiskHeatmapQuery,
  type BiRiskHeatmapMetricKey,
  type BiRiskHeatmapWindow,
  type BiRiskHeatmapDimensionKey,
  type BiRiskHeatmapCompareMode,
  type BiRiskHeatmapSortKey,
} from '@aiproj/types'

/**
 * BI 风险热力图控制器（v3-bi-risk-heatmap §3.7）。
 *
 * GET /api/v1/organizations/:organizationId/bi/risk-heatmap
 * 只读端点：返回白名单验证后的风险热力图聚合结果。
 * 无副作用：不调 AIGateway、不启动 Compiler、不修改任何业务事实。
 */
@inject()
export default class BiRiskHeatmapController {
  constructor(
    private readonly policy: BiRiskHeatmapPolicy,
    private readonly service: BiRiskHeatmapService,
  ) {}

  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await biRiskHeatmapParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const normalized = normalizeBiRiskHeatmapQuery(qs)
    const validated = await biRiskHeatmapQueryValidator.validate(normalized)

    const query: BiRiskHeatmapQuery = {
      metricKey: validated.metricKey as BiRiskHeatmapMetricKey,
      window: (validated.window as BiRiskHeatmapWindow) ?? BI_RISK_HEATMAP_DEFAULT_WINDOW,
      rowDimension:
        (validated.rowDimension as BiRiskHeatmapDimensionKey) ??
        BI_RISK_HEATMAP_DEFAULT_ROW_DIMENSION,
      columnDimension:
        (validated.columnDimension as BiRiskHeatmapDimensionKey) ??
        BI_RISK_HEATMAP_DEFAULT_COLUMN_DIMENSION,
      filters: {
        projectIds: validated.projectIds
          ? (validated.projectIds as number[]).map(String)
          : undefined,
        departments: (validated.departments as string[]) ?? undefined,
        portfolioGroups: (validated.portfolioGroups as string[]) ?? undefined,
        riskCategories: (validated.riskCategories as string[]) ?? undefined,
        riskLevels: (validated.riskLevels as any[]) ?? undefined,
        riskStatuses: (validated.riskStatuses as string[]) ?? undefined,
        assigneeIds: validated.assigneeIds
          ? (validated.assigneeIds as number[]).map(String)
          : undefined,
      },
      compareWith:
        (validated.compareWith as BiRiskHeatmapCompareMode) ??
        BI_RISK_HEATMAP_COMPARE_MODES.PREVIOUS_PERIOD,
      sort: (validated.sort as BiRiskHeatmapSortKey) ?? BI_RISK_HEATMAP_SORT_KEYS.SCORE,
      sortDir: (validated.sortDir as string as 'asc' | 'desc') ?? 'desc',
      page: (validated.page as number) ?? 1,
      perPage: (validated.perPage as number) ?? BI_RISK_HEATMAP_DEFAULT_PER_PAGE,
    }

    const result = await this.service.getHeatmap(organizationId, user, query)

    return ctx.response.ok({
      data: result.data,
      meta: result.meta,
      warnings: result.warnings,
    })
  }
}
