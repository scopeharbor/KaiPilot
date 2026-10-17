/**
 * v3-ai-automated-evaluation §7.3 — 评测评分聚合控制器。
 *
 * 只读端点：/api/v1/organizations/:organizationId/ai-evaluation-scores
 * - GET /api/v1/organizations/:organizationId/ai-evaluation-scores/aggregate — 评分分布聚合
 * - GET /api/v1/organizations/:organizationId/ai-evaluation-scores/trends — 趋势查询（按 judge 版本分组）
 *
 * 挂 auth、Policy、validator、分页与统一 envelope。
 * 组织隔离：全部读路径附加 organization_id 过滤。
 *
 * @aiproj/backend controllers
 */

import type { HttpContext } from '@adonisjs/core/http'
import { EvaluationAggregationService } from '#services/ai_evaluation/aggregation_service'
import type { EvaluationAggregationQuery, EvaluationDimension } from '@aiproj/types'
import EvaluationScorePolicy from '#policies/evaluation_score_policy'
import { evaluationScoreQueryValidator } from '#validators/evaluation_score'

export default class EvaluationScoreController {
  readonly #aggregationService = new EvaluationAggregationService()
  readonly #policy = new EvaluationScorePolicy()

  /**
   * GET /api/v1/organizations/:organizationId/ai-evaluation-scores/aggregate
   * 评分分布聚合查询。
   */
  async aggregate(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const payload = await ctx.request.validateUsing(evaluationScoreQueryValidator)

    const query: EvaluationAggregationQuery = {
      organizationId: Number(organizationId),
      groupBy: (payload.groupBy?.split(',') || ['dimension']) as any,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      dimension: payload.dimension as EvaluationDimension | undefined,
    }

    const result = this.#aggregationService.aggregate(query)

    return ctx.response.ok({
      data: result.entries,
      meta: {
        total: result.total,
        window: result.window,
        isEmptyWindow: result.isEmptyWindow,
      },
    })
  }

  /**
   * GET /api/v1/organizations/:organizationId/ai-evaluation-scores/trends
   * 趋势查询：按 judge 模型与 prompt 版本分组。
   */
  async trends(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const payload = await ctx.request.validateUsing(evaluationScoreQueryValidator)

    const query: EvaluationAggregationQuery = {
      organizationId: Number(organizationId),
      groupBy: ['judge_model', 'judge_prompt_version'],
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      dimension: payload.dimension as EvaluationDimension | undefined,
    }

    const result = this.#aggregationService.trendByJudgeVersion(query)

    return ctx.response.ok({
      data: result.entries,
      meta: {
        total: result.total,
        window: result.window,
        isEmptyWindow: result.isEmptyWindow,
      },
    })
  }
}
