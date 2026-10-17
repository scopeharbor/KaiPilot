// apps/backend/app/controllers/bi_aggregation_controller.ts
// v3-bi-data-aggregation-service §5.1：BI aggregation 只读控制器。
//
// GET /api/v1/organizations/:organizationId/bi/aggregations
// 只做 HTTP 解析、validator 调用、policy/service 调用和 { data, meta } / { error } 响应格式化。

import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import BiAggregationPolicy from '#policies/bi_aggregation_policy'
import BiAggregationService from '#services/bi_aggregation/index'
import {
  biAggregationParamsValidator,
  biAggregationQueryValidator,
  normalizeBiAggregationQuery,
  detectUnsafeBiAggregationInput,
  checkUnsupportedBiAggregationMetrics,
} from '#validators/bi_aggregation'
import {
  type BiAggregationMetricKey,
  type BiAggregationDimensionKey,
  type BiAggregationScope,
  type BiAggregationWindow,
  type BiAggregationGrain,
  type BiAggregationCompareMode,
  type BiAggregationSortKey,
  type BiAggregationSortDir,
} from '@aiproj/types'
import AuditService from '#services/audit_service'

/**
 * BI 数据聚合控制器 —— 只读、有界。
 */
@inject()
export default class BiAggregationController {
  constructor(
    private readonly policy: BiAggregationPolicy,
    private readonly service: BiAggregationService,
    private readonly auditService: AuditService,
  ) {}

  async index(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User

    // 1. 参数验证
    const { organizationId } = await biAggregationParamsValidator.validate({
      organizationId: ctx.params.organizationId,
    })

    // 2. 组织隔离断言
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    // 3. 规范化查询参数
    const qs = ctx.request.qs() as Record<string, unknown>
    const normalized = normalizeBiAggregationQuery(qs)

    // 4. 不安全输入检测
    const unsafeFields = detectUnsafeBiAggregationInput(normalized)
    if (unsafeFields.length > 0) {
      await this.auditService.log({
        event: 'BI_AGGREGATION_VALIDATION_DENIED' as any,
        severity: 'warning',
        userId: Number(user.id),
        organizationId,
        metadata: {
          reason: 'unsafe_input_detected',
          fields: unsafeFields,
        },
      })
      return ctx.response.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '查询参数包含不安全的输入，已被拒绝',
          details: { fields: unsafeFields },
        },
      })
    }

    // 5. 校验未注册/unsupported metrics
    const unsupported = checkUnsupportedBiAggregationMetrics(
      (normalized.metricKeys as string[]) ?? [],
    )
    if (unsupported.length > 0) {
      // 不直接拒绝，让 service 返回 structured warning
    }

    // 6. 验证查询参数
    let validated: Record<string, unknown>
    try {
      validated = await biAggregationQueryValidator.validate(normalized)
    } catch (err: any) {
      await this.auditService.log({
        event: 'BI_AGGREGATION_VALIDATION_DENIED' as any,
        severity: 'warning',
        userId: Number(user.id),
        organizationId,
        metadata: {
          reason: 'validation_error',
          message: err?.message,
        },
      })
      return ctx.response.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '聚合查询参数校验失败',
          details: err?.messages ?? err?.message,
        },
      })
    }

    // 7. 构建 query 对象
    const query = {
      scope: (validated.scope as BiAggregationScope) ?? 'organization',
      metricKeys: (validated.metricKeys as BiAggregationMetricKey[]) ?? [],
      dimensions: validated.dimensions as BiAggregationDimensionKey[] | undefined,
      filters: validated.filters as any[] | undefined,
      window: validated.window as BiAggregationWindow | undefined,
      grain: validated.grain as BiAggregationGrain | undefined,
      compareWith: validated.compareWith as BiAggregationCompareMode | undefined,
      sort: validated.sort
        ? {
            key: validated.sort as BiAggregationSortKey,
            dir: (validated.sortDir as BiAggregationSortDir) ?? 'asc',
          }
        : undefined,
      page: validated.page as number | undefined,
      perPage: validated.perPage as number | undefined,
      includeSources: validated.includeSources as boolean | undefined,
      includeEvidence: validated.includeEvidence as boolean | undefined,
    }

    // 8. 调用 service
    try {
      const response = await this.service.getAggregations(organizationId, user, query)
      return ctx.response.status(200).json(response)
    } catch (err: any) {
      return ctx.response.status(500).json({
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: err?.message ?? '聚合查询执行失败',
        },
      })
    }
  }
}
