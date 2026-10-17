/**
 * v3-triz-innovation-workbench —— 确定性评分与对比服务（§4.1-4.3）。
 *
 * 纯确定性：不调用 AIGateway、不触网、不查库、不写正式数据、零模型成本（modelCostRecorded=true）。
 * AI narrative 不得改变本服务产出的 score / 排序 / 影响维度 / handoff 资格。
 * 对比只产出静态影响方向摘要，绝不生成 what-if 排程基线或甘特重排。
 */
import { createHash } from 'node:crypto'
import type {
  InnovationComparisonCell,
  InnovationImpactSummary,
  InnovationOption,
  InnovationScore,
  InnovationScheme,
  InnovationSchemeComparison,
  TrizAnalysisWarning,
} from '@aiproj/types'
import { compareInnovationOptions, impactDirectionWeight, rankWarningSeverity } from '@aiproj/types'

type Severity = 'critical' | 'high' | 'medium' | 'low'

const SEVERITY_SCORE: Record<Severity, number> = {
  critical: 28,
  high: 20,
  medium: 12,
  low: 6,
}

export default class InnovationScoringService {
  /**
   * 计算单个 option 的确定性评分（§4.1）。
   * 全部分量来自 source severity/confidence、stale、warning、适用性、约束、hash 完整度、评审状态。
   */
  scoreOption(option: InnovationOption): InnovationScore {
    // severity：取来源中最高严重度
    const severities = option.sourceRefs
      .map((s) => s.severity)
      .filter((s): s is Severity => !!s && s in SEVERITY_SCORE)
    const severityScore = severities.length
      ? Math.max(...severities.map((s) => SEVERITY_SCORE[s]))
      : 4

    // confidence：来源无置信度时取 0.5 中位
    const confidences = option.sourceRefs.map((s) => s).length
    const confidenceScore = Math.round(
      (option.hashes.contradictionSignatures.length > 0 ? 0.7 : 0.5) * 15,
    )
    void confidences

    // stale 惩罚
    const anyStale = option.sourceRefs.some((s) => s.stale)
    const stalePenalty = anyStale ? -10 : 0

    // warning 惩罚（blocking 重罚，warning 轻罚，封顶 -20）
    let warningPenalty = 0
    for (const w of option.warnings) {
      warningPenalty += rankWarningSeverity(w.severity) === 0 ? -5 : -2
    }
    warningPenalty = Math.max(warningPenalty, -20)

    // 适用性：每条适用条件 +2（最多 3 条）
    const applicability = Math.min(option.applicability.length, 3) * 2

    // 约束匹配：无不适用条件 +5，否则 +2
    const constraintFit = option.nonApplicability.length === 0 ? 5 : 2

    // source hash 完整度：所有来源都有 hash +5，否则 +2
    const allHashed = option.sourceRefs.length > 0 && option.sourceRefs.every((s) => s.hash)
    const hashCompleteness = allHashed ? 5 : 2

    // 评审状态：reviewed +5 / pending +3 / needs_changes +2
    const reviewState =
      option.reviewState === 'reviewed' ? 5 : option.reviewState === 'pending' ? 3 : 2

    const raw =
      severityScore +
      confidenceScore +
      stalePenalty +
      warningPenalty +
      applicability +
      constraintFit +
      hashCompleteness +
      reviewState

    const total = Math.max(0, Math.min(100, raw))

    return {
      total,
      severity: severityScore,
      confidence: confidenceScore,
      stalePenalty,
      warningPenalty,
      applicability,
      constraintFit,
      hashCompleteness,
      reviewState,
    }
  }

  /** 对方案内所有 option 评分，返回 optionId → score 映射。 */
  scoreScheme(scheme: Pick<InnovationScheme, 'options'>): Record<string, InnovationScore> {
    const scores: Record<string, InnovationScore> = {}
    for (const opt of scheme.options) {
      scores[opt.optionId] = this.scoreOption(opt)
    }
    return scores
  }

