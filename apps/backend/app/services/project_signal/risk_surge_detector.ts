import ProjectSignalMetricsService, {
  type RiskSurgeFacts,
} from './project_signal_metrics_service.js'
import type {
  SignalHitCondition,
  SignalObservation,
  SignalObservationWindows,
} from './signal_contracts.js'
import {
  DEFECT_SURGE_ABSOLUTE_MIN,
  DEFECT_SURGE_GROWTH_RATIO,
  DEFECT_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
  DEFECT_SURGE_SIGNIFICANT_GROWTH_RATIO,
  HIGH_RISK_SURGE_ABSOLUTE_MIN,
  HIGH_RISK_SURGE_GROWTH_RATIO,
  HIGH_RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
  HIGH_RISK_SURGE_SIGNIFICANT_GROWTH_RATIO,
  RISK_SURGE_ABSOLUTE_MIN,
  RISK_SURGE_GROWTH_RATIO,
  RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
  RISK_SURGE_SIGNIFICANT_GROWTH_RATIO,
  isSurgeHit,
  surgeGrowth,
} from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.2 ②——风险与缺陷突变检测器（只读）。
 *
 * 三个条件（spec「四类硬信号检测」第 2 条 ①②③，任一命中即候选）：
 * - 活跃风险数环比上升达阈值（`created_at` 累计 − 关闭事件累计的窗口末重放）；
 * - 高危风险（`risk_level ∈ high/critical`）新增环比达阈值；
 * - 严重缺陷（`issues.type='bug'` ∧ `severity ∈ critical/major`）新增环比达阈值。
 *
 * 无预归档快照表：事实由 `ProjectSignalMetricsService` 按三个观测窗（本周期 / 上一周期 /
 * 上上周期）实时切片得到，逐周期时间窗 SQL（design 待核实清单第 6 项结论）。
 * 「连续 ≥2 周期」用同一组规则在（上周期 vs 上上周期）再评一次，两次都命中才算连续。
 *
 * 只读：不写任何业务表；证据只含计数、枚举与实体 ID（无个人维度，D9 ③）。
 */
export interface RiskSurgeDetectorDeps {
  /** 可注入替身（单测零 DB）；缺省即真实事实读取器。 */
  metricsService?: Pick<ProjectSignalMetricsService, 'loadRiskSurgeFacts'>
}

export interface RiskSurgeEvaluateRequest {
  organizationId: number
  projectId: number
  windows: SignalObservationWindows
}

interface SurgeConditionSpec {
  condition: SignalHitCondition
  growthRatio: number
  absoluteMin: number
  significantGrowthRatio: number
  significantAbsoluteMin: number
  pick: (facts: RiskSurgeFacts, index: number) => number
}

const CONDITIONS: SurgeConditionSpec[] = [
  {
    condition: 'active_risk_surge',
    growthRatio: RISK_SURGE_GROWTH_RATIO,
    absoluteMin: RISK_SURGE_ABSOLUTE_MIN,
    significantGrowthRatio: RISK_SURGE_SIGNIFICANT_GROWTH_RATIO,
    significantAbsoluteMin: RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
    pick: (facts, index) => facts.windows[index]?.activeRisks ?? 0,
  },
  {
    condition: 'high_risk_surge',
    growthRatio: HIGH_RISK_SURGE_GROWTH_RATIO,
    absoluteMin: HIGH_RISK_SURGE_ABSOLUTE_MIN,
    significantGrowthRatio: HIGH_RISK_SURGE_SIGNIFICANT_GROWTH_RATIO,
    significantAbsoluteMin: HIGH_RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
    pick: (facts, index) => facts.windows[index]?.newHighRisks ?? 0,
  },
  {
    condition: 'severe_defect_surge',
    growthRatio: DEFECT_SURGE_GROWTH_RATIO,
    absoluteMin: DEFECT_SURGE_ABSOLUTE_MIN,
    significantGrowthRatio: DEFECT_SURGE_SIGNIFICANT_GROWTH_RATIO,
    significantAbsoluteMin: DEFECT_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
    pick: (facts, index) => facts.windows[index]?.newSevereDefects ?? 0,
  },
]

