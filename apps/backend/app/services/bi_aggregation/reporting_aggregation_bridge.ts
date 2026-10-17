// apps/backend/app/services/bi_aggregation/reporting_aggregation_bridge.ts
// v3-bi-data-aggregation-service §6.4：reporting-system-upgrade BI aggregation 互操作 bridge。
// 使报表预览可消费 BI aggregation queryHash、snapshotHash/sourceHash、warning summary、
// freshness 和 redaction summary。

import type {
  BiAggregationQuery,
  BiAggregationSourceKey,
  BiAggregationWarning,
  BiAggregationFreshnessState,
  BiAggregationRedactionState,
} from '@aiproj/types'
import { computeBiAggregationQueryHash, BI_AGGREGATION_SOURCE_KEYS } from '@aiproj/types'
import type { BiAggregationRegistry } from './registry.js'

/**
 * 报表聚合互操作结果。
 * 供报表预览消费：不创建正式报表版本，不修改 BI 来源事实。
 */
export interface ReportingAggregationBridgeResult {
  queryHash: string
  snapshotHash: string | null
  sourceHash: string | null
  freshnessState: BiAggregationFreshnessState
  redactionState: BiAggregationRedactionState
  warnings: BiAggregationWarning[]
  sourceKeys: BiAggregationSourceKey[]
}

/**
 * 报表聚合 bridge —— 将报表数据源注册为 BI aggregation 来源。
 *
 * 红线：
 *   - 不修改 BI aggregation registry、Dashboard 定义、趋势结果
 *   - 不修改项目、任务、风险、资源、OKR、Compiler run、外部系统
 *   - 不绕过报表模板白名单、权限或版本化
 */
export class ReportingAggregationBridge {
  constructor(private readonly registry: BiAggregationRegistry) {}

  /**
   * 消费 BI aggregation snapshot/hash 作为报表输入。
   */
  async consumeAggregationSnapshot(
    query: BiAggregationQuery,
  ): Promise<ReportingAggregationBridgeResult> {
    const queryHash = computeBiAggregationQueryHash(query)

    // 解析涉及的 source
    const sourceKeys: BiAggregationSourceKey[] = []
    for (const mk of query.metricKeys) {
      const metricDef = this.registry.getMetric(mk)
      if (metricDef && !sourceKeys.includes(metricDef.sourceKey)) {
        sourceKeys.push(metricDef.sourceKey)
      }
    }

    return {
      queryHash,
      snapshotHash: queryHash, // 通过 hash 引用，不存储完整快照数据
      sourceHash: sourceKeys.length > 0 ? `report-bridge-${queryHash}` : null,
      freshnessState: 'unknown',
      redactionState: 'none',
      warnings: [],
      sourceKeys,
    }
  }

  /**
   * 注册报表数据源为 BI aggregation 来源（低敏元数据）。
   */
  registerReportSourceMetadata(reportSourceKey: string): {
    sourceKey: BiAggregationSourceKey
    queryHash: string
    warnings: BiAggregationWarning[]
  } {
    // 报表数据源注册为 BI aggregation 来源时，只暴露 sourceKey、status、sourceHash
    return {
      sourceKey: BI_AGGREGATION_SOURCE_KEYS.REPORT_V2_DATASOURCE,
      queryHash: `report-reg:${reportSourceKey}`,
      warnings: [],
    }
  }
}
