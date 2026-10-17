/**
 * @aiproj/backend —— VGateDecisionService：V-Gate 决策聚合服务。
 *
 * 聚合 hardValidationReport、softEvaluationReport、policy profile 和 stage context，
 * 输出结构化决策：blocked / awaiting_review / pass / conditional_pass。
 *
 * 决策矩阵（7.2）：
 * - Hard blocking > 0 → blocked，禁止进入 apply-ready
 * - Hard warning > threshold → awaiting_review，允许预览但要求人工确认
 * - Hard pass + Soft 达标 → pass
 * - Hard pass + Soft 低分 → conditional_pass
 * - Soft unavailable → 不产生 hard blocked（7.3）
 *
 * 输出（7.4）：allowedNextActions、requiresHumanReview、attentionAreas、blockingReasons、warnings、evidenceRefs
 */

import type {
  V2HardValidationReport,
  SoftEvaluationReport,
  VGateDecision,
} from '@aiproj/compiler-spec'
import type { VGateProfile } from '../types.js'

// ── V-Gate Service ──

export class VGateDecisionService {
  /**
   * 聚合 Hard 和 Soft 报告生成 V-Gate 决策。
   */
  async decide(
    hardReport: V2HardValidationReport,
    softReport: SoftEvaluationReport | null,
    profile: VGateProfile,
    stageId: string,
  ): Promise<VGateDecision> {
    const hardBlocking = hardReport.issues.filter((i) => i.severity === 'blocking')
    const hardWarnings = hardReport.issues.filter((i) => i.severity === 'warning')
    const hardPassed = hardBlocking.length === 0

    const softThreshold = profile.thresholdOverrides
      ? Math.min(...Object.values(profile.thresholdOverrides), 3)
      : 3
    const warningThreshold = profile.hardWarningThreshold ?? 3
    const softAvailable =
      softReport !== null &&
      softReport.status !== 'all_unavailable' &&
      softReport.status !== 'skipped'
    const softScoreMet = softAvailable && (softReport!.weightedScore ?? 0) >= softThreshold

    // ── 决策矩阵 ──

    // 7.2: Hard blocking 必须阻断
    if (hardBlocking.length > 0) {
      return this.#buildDecision(stageId, profile, 'blocked', {
        blockingReasons: hardBlocking.map((b) => `${b.ruleId}: ${b.message}`),
        requiresHumanReview: true,
        allowedNextActions: ['fix_blocking_issues', 'request_human_review'],
        hardSummary: {
          totalBlocking: hardBlocking.length,
          totalWarnings: hardWarnings.length,
          passed: false,
        },
        softSummary: softReport
          ? {
              overallScore: softReport.overallScore,
              weightedScore: softReport.weightedScore,
              dimensionsEvaluated: softReport.dimensionsEvaluated.length,
              status: softReport.status,
            }
          : undefined,
      })
    }

    // 7.2: Hard warning 超阈值需要人工确认
    if (hardWarnings.length >= warningThreshold) {
      return this.#buildDecision(stageId, profile, 'awaiting_review', {
        blockingReasons: [],
        warnings: hardWarnings.map((w) => `${w.ruleId}: ${w.message}`),
        attentionAreas: hardWarnings.map((w) => ({
          area: w.ruleId,
          description: w.message,
          severity: 'warning' as const,
        })),
        requiresHumanReview: true,
        allowedNextActions: ['review_warnings', 'proceed_to_preview', 'request_human_review'],
        hardSummary: { totalBlocking: 0, totalWarnings: hardWarnings.length, passed: true },
        softSummary: softReport
          ? {
              overallScore: softReport.overallScore,
              weightedScore: softReport.weightedScore,
              dimensionsEvaluated: softReport.dimensionsEvaluated.length,
              status: softReport.status,
            }
          : undefined,
      })
    }

    // Hard pass
    if (hardPassed) {
      // 7.2: Hard pass + Soft 达标 → pass
      if (softAvailable && softScoreMet) {
        return this.#buildDecision(stageId, profile, 'pass', {
          blockingReasons: [],
          warnings: [],
          attentionAreas: this.#getSoftAttentionAreas(softReport),
          requiresHumanReview: false,
          allowedNextActions: ['proceed_to_next_stage', 'view_soft_report'],
          hardSummary: { totalBlocking: 0, totalWarnings: hardWarnings.length, passed: true },
          softSummary: softReport
            ? {
                overallScore: softReport.overallScore,
                weightedScore: softReport.weightedScore,
                dimensionsEvaluated: softReport.dimensionsEvaluated.length,
                status: softReport.status,
              }
            : undefined,
        })
      }

      // 7.2: Soft unavailable → pass with warning
      if (!softAvailable) {
        return this.#buildDecision(stageId, profile, 'pass', {
          blockingReasons: [],
          warnings: ['Soft evaluation unavailable — proceeding with hard validation only'],
          attentionAreas: [],
          requiresHumanReview: false,
          allowedNextActions: ['proceed_to_next_stage', 'view_hard_report'],
          hardSummary: { totalBlocking: 0, totalWarnings: hardWarnings.length, passed: true },
          softSummary: softReport
            ? {
                overallScore: softReport.overallScore,
                weightedScore: softReport.weightedScore,
                dimensionsEvaluated: softReport.dimensionsEvaluated.length,
                status: softReport.status,
              }
            : undefined,
        })
      }

      // 7.2: Hard pass + Soft 低分 → conditional_pass
      return this.#buildDecision(stageId, profile, 'conditional_pass', {
        blockingReasons: [],
        warnings: [
          `Soft weightedScore (${softReport?.weightedScore?.toFixed(1)}) 低于阈值 (${softThreshold})`,
        ],
        attentionAreas: this.#getSoftAttentionAreas(softReport),
        requiresHumanReview: true,
        allowedNextActions: ['proceed_to_preview', 'address_soft_concerns', 'request_human_review'],
        hardSummary: { totalBlocking: 0, totalWarnings: hardWarnings.length, passed: true },
        softSummary: softReport
          ? {
              overallScore: softReport.overallScore,
              weightedScore: softReport.weightedScore,
              dimensionsEvaluated: softReport.dimensionsEvaluated.length,
              status: softReport.status,
            }
          : undefined,
      })
    }

    // fallback
    return this.#buildDecision(stageId, profile, 'blocked', {
      blockingReasons: ['Unknown blocking condition'],
      requiresHumanReview: true,
      allowedNextActions: ['fix_blocking_issues'],
      hardSummary: { totalBlocking: 0, totalWarnings: 0, passed: false },
    })
  }

  /** 构建决策对象。 */
  #buildDecision(
    stageId: string,
    profile: VGateProfile,
    status: VGateDecision['status'],
    opts: {
      blockingReasons: string[]
      warnings?: string[]
      attentionAreas?: {
        area: string
        description: string
        severity: 'info' | 'warning' | 'attention'
      }[]
      requiresHumanReview: boolean
      allowedNextActions: string[]
      hardSummary: { totalBlocking: number; totalWarnings: number; passed: boolean }
      softSummary?: {
        overallScore?: number
        weightedScore?: number
        dimensionsEvaluated: number
        status: string
      }
    },
  ): VGateDecision {
    return {
      decisionId: `vg-${stageId}-${Date.now()}`,
      stageId,
      profileId: profile.profileId,
      status,
      blockingReasons: opts.blockingReasons,
      warnings: opts.warnings ?? [],
      attentionAreas: opts.attentionAreas ?? [],
      requiresHumanReview: opts.requiresHumanReview,
      allowedNextActions: opts.allowedNextActions,
      evidenceRefs: [],
      hardSummary: opts.hardSummary,
      softSummary: opts.softSummary,
      repairSuggestions: [],
      generatedAt: new Date().toISOString(),
    }
  }

  /** 从 Soft report 提取关注区域。 */
  #getSoftAttentionAreas(
    softReport: SoftEvaluationReport | null,
  ): { area: string; description: string; severity: 'info' | 'warning' | 'attention' }[] {
    if (!softReport) return []
    return softReport.dimensionScores
      .filter((s) => s.score < 3)
      .map((s) => ({
        area: s.dimensionId,
        description: `${s.dimensionId}: score ${s.score}/5 — ${s.rationale.slice(0, 100)}`,
        severity: s.score < 2 ? ('attention' as const) : ('warning' as const),
      }))
  }
}
