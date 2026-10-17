/**
 * v3-unified-ai-output-quality-ledger §6 —— 只读聚合与阈值健康状态。
 *
 * 核心纪律：
 * - 只读聚合：按组织、能力面、检查项、校验器版本、时间窗；
 * - 阈值越界只产生健康状态，禁止自动修复策略变更、prompt 回滚或任何业务动作；
 * - 自动修复有效性聚合（修复率与修后失败率）；
 * - 记账失败降级：不得回滚业务事件、不得改变终态。
 */

import type {
  QualityCheckResult,
  QualitySanitizedReportEntry,
  QualityAggregationResult,
  QualityAggregationBucket,
  QualityThresholdDeclaration,
  QualityHealthIndicator,
  QualityValidationRecord,
} from '@aiproj/types'
import {
  aggregateQualityRecords,
  evaluateQualityHealth,
  DEFAULT_QUALITY_THRESHOLDS,
  groupRecordsByValidatorVersion,
} from '@aiproj/types'
import QualityValidationResult from '#models/quality_validation_result'

export interface QualityHealthSummary {
  /** 各检查项的健康状态。 */
  indicators: QualityHealthIndicator[]
  /** 整体健康状态（取最差）。 */
  overallState: 'healthy' | 'warning' | 'critical' | 'unknown'
}

export class QualityAggregationService {
  /**
   * 只读聚合：按维度聚合命中率与趋势。
   * 全部读路径附加 organization_id 过滤（组织隔离）。
   */
  async aggregate(
    organizationId: number,
    dimension:
      'organization' | 'capability_surface' | 'check_id' | 'validator_version' | 'time_window',
    windowStartIso: string,
    windowEndIso: string,
  ): Promise<QualityAggregationResult> {
    const records = await this.fetchRecordsInWindow(organizationId, windowStartIso, windowEndIso)
    return aggregateQualityRecords(records, dimension, {
      startIso: windowStartIso,
      endIso: windowEndIso,
    })
  }

  /**
   * 自动修复有效性聚合。
   */
  async aggregateRepairEffectiveness(
    organizationId: number,
    windowStartIso: string,
    windowEndIso: string,
  ): Promise<{
    totalAttempts: number
    totalSuccesses: number
    repairRate: number | null
    stillFailingCount: number
  }> {
    const records = await this.fetchRecordsInWindow(organizationId, windowStartIso, windowEndIso)
    let totalAttempts = 0
    let totalSuccesses = 0
    let stillFailingCount = 0

    for (const record of records) {
      if (record.autoFixTrace) {
        totalAttempts += record.autoFixTrace.attemptedCount
        totalSuccesses += record.autoFixTrace.successCount
        if (record.autoFixTrace.stillFailingAfterFix) {
          stillFailingCount++
        }
      }
    }

    return {
      totalAttempts,
      totalSuccesses,
      repairRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : null,
      stillFailingCount,
    }
  }

  /**
   * 阈值判定与健康状态产出。
   * 只产健康状态，禁止任何自动动作。
   */
  async evaluateHealth(
    organizationId: number,
    thresholds: QualityThresholdDeclaration[] = DEFAULT_QUALITY_THRESHOLDS,
    windowDays: number = 30,
  ): Promise<QualityHealthSummary> {
    const now = new Date()
    const windowStartIso = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    const windowEndIso = now.toISOString()

    const records = await this.fetchRecordsInWindow(organizationId, windowStartIso, windowEndIso)

    if (records.length === 0) {
      return {
        indicators: thresholds.map((t) => ({
          state: 'unknown' as const,
          reasonCode: 'no_data' as const,
          runbookRef: t.runbookRef,
          triggeredCheckId: t.checkId,
        })),
        overallState: 'unknown',
      }
    }

    // 计算全局命中率
    const totalRecords = records.length
    const hitRecords = records.filter((r) => r.hitCheckIds.length > 0).length
    const globalHitRate = hitRecords / totalRecords

    const indicators = thresholds.map((threshold) => {
      if (threshold.checkId) {
        // 按检查项计算命中率
        const checkRecords = records.filter((r) =>
          r.checkResults.some((c) => c.checkId === threshold.checkId),
        )
        const checkHits = checkRecords.filter((r) =>
          r.checkResults.some((c) => c.checkId === threshold.checkId && c.hit),
        ).length
        const checkRate = checkRecords.length > 0 ? checkHits / checkRecords.length : null
        return evaluateQualityHealth(checkRate, threshold)
      }
      return evaluateQualityHealth(globalHitRate, threshold)
    })

    // 整体状态取最差
    const stateOrder = { critical: 3, warning: 2, unknown: 1, healthy: 0 }
    const overallState = indicators.reduce(
      (worst, ind) => (stateOrder[ind.state] > stateOrder[worst] ? ind.state : worst),
      'healthy' as QualityHealthIndicator['state'],
    )

    return { indicators, overallState }
  }

  /**
   * 按校验器版本分组的趋势查询。
   */
  async trendsByVersion(
    organizationId: number,
    windowStartIso: string,
    windowEndIso: string,
  ): Promise<Map<string, QualityAggregationBucket[]>> {
    const records = await this.fetchRecordsInWindow(organizationId, windowStartIso, windowEndIso)
    const groups = groupRecordsByValidatorVersion(records)
    const result = new Map<string, QualityAggregationBucket[]>()

    for (const [version, versionRecords] of groups) {
      const agg = aggregateQualityRecords(versionRecords, 'check_id', {
        startIso: windowStartIso,
        endIso: windowEndIso,
      })
      result.set(version, agg.buckets)
    }

    return result
  }

  /**
   * 从数据库获取时间窗口内的记录（只读）。
   */
  private async fetchRecordsInWindow(
    organizationId: number,
    windowStartIso: string,
    windowEndIso: string,
  ): Promise<QualityValidationRecord[]> {
    const rows = await QualityValidationResult.query()
      .where('organization_id', organizationId)
      .where('created_at', '>=', windowStartIso)
      .where('created_at', '<=', windowEndIso)
      .orderBy('created_at', 'desc')

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      artifactRef: row.artifactRef,
      capabilitySurface: row.capabilitySurface as QualityValidationRecord['capabilitySurface'],
      validatorCategory: row.validatorCategory as QualityValidationRecord['validatorCategory'],
      validatorVersion: row.validatorVersion,
      checkResults: (row.checkResults ?? []).map((check) => ({
        ...check,
        severity: check.severity as QualityCheckResult['severity'],
      })),
      hitCheckIds: row.hitCheckIds,
      confidenceScore: row.confidenceScore,
      overallRiskLevel: row.overallRiskLevel as QualityValidationRecord['overallRiskLevel'],
      canConfirm: row.canConfirm,
      autoFixTrace: row.autoFixTrace,
      sanitizedReport: (row.sanitizedReport ?? []).map((entry) => ({
        ...entry,
        severity: entry.severity as QualitySanitizedReportEntry['severity'],
      })),
      idempotencyKey: row.idempotencyKey,
      createdAt: row.createdAt?.toISO() ?? new Date().toISOString(),
    }))
  }
}

export const qualityAggregationService = new QualityAggregationService()
