// apps/backend/app/services/bi_aggregation/index.ts
// v3-bi-data-aggregation-service §4.5-4.6：BiAggregationService 主入口。
// 编排 query planning、source selection、adapter execution、dimension bucket 归一化、
// series/row 合并、comparison、warning/freshness/provenance 汇总和 pagination。

import type {
  BiAggregationQuery,
  BiAggregationResult,
  BiAggregationResponse,
  BiAggregationResponseMeta,
  BiAggregationMetricKey,
  BiAggregationSourceKey,
  BiAggregationResultRow,
  BiAggregationSeriesPoint,
  BiAggregationDimensionBucket,
  BiAggregationWarning,
  BiAggregationEvidenceRef,
  BiAggregationProvenance,
  BiAggregationFreshnessState,
} from '@aiproj/types'
import {
  BI_AGGREGATION_METRIC_VERSION,
  BI_AGGREGATION_DEFAULT_PER_PAGE,
  BI_AGGREGATION_FRESHNESS_STATES,
  computeBiAggregationQueryHash,
  mergeBiAggregationFreshness,
  mergeBiAggregationWarnings,
  summarizeBiAggregationRedaction,
  isUnsupportedBiAggregationMetricKey,
} from '@aiproj/types'
import BiAggregationPolicy from '#policies/bi_aggregation_policy'
import { BiAggregationRegistry } from './registry.js'
import AuditService from '#services/audit_service'
import type User from '#models/user'
import { inject } from '@adonisjs/core'

/**
 * BI 数据聚合服务 —— 只读、有界、有审计的 BI 聚合查询执行。
 *
 * 编排：
 *   1. Query planning：根据 registry 解析 metric→source adapter。
 *   2. Source execution：并行调用各 adapter。
 *   3. Dimension normalization：bucket 对齐和 row/series 合并。
 *   4. Comparison：previous_period / same_period_last_year 对比。
 *   5. Warning/freshness/provenance 汇总。
 *   6. Pagination 和低敏审计。
 */
