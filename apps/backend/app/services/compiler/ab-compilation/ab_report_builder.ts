/**
 * CompilerAbReportBuilder —— Compiler A/B report builder（§2.5）。
 *
 * 从 fixture runner results 构建低敏 A/B report：
 * - quality / safety / cost / latency / stability 五维 metric group
 * - winner policy 决策
 * - go/no-go summary
 *
 * 遵循 design D4（五类 metric）和 D5（review-only summary）。
 */

import type {
  CompilerAbReport,
  CompilerAbExperimentConfig,
  CompilerAbMetricSnapshot,
  CompilerAbWinnerDecision,
  CompilerAbGoNoGoDecision,
  CompilerAbWinnerResult,
} from '@aiproj/types'
import type { CompilerAbFixtureResult } from './ab_fixture_runner.js'

export class CompilerAbReportBuilder {
  /**
   * 从 runner results 构建完整 report。
   */
  build(config: CompilerAbExperimentConfig, results: CompilerAbFixtureResult[]): CompilerAbReport {
    // 1. 按 variant 分组 metric snapshots
    const byVariant = this.groupByVariant(results)

    // 2. 聚合每个 variant 的 metrics
    const variantMetrics = this.aggregateMetrics(byVariant)

    // 3. Winner decision
    const winnerDecision = this.computeWinnerDecision(config, variantMetrics, byVariant)

    // 4. Go/no-go decision
    const goNoGoDecision = this.computeGoNoGoDecision(config, variantMetrics, winnerDecision)

    const isFixture = config.authorization.mode === 'fixture'

    return {
      contractVersion: config.contractVersion,
      experimentId: config.experimentId,
      organizationId: config.organizationId,
      createdAt: new Date().toISOString(),
      variantMetrics,
      winnerDecision,
      goNoGoDecision,
      isFixture,
      evidenceEligible: !isFixture,
      summary: this.buildSummary(config.objective, results.length, winnerDecision, goNoGoDecision),
      evidenceRefs: results.flatMap((r) => r.fixtureEvidence),
    }
  }

  private groupByVariant(
    results: CompilerAbFixtureResult[],
  ): Map<string, CompilerAbFixtureResult[]> {
    const map = new Map<string, CompilerAbFixtureResult[]>()
    for (const result of results) {
      const existing = map.get(result.variantId) ?? []
      existing.push(result)
      map.set(result.variantId, existing)
    }
    return map
  }

  private aggregateMetrics(
    byVariant: Map<string, CompilerAbFixtureResult[]>,
  ): CompilerAbMetricSnapshot[] {
    const snapshots: CompilerAbMetricSnapshot[] = []

    for (const [variantId, results] of byVariant) {
      if (results.length === 0) continue

      const avgQuality = {
        schemaValidRate: this.average(results.map((r) => r.metrics.quality.schemaValidRate)),
        candidateBundleSafetyPassRate: this.average(
          results.map((r) => r.metrics.quality.candidateBundleSafetyPassRate),
        ),
        hallucinationViolationCount: Math.round(
          this.average(results.map((r) => r.metrics.quality.hallucinationViolationCount)),
        ),
        ruleViolationCount: Math.round(
          this.average(results.map((r) => r.metrics.quality.ruleViolationCount)),
        ),
      }

      const anyHasRisk = results.some((r) => r.metrics.safety.noReviewWritebackRisk)
      const anySecretExposure = results.some((r) => r.metrics.safety.secretExposureDetected)
      const avgSafety = {
        ruleViolationCount: Math.round(
          this.average(results.map((r) => r.metrics.safety.ruleViolationCount)),
        ),
        noReviewWritebackRisk: anyHasRisk,
        secretExposureDetected: anySecretExposure,
      }

      const avgCost = {
        estimatedTokenCount: Math.round(
          this.average(results.map((r) => r.metrics.cost.estimatedTokenCount)),
        ),
        estimatedCostUsd: this.average(results.map((r) => r.metrics.cost.estimatedCostUsd)),
        realModelCallCount: 0,
        currency: 'USD',
      }

      const avgLatency = {
        totalDurationMs: Math.round(
          this.average(results.map((r) => r.metrics.latency.totalDurationMs)),
        ),
        perStageDurationMs: {},
        latencyBuckets: { 'fixture-only': results.length },
      }

      const avgStability = {
        stageFailureCount: Math.round(
          this.average(results.map((r) => r.metrics.stability.stageFailureCount)),
        ),
        totalRetryCount: Math.round(
          this.average(results.map((r) => r.metrics.stability.totalRetryCount)),
        ),
        deterministicDiffSummary: results[0]?.metrics.stability.deterministicDiffSummary,
      }

      // 综合评分（简单加权平均）
      const compositeScore =
        avgQuality.schemaValidRate * 0.25 +
        avgQuality.candidateBundleSafetyPassRate * 0.25 +
        (1 - avgSafety.ruleViolationCount / 10) * 0.15 +
        (1 - avgStability.stageFailureCount / 10) * 0.15 +
        (1 - avgStability.totalRetryCount / 10) * 0.1 +
        0.1 * (avgCost.realModelCallCount === 0 ? 1 : 0.5)

      snapshots.push({
        variantId,
        quality: avgQuality,
        safety: avgSafety,
        cost: avgCost,
        latency: avgLatency,
        stability: avgStability,
        compositeScore: Math.round(compositeScore * 100) / 100,
      })
    }

    return snapshots
  }

