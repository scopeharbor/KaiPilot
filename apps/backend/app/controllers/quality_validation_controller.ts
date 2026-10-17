/**
 * v3-unified-ai-output-quality-ledger §6.3 —— 只读质量聚合端点。
 *
 * 挂 auth、Policy、validator、分页与统一 envelope。
 * 全部读路径附加 organization_id 过滤（组织隔离）。
 */

import type { HttpContext } from '@adonisjs/core/http'
import { qualityAggregationService } from '#services/quality_ledger/quality_aggregation_service'
import { qualityProjectionService } from '#services/quality_ledger/quality_projection_service'
import QualityValidationPolicy from '#policies/quality_validation_policy'

export default class QualityValidationController {
  readonly #policy = new QualityValidationPolicy()

  /**
   * GET /api/v1/quality/aggregate
   * 只读聚合：按维度聚合命中率与趋势。
   */
  async aggregate(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const dimension = ctx.request.input('dimension', 'capability_surface') as any
    const windowStart = ctx.request.input(
      'windowStart',
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    )
    const windowEnd = ctx.request.input('windowEnd', new Date().toISOString())

    const result = await qualityAggregationService.aggregate(
      Number(organizationId),
      dimension,
      windowStart,
      windowEnd,
    )

    return ctx.response.ok({ data: result })
  }

  /**
   * GET /api/v1/quality/health
   * 健康状态查询（阈值判定，只产健康状态，禁止任何自动动作）。
   */
  async health(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const windowDays = Number(ctx.request.input('windowDays', 30))

    const result = await qualityAggregationService.evaluateHealth(
      Number(organizationId),
      undefined,
      windowDays,
    )

    return ctx.response.ok({ data: result })
  }

  /**
   * GET /api/v1/quality/repair-effectiveness
   * 自动修复有效性聚合。
   */
  async repairEffectiveness(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const windowStart = ctx.request.input(
      'windowStart',
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    )
    const windowEnd = ctx.request.input('windowEnd', new Date().toISOString())

    const result = await qualityAggregationService.aggregateRepairEffectiveness(
      Number(organizationId),
      windowStart,
      windowEnd,
    )

    return ctx.response.ok({ data: result })
  }

  /**
   * GET /api/v1/quality/trends
   * 按校验器版本分组的趋势查询。
   */
  async trends(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const windowStart = ctx.request.input(
      'windowStart',
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    )
    const windowEnd = ctx.request.input('windowEnd', new Date().toISOString())

    const result = await qualityAggregationService.trendsByVersion(
      Number(organizationId),
      windowStart,
      windowEnd,
    )

    // Map 转换为可序列化对象
    const data: Record<string, any[]> = {}
    for (const [version, buckets] of result) {
      data[version] = buckets
    }

    return ctx.response.ok({ data })
  }

  /**
   * GET /api/v1/quality/projections
   * 既有草案校验的只读投影。
   */
  async projections(ctx: HttpContext) {
    const organizationId = ctx.tenant?.organizationId
    if (organizationId === null || organizationId === undefined) {
      return ctx.response.unauthorized({
        error: { code: 'AUTH_REQUIRED', message: '缺少组织上下文' },
      })
    }

    await this.#policy.view(ctx)

    const limit = Math.min(1000, Math.max(1, Number(ctx.request.input('limit', 100))))

    const projections = await qualityProjectionService.projectDraftValidations(
      Number(organizationId),
      limit,
    )

    return ctx.response.ok({ data: projections })
  }
}