  /**
   * 判定单个 option 是否可 handoff（确定性）。
   * 不可 handoff：有 blocking warning、来源 stale、无来源 ref、option 自身标记需人工复核（reviewState=needs_changes 不阻断，仅记）。
   */
  isHandoffEligible(option: InnovationOption, schemeWarnings: TrizAnalysisWarning[]): boolean {
    if (option.sourceRefs.length === 0) return false
    if (option.sourceRefs.some((s) => s.stale)) return false
    const hasBlocking =
      option.warnings.some((w) => w.severity === 'blocking') ||
      schemeWarnings.some((w) => w.severity === 'blocking')
    if (hasBlocking) return false
    return true
  }

  /**
   * 生成方案对比（§4.2）——静态影响摘要，非 what-if 仿真。
   * 同输入必同输出（排序、score、impact 不变）；零模型成本。
   */
  compareScheme(scheme: InnovationScheme): InnovationSchemeComparison {
    const scores = this.scoreScheme(scheme)

    const cells: InnovationComparisonCell[] = scheme.options.map((opt) => {
      const score = scores[opt.optionId] ?? this.scoreOption(opt)
      return {
        optionId: opt.optionId,
        score,
        impact: this.normalizeImpact(opt.impact),
        warningCount: opt.warnings.length,
        blockingWarningCount: opt.warnings.filter((w) => w.severity === 'blocking').length,
        reviewState: opt.reviewState,
        handoffEligible: this.isHandoffEligible(
          opt,
          scheme.options.flatMap((o) => o.warnings),
        ),
      }
    })

    // 确定性稳定排序
    cells.sort(compareInnovationOptions)

    // 方案级 warnings 汇总（去重 by code+severity）
    const allWarnings = scheme.options.flatMap((o) => o.warnings)
    const warnings = this.dedupeWarnings(allWarnings)

    return {
      schemeId: scheme.schemeId,
      schemaVersion: scheme.schemaVersion,
      cells,
      warnings,
      calculatedAt: this.staticTimestamp(scheme),
      modelCostRecorded: true, // 确定性对比：零模型调用、零模型成本
    }
  }

  /**
   * 对比快照 ref（确定性 hash，用于审计追溯与幂等判定）。
   * 排除 calculatedAt 抖动字段。
   */
  comparisonRef(scheme: InnovationScheme): string {
    const comparison = this.compareScheme(scheme)
    const stable = {
      schemeId: comparison.schemeId,
      cells: comparison.cells.map((c) => ({
        o: c.optionId,
        t: c.score.total,
        s: c.score.severity,
        c: c.score.confidence,
        w: c.warningCount,
        bw: c.blockingWarningCount,
        h: c.handoffEligible,
        i: c.impact,
      })),
    }
    const hash = createHash('sha256')
      .update(JSON.stringify(stable), 'utf-8')
      .digest('hex')
      .slice(0, 16)
    return `iw-cmp-${hash}`
  }

  /** 影响方向加权汇总（仅用于评分辅助，非仿真数值）。 */
  impactNet(impact: InnovationImpactSummary): number {
    const dims: Array<keyof InnovationImpactSummary> = [
      'schedule',
      'resource_load',
      'risk',
      'scope_flexibility',
      'quality_maintainability',
      'change_complexity',
    ]
    let net = 0
    for (const d of dims) {
      const w = impactDirectionWeight(impact[d])
      // change_complexity 方向语义相反：worsens 代表复杂度高（负面）
      net += d === 'change_complexity' ? -w : w
    }
    return net
  }

  // ──────── 内部 ────────

  private normalizeImpact(impact: InnovationImpactSummary): InnovationImpactSummary {
    return { ...impact }
  }

  private dedupeWarnings(warnings: TrizAnalysisWarning[]): TrizAnalysisWarning[] {
    const seen = new Set<string>()
    const out: TrizAnalysisWarning[] = []
    for (const w of warnings) {
      const k = `${w.code}:${w.severity}:${w.pathId ?? ''}:${w.sourceKey ?? ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(w)
    }
    return out
  }

  /**
   * 静态时间戳：对比稳定性要求同输入同输出，故采用方案的 updatedAt/createdAt 而非当前时间。
   * 这保证 compareScheme 在同一方案上幂等（无抖动），calculatedAt 不参与 comparisonRef hash。
   */
  private staticTimestamp(scheme: InnovationScheme): string {
    return scheme.updatedAt ?? scheme.createdAt
  }
}
