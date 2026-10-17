/**
 * CompilerAbObservability —— A/B low-sensitive observability/cost summaries（§3.5）。
 *
 * 记录 experiment start/end、variant start/end、sample execution、
 * metric aggregation、budget decision、winner policy 的低敏事件。
 *
 * 遵循低敏 evidence 约束：不包含 prompt、raw model output、artifact body、
 * API key、token、secret、authorization header 或跨组织数据。
 */

import type {
  CompilerAbWinnerDecision,
  CompilerAbGoNoGoDecision,
  CompilerAbMetricSnapshot,
} from '@aiproj/types'

// ── 事件类型 ──────────────────────────────────────────────────

export type CompilerAbObservabilityEventKind =
  | 'experiment_start'
  | 'experiment_end'
  | 'variant_start'
  | 'variant_end'
  | 'sample_execution'
  | 'metric_aggregation'
  | 'budget_decision'
  | 'winner_policy'

export interface CompilerAbObservabilityEvent {
  kind: CompilerAbObservabilityEventKind
  experimentId: string
  organizationId: number
  timestamp: string
  /** 低敏 payload —— 只含 refs/hash/enums/counts/refs。 */
  payload: Record<string, unknown>
}

// ── Observability Recorder ────────────────────────────────────

export class CompilerAbObservabilityRecorder {
  private events: CompilerAbObservabilityEvent[] = []

  /**
   * 记录实验开始。
   */
  recordExperimentStart(
    experimentId: string,
    organizationId: number,
    config: {
      objective: string
      sampleSetRef: string
      variantCount: number
      authorizationMode: string
    },
  ): void {
    this.events.push({
      kind: 'experiment_start',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: {
        objective: config.objective,
        sampleSetRef: config.sampleSetRef,
        variantCount: config.variantCount,
        authorizationMode: config.authorizationMode,
      },
    })
  }

  /**
   * 记录实验结束。
   */
  recordExperimentEnd(
    experimentId: string,
    organizationId: number,
    totalEntries: number,
    successCount: number,
    failureCount: number,
  ): void {
    this.events.push({
      kind: 'experiment_end',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: {
        totalEntries,
        successCount,
        failureCount,
      },
    })
  }

  /**
   * 记录 variant 开始。
   */
  recordVariantStart(
    experimentId: string,
    organizationId: number,
    variantId: string,
    label: string,
  ): void {
    this.events.push({
      kind: 'variant_start',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: { variantId, label },
    })
  }

  /**
   * 记录 variant 结束。
   */
  recordVariantEnd(
    experimentId: string,
    organizationId: number,
    variantId: string,
    sampleCount: number,
    compositeScore: number,
  ): void {
    this.events.push({
      kind: 'variant_end',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: { variantId, sampleCount, compositeScore },
    })
  }

  /**
   * 记录 sample 执行。
   */
  recordSampleExecution(
    experimentId: string,
    organizationId: number,
    variantId: string,
    sampleId: string,
    durationMs: number,
    errorCount: number,
  ): void {
    this.events.push({
      kind: 'sample_execution',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: {
        variantId,
        sampleId,
        durationMs,
        errorCount,
      },
    })
  }

  /**
   * 记录 metric 聚合。
   */
  recordMetricAggregation(
    experimentId: string,
    organizationId: number,
    snapshots: CompilerAbMetricSnapshot[],
  ): void {
    this.events.push({
      kind: 'metric_aggregation',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: {
        variantCount: snapshots.length,
        compositeScores: snapshots.map((s) => ({
          variantId: s.variantId,
          compositeScore: s.compositeScore,
        })),
        qualityAvgs: snapshots.map((s) => ({
          variantId: s.variantId,
          schemaValidRate: s.quality.schemaValidRate,
          safetyPassRate: s.quality.candidateBundleSafetyPassRate,
        })),
      },
    })
  }

  /**
   * 记录 budget decision。
   */
  recordBudgetDecision(
    experimentId: string,
    organizationId: number,
    decision: 'hard_block' | 'soft_warning' | 'pass',
    reason: string | undefined,
  ): void {
    this.events.push({
      kind: 'budget_decision',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: { decision, reason: reason ?? '' },
    })
  }

  /**
   * 记录 winner policy。
   */
  recordWinnerPolicy(
    experimentId: string,
    organizationId: number,
    winnerDecision: CompilerAbWinnerDecision,
    goNoGoDecision: CompilerAbGoNoGoDecision,
  ): void {
    this.events.push({
      kind: 'winner_policy',
      experimentId,
      organizationId,
      timestamp: new Date().toISOString(),
      payload: {
        winnerResult: winnerDecision.result,
        winnerReasonCode: winnerDecision.reasonCode,
        goNoGoResult: goNoGoDecision.result,
        goNoGoReasonCode: goNoGoDecision.reasonCode,
        evidenceEligible: goNoGoDecision.evidenceEligible,
        followUpActionCount: goNoGoDecision.followUpActions.length,
      },
    })
  }

  /**
   * 获取所有记录的事件（用于测试或导出）。
   */
  getEvents(): readonly CompilerAbObservabilityEvent[] {
    return this.events
  }

  /**
   * 清除事件（用于测试隔离）。
   */
  clear(): void {
    this.events = []
  }
}