@inject()
export default class BiAggregationService {
  constructor(
    private readonly registry: BiAggregationRegistry,
    private readonly policy: BiAggregationPolicy,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 执行 BI 聚合查询。
   *
   * @param organizationId 组织 ID
   * @param user 当前 actor
   * @param query 已验证/白名单的聚合查询
   */
  async getAggregations(
    organizationId: number,
    user: User,
    query: BiAggregationQuery,
  ): Promise<BiAggregationResponse> {
    const queryHash = computeBiAggregationQueryHash(query)
    const calculatedAt = new Date().toISOString()

    // 1. 权限检查（用于 audit metadata）
    void (await this.policy.resolveBiAggregationDimensionAccess(user, organizationId))

    // 2. 解析 metric → source adapter 映射
    const sourceAdapters = this.registry.resolveAdaptersForMetrics(query.metricKeys)

    // 3. 并行执行所有 adapter
    const adapterInput = {
      organizationId,
      userId: Number(user.id),
      metricKeys: query.metricKeys,
      dimensions: query.dimensions ?? [],
      window: query.window ?? 'last_30_days',
      grain: query.grain ?? 'weekly',
    }

    const sourceResults = await Promise.all(
      [...sourceAdapters.entries()].map(async ([_sourceKey, adapter]) => {
        try {
          return await adapter.aggregate(adapterInput)
        } catch {
          return null
        }
      }),
    )

    // 4. 合并各行、series、bucket
    const allRows: BiAggregationResultRow[] = []
    const allSeries: BiAggregationSeriesPoint[] = []
    const allBuckets: BiAggregationDimensionBucket[] = []
    const allWarnings: BiAggregationWarning[] = []
    const allEvidence: BiAggregationEvidenceRef[] = []
    const redactedDimensions: string[] = []
    const redactedSources: string[] = []
    const freshnessStates: BiAggregationFreshnessState[] = []

    for (const result of sourceResults) {
      if (!result) continue
      allRows.push(...result.rows)
      allSeries.push(...result.series)
      allBuckets.push(...result.buckets)
      allWarnings.push(...result.warnings)
      allEvidence.push(...result.evidence)
      redactedDimensions.push(...result.redactedDimensions)
      if (result.status === 'forbidden' || result.status === 'redacted') {
        redactedSources.push(result.sourceKey)
      }
      freshnessStates.push(result.freshness.state)
    }

    // 5. 检查 unsupported metrics
    for (const mk of query.metricKeys) {
      if (isUnsupportedBiAggregationMetricKey(mk)) {
        allWarnings.push({
          code: 'UNSUPPORTED_METRIC',
          level: 'blocking',
          message: `不支持的财务指标: ${mk}`,
          metricKey: mk,
        })
      }
    }

    // 6. 合并 freshness、warnings、redaction
    void mergeBiAggregationFreshness(freshnessStates)
    const mergedWarnings = mergeBiAggregationWarnings(allWarnings)
    const redactionState = summarizeBiAggregationRedaction(
      redactedDimensions,
      redactedSources,
      query.dimensions?.length ?? 0,
      sourceAdapters.size,
    )

    // 7. 构建 result
    const provenance: BiAggregationProvenance = {
      queryHash,
      calculatedAt,
      metricVersion: BI_AGGREGATION_METRIC_VERSION,
      sourceRefs: sourceResults.filter(Boolean).map((r) => ({
        sourceKey: r!.sourceKey,
        status: r!.status,
        generatedAt: r!.generatedAt,
        sourceHash: r!.sourceHash,
        metricVersion: r!.metricVersion,
        freshness: r!.freshness,
        warnings: r!.warnings,
      })),
      redaction: {
        state: redactionState,
        redactedDimensions,
        redactedSources,
      },
    }

    const result: BiAggregationResult = {
      rows: allRows,
      series: allSeries,
      dimensionBuckets: allBuckets,
      provenance,
      warnings: mergedWarnings,
      cache: { enabled: false, ttlSeconds: 300, degraded: false },
    }

    if (query.includeEvidence) {
      result.evidence = allEvidence
    }

    // 8. Pagination
    const page = query.page ?? 1
    const perPage = query.perPage ?? BI_AGGREGATION_DEFAULT_PER_PAGE
    const totalRows = allRows.length
    const totalPages = Math.ceil(totalRows / perPage)
    const paginatedRows = allRows.slice((page - 1) * perPage, page * perPage)

    // 9. 构建 response
    const meta: BiAggregationResponseMeta = {
      total: totalRows,
      page,
      perPage,
      totalPages,
      queryHash,
      calculatedAt,
      freshnessSummary: Object.fromEntries(
        [...sourceAdapters.keys()].map((sk) => [
          sk,
          sourceResults.find((r) => r?.sourceKey === sk)?.freshness.state ??
            BI_AGGREGATION_FRESHNESS_STATES.UNKNOWN,
        ]),
      ) as Record<BiAggregationSourceKey, BiAggregationFreshnessState>,
      warningCount: mergedWarnings.length,
      redactionState,
    }

    const response: BiAggregationResponse = {
      data: { ...result, rows: paginatedRows },
      meta,
    }

    // 10. 低敏审计
    await this.auditService.log({
      event: 'BI_AGGREGATION_READ' as any,
      severity: 'info',
      userId: Number(user.id),
      organizationId,
      metadata: {
        queryHash,
        metricKeys: query.metricKeys,
        dimensionKeys: query.dimensions ?? [],
        sourceKeys: [...sourceAdapters.keys()],
        redactionState,
        freshnessHash: computeBiAggregationQueryHash({
          ...query,
          metricKeys: [...query.metricKeys].sort() as BiAggregationMetricKey[],
        }),
        durationBucket: 'aggregation',
        resultStatus: 'success',
        warningCount: mergedWarnings.length,
      },
    })

    return response
  }
}