  private computeWinnerDecision(
    config: CompilerAbExperimentConfig,
    variantMetrics: CompilerAbMetricSnapshot[],
    _byVariant: Map<string, CompilerAbFixtureResult[]>,
  ): CompilerAbWinnerDecision {
    if (variantMetrics.length < 2) {
      return {
        policyId: config.winnerPolicy.policyId,
        result: 'no_winner',
        reasonCode: 'INSUFFICIENT_VARIANTS',
        reasonSummary: 'Need at least 2 variants with metrics to determine winner',
        groupScores: {},
      }
    }

    // Check safety regression
    if (config.winnerPolicy.safetyRegressionForcesNoWinner) {
      for (const variant of variantMetrics) {
        if (variant.safety.secretExposureDetected || variant.safety.noReviewWritebackRisk) {
          return {
            policyId: config.winnerPolicy.policyId,
            result: 'no_winner',
            reasonCode: 'SAFETY_REGRESSION',
            reasonSummary: 'Safety regression detected in one or more variants',
            groupScores: this.buildGroupScores(variantMetrics),
          }
        }
      }
    }

    const [a, b] = variantMetrics
    const scoreA = a.compositeScore
    const scoreB = b.compositeScore
    const diff = Math.abs(scoreA - scoreB)

    if (diff < 0.05) {
      return {
        policyId: config.winnerPolicy.policyId,
        result: 'inconclusive',
        reasonCode: 'SCORES_TOO_CLOSE',
        reasonSummary: `Scores too close (A: ${scoreA}, B: ${scoreB}) to determine winner`,
        groupScores: this.buildGroupScores(variantMetrics),
      }
    }

    const result: CompilerAbWinnerResult =
      scoreA > scoreB ? 'variant_a_preferred' : 'variant_b_preferred'

    return {
      policyId: config.winnerPolicy.policyId,
      result,
      reasonCode: result === 'variant_a_preferred' ? 'VARIANT_A_SUPERIOR' : 'VARIANT_B_SUPERIOR',
      reasonSummary: `${result === 'variant_a_preferred' ? 'Variant A' : 'Variant B'} has higher composite score`,
      groupScores: this.buildGroupScores(variantMetrics),
      preferredVariantId: result === 'variant_a_preferred' ? a.variantId : b.variantId,
    }
  }

  private computeGoNoGoDecision(
    config: CompilerAbExperimentConfig,
    variantMetrics: CompilerAbMetricSnapshot[],
    _winnerDecision: CompilerAbWinnerDecision,
  ): CompilerAbGoNoGoDecision {
    const blockers: string[] = []
    const fixItems: string[] = []

    // Safety check
    for (const variant of variantMetrics) {
      if (variant.safety.secretExposureDetected) {
        blockers.push('Secret exposure detected')
      }
      if (variant.safety.noReviewWritebackRisk) {
        blockers.push('No-review writeback risk detected')
      }
    }

    // Quality check
    for (const variant of variantMetrics) {
      if (variant.quality.schemaValidRate < 0.8) {
        fixItems.push(`Variant ${variant.variantId}: low schema valid rate`)
      }
      if (variant.quality.candidateBundleSafetyPassRate < 1) {
        fixItems.push(`Variant ${variant.variantId}: candidate bundle safety failures`)
      }
    }

    const isFixture = config.authorization.mode === 'fixture'

    if (blockers.length > 0) {
      return {
        result: 'NO_GO',
        reasonCode: 'SAFETY_BLOCKERS',
        reasonSummary: 'Safety blockers prevent go decision',
        evidenceEligible: false,
        followUpActions: ['Resolve safety blockers before any real-model rollout'],
        blockers,
        fixItems,
      }
    }

    if (fixItems.length > 0) {
      return {
        result: 'FIX_THEN_GO',
        reasonCode: 'QUALITY_FIXES_NEEDED',
        reasonSummary: 'Quality improvements needed before go decision',
        evidenceEligible: !isFixture,
        followUpActions: [...fixItems.map((item) => `Fix: ${item}`), 'Re-run A/B after fixes'],
        blockers,
        fixItems,
      }
    }

    return {
      result: 'GO',
      reasonCode: 'ALL_METRICS_PASS',
      reasonSummary: 'All metrics passed thresholds',
      evidenceEligible: !isFixture,
      followUpActions: isFixture
        ? ['Run authorized real-model A/B smoke for evidence-eligible results']
        : ['Review report and consider follow-up changes'],
      blockers,
      fixItems,
    }
  }

  private buildGroupScores(
    variantMetrics: CompilerAbMetricSnapshot[],
  ): Record<string, Record<string, number>> {
    const scores: Record<string, Record<string, number>> = {}
    for (const v of variantMetrics) {
      scores[v.variantId] = {
        quality: v.quality.schemaValidRate,
        safety: v.safety.secretExposureDetected ? 0 : 1,
        cost: v.cost.realModelCallCount === 0 ? 1 : 0.5,
        latency: Math.min(1, 1000 / v.latency.totalDurationMs),
        stability: 1 - v.stability.stageFailureCount / 10,
      }
    }
    return scores
  }

  private buildSummary(
    objective: string,
    resultCount: number,
    winnerDecision: CompilerAbWinnerDecision,
    goNoGoDecision: CompilerAbGoNoGoDecision,
  ): string {
    return [
      `Objective: ${objective}`,
      `Results: ${resultCount} entries`,
      `Winner: ${winnerDecision.result} (${winnerDecision.reasonCode})`,
      `Go/No-Go: ${goNoGoDecision.result} (${goNoGoDecision.reasonCode})`,
      goNoGoDecision.followUpActions.length > 0
        ? `Follow-up: ${goNoGoDecision.followUpActions.join('; ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
  }
}
