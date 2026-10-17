import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import BiTrendAnalysisPolicy from '#policies/bi_trend_analysis_policy'
import BiTrendAnalysisService from '#services/bi_trend_analysis_service'
import {
  biTrendAnalysisParamsValidator,
  biTrendAnalysisQueryValidator,
  normalizeBiTrendQuery,
} from '#validators/bi_trend_analysis'
import {
  BI_TREND_DEFAULT_WINDOW,
  BI_TREND_DEFAULT_GRAIN,
  BI_TREND_DEFAULT_PER_PAGE,
  BI_TREND_COMPARE_MODES,
  type BiTrendQuery,
  type BiTrendMetricKey,
  type BiTrendWindow,
  type BiTrendGrain,
  type BiTrendDimensionKey,
  type BiTrendCompareMode,
  type BiTrendSortKey,
} from '@aiproj/types'

/**
 * BI 趋势分析控制器（v3-bi-trend-analysis §3.7）。
 *
 * GET /api/v1/organizations/:organizationId/bi/trends
 * 只读端点：返回白名单验证后的趋势聚合结果。
 * 无副作用：不调 AIGateway、不启动 Compiler、不修改任何业务事实。
 */
@inject()
export default class BiTrendAnalysisController {
  constructor(
    private readonly policy: BiTrendAnalysisPolicy,
    private readonly service: BiTrendAnalysisService,
  ) {}

  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const { organizationId } = await biTrendAnalysisParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const qs = ctx.request.qs() as Record<string, unknown>
    const normalized = normalizeBiTrendQuery(qs)
    const validated = await biTrendAnalysisQueryValidator.validate(normalized)

    const query: BiTrendQuery = {
      metricKeys: (validated.metricKeys as BiTrendMetricKey[]) ?? undefined,
      window: (validated.window as BiTrendWindow) ?? BI_TREND_DEFAULT_WINDOW,
      grain: (validated.grain as BiTrendGrain) ?? BI_TREND_DEFAULT_GRAIN,
      dimensions: (validated.dimensions as BiTrendDimensionKey[]) ?? undefined,
      filters: {
        projectIds: validated.projectIds
          ? (validated.projectIds as number[]).map(String)
          : undefined,
        departments: (validated.departments as string[]) ?? undefined,
        roles: (validated.roles as string[]) ?? undefined,
        skills: (validated.skills as string[]) ?? undefined,
        portfolioGroups: (validated.portfolioGroups as string[]) ?? undefined,
        riskLevels: (validated.riskLevels as string[]) ?? undefined,
      },
      compareWith:
        (validated.compareWith as BiTrendCompareMode) ?? BI_TREND_COMPARE_MODES.PREVIOUS_PERIOD,
      includeAnomalies: (validated.includeAnomalies as boolean) ?? false,
      includeForecast: (validated.includeForecast as boolean) ?? false,
      sort: (validated.sort as BiTrendSortKey) ?? 'metricKey',
      sortDir: (validated.sortDir as string as 'asc' | 'desc') ?? 'asc',
      page: (validated.page as number) ?? 1,
      perPage: (validated.perPage as number) ?? BI_TREND_DEFAULT_PER_PAGE,
    }

    const result = await this.service.getTrends(organizationId, user, query)

    return ctx.response.ok({
      data: result.data,
      meta: result.meta,
      warnings: result.warnings,
    })
  }
}