export default class RiskSurgeDetector {
  readonly #deps: RiskSurgeDetectorDeps

  constructor(deps: RiskSurgeDetectorDeps = {}) {
    this.#deps = deps
  }

  async evaluate(request: RiskSurgeEvaluateRequest): Promise<SignalObservation> {
    const metrics = this.#deps.metricsService ?? new ProjectSignalMetricsService()
    const facts = await metrics.loadRiskSurgeFacts(
      request.organizationId,
      request.projectId,
      request.windows.all,
    )

    const hitConditions: SignalHitCondition[] = []
    let significant = false
    for (const spec of CONDITIONS) {
      const current = spec.pick(facts, 0)
      const previous = spec.pick(facts, 1)
      if (
        isSurgeHit({
          current,
          previous,
          growthRatio: spec.growthRatio,
          absoluteMin: spec.absoluteMin,
        })
      ) {
        hitConditions.push(spec.condition)
      }
      if (
        isSurgeHit({
          current,
          previous,
          growthRatio: spec.significantGrowthRatio,
          absoluteMin: spec.significantAbsoluteMin,
        })
      ) {
        significant = true
      }
    }

    const previousCycleHit = CONDITIONS.some((spec) =>
      isSurgeHit({
        current: spec.pick(facts, 1),
        previous: spec.pick(facts, 2),
        growthRatio: spec.growthRatio,
        absoluteMin: spec.absoluteMin,
      }),
    )

    const current0 = facts.windows[0]
    const current1 = facts.windows[1]
    const current2 = facts.windows[2]
    const completenessGap = facts.truncated ? 'FACT_ROW_LIMIT_TRUNCATED' : null

    return {
      signalType: 'risk_surge',
      triggered: hitConditions.length > 0,
      significant,
      fieldsComplete: completenessGap === null,
      consecutiveCycles: hitConditions.length > 0 && previousCycleHit ? 2 : 1,
      completenessGap,
      dataInsufficient: false,
      insufficientReason: null,
      severity: hitConditions.length > 0 ? (significant ? 'critical' : 'warning') : 'info',
      readings: {
        metric: 'risk_register_surge',
        activeRisksCurrent: current0?.activeRisks ?? 0,
        activeRisksPrevious: current1?.activeRisks ?? 0,
        activeRisksBase: current2?.activeRisks ?? 0,
        activeRiskGrowthRatio: surgeGrowth(current0?.activeRisks ?? 0, current1?.activeRisks ?? 0),
        newHighRisksCurrent: current0?.newHighRisks ?? 0,
        newHighRisksPrevious: current1?.newHighRisks ?? 0,
        newHighRiskGrowthRatio: surgeGrowth(
          current0?.newHighRisks ?? 0,
          current1?.newHighRisks ?? 0,
        ),
        newSevereDefectsCurrent: current0?.newSevereDefects ?? 0,
        newSevereDefectsPrevious: current1?.newSevereDefects ?? 0,
        severeDefectGrowthRatio: surgeGrowth(
          current0?.newSevereDefects ?? 0,
          current1?.newSevereDefects ?? 0,
        ),
        coveredCycles: facts.windows.length,
      },
      thresholds: {
        riskGrowthRatio: RISK_SURGE_GROWTH_RATIO,
        riskAbsoluteMin: RISK_SURGE_ABSOLUTE_MIN,
        highRiskGrowthRatio: HIGH_RISK_SURGE_GROWTH_RATIO,
        highRiskAbsoluteMin: HIGH_RISK_SURGE_ABSOLUTE_MIN,
        defectGrowthRatio: DEFECT_SURGE_GROWTH_RATIO,
        defectAbsoluteMin: DEFECT_SURGE_ABSOLUTE_MIN,
      },
      hitConditions,
      entityRefs: {
        risks: [...(current0?.newRiskIds ?? [])],
        issues: [...(current0?.severeDefectIds ?? [])],
      },
      truncated: facts.truncated,
    }
  }
}
