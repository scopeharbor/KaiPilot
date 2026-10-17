import ProjectSignalMetricsService, {
  type MilestoneSlipFacts,
} from './project_signal_metrics_service.js'
import type { SignalObservation, SignalObservationWindows } from './signal_contracts.js'
import {
  MILESTONE_REPLAY_UNSUPPORTED,
  MILESTONE_SLIP_CUMULATIVE_DAYS,
  MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT,
  MILESTONE_SLIP_SINGLE_DAYS,
  MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT,
} from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.2 ④——里程碑滑移检测器（只读）。
 *
 * 口径（spec「四类硬信号检测」第 4 条）：相对甘特基线，里程碑计划日累计滑移达阈值即候选；
 * **无基线时必须判「数据不足」**，MUST NOT 以「滑移 0 天」作为结论（`slipDays` 全为 null 而非 0）。
 * 滑移 = `Milestone.plannedDate − GanttBaseline.snapshot.milestones[].plannedDate`（Luxon 日差，
 * 只计正滑移；提前完成不算滑移）。
 *
 * 「连续 ≥2 周期」诚实降级：一期没有里程碑计划变更历史（基线为单行覆盖快照、里程碑无历史表），
 * 同一条滑移无法跨周期重放 → `consecutiveCycles` 恒为 1、`readings.replaySupported = false`，
 * 上层据此把条件 ② 判为未命中（里程碑信号因此一期不进高置信；不假称「已连续两周」）。
 *
 * 只读：仅读取里程碑与基线快照，零写入。
 */
export interface MilestoneSlipDetectorDeps {
  /** 可注入替身（单测零 DB）；缺省即真实事实读取器。 */
  metricsService?: Pick<ProjectSignalMetricsService, 'loadMilestoneSlipFacts'>
}

export interface MilestoneSlipEvaluateRequest {
  organizationId: number
  projectId: number
  windows: SignalObservationWindows
}

export interface MilestoneSlipReadings {
  milestoneCount: number
  baselineCoveredCount: number
  missingPlannedDateCount: number
  slippedMilestoneCount: number
  cumulativeSlipDays: number
  maxSlipDays: number
}

/** 汇总滑移读数（纯函数，便于单测直接断言；只计正滑移）。 */
export function summarizeMilestoneSlip(facts: MilestoneSlipFacts): MilestoneSlipReadings {
  const slipped = facts.milestones.filter((fact) => (fact.slipDays ?? 0) > 0)
  return {
    milestoneCount: facts.milestones.length,
    baselineCoveredCount: facts.baselineCoveredCount,
    missingPlannedDateCount: facts.missingPlannedDateCount,
    slippedMilestoneCount: slipped.length,
    cumulativeSlipDays: slipped.reduce((sum, fact) => sum + (fact.slipDays ?? 0), 0),
    maxSlipDays: slipped.reduce((max, fact) => Math.max(max, fact.slipDays ?? 0), 0),
  }
}

export default class MilestoneSlipDetector {
  readonly #deps: MilestoneSlipDetectorDeps

  constructor(deps: MilestoneSlipDetectorDeps = {}) {
    this.#deps = deps
  }

  async evaluate(request: MilestoneSlipEvaluateRequest): Promise<SignalObservation> {
    const metrics = this.#deps.metricsService ?? new ProjectSignalMetricsService()
    const facts = await metrics.loadMilestoneSlipFacts(request.organizationId, request.projectId)

    if (!facts.hasBaseline) {
      // 数据不足降级：不产信号，且不得把「无基线」当成「滑移 0 天」。
      return {
        signalType: 'milestone_slip',
        triggered: false,
        significant: false,
        fieldsComplete: false,
        consecutiveCycles: 1,
        completenessGap: 'BASELINE_MISSING',
        dataInsufficient: true,
        insufficientReason: facts.noBaselineReason,
        severity: 'info',
        readings: {
          metric: 'milestone_schedule_slip',
          hasBaseline: false,
          baselineSavedAt: null,
          milestoneCount: facts.milestones.length,
          baselineCoveredCount: 0,
          missingPlannedDateCount: facts.missingPlannedDateCount,
          slippedMilestoneCount: 0,
          cumulativeSlipDays: null,
          maxSlipDays: null,
          slipDaysBasis: 'unavailable',
          replaySupported: false,
          replayReason: MILESTONE_REPLAY_UNSUPPORTED,
          coveredCycles: 1,
        },
        thresholds: {
          cumulativeDays: MILESTONE_SLIP_CUMULATIVE_DAYS,
          singleDays: MILESTONE_SLIP_SINGLE_DAYS,
          cumulativeDaysSignificant: MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT,
          singleDaysSignificant: MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT,
        },
        hitConditions: [],
        entityRefs: {},
        truncated: facts.truncated,
      }
    }

    const readings = summarizeMilestoneSlip(facts)
    const triggered =
      readings.cumulativeSlipDays >= MILESTONE_SLIP_CUMULATIVE_DAYS ||
      readings.maxSlipDays >= MILESTONE_SLIP_SINGLE_DAYS
    const significant =
      readings.cumulativeSlipDays >= MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT ||
      readings.maxSlipDays >= MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT
    const completenessGap = facts.truncated
      ? 'FACT_ROW_LIMIT_TRUNCATED'
      : readings.baselineCoveredCount === 0
        ? 'BASELINE_MILESTONES_EMPTY'
        : null

    const slippedIds = facts.milestones
      .filter((fact) => (fact.slipDays ?? 0) > 0)
      .map((fact) => fact.id)

    return {
      signalType: 'milestone_slip',
      triggered,
      significant,
      fieldsComplete: completenessGap === null,
      // 见文件头：一期不重放里程碑计划变更历史，连续周期数不得假称 ≥2。
      consecutiveCycles: 1,
      completenessGap,
      dataInsufficient: false,
      insufficientReason: null,
      severity: triggered ? (significant ? 'critical' : 'warning') : 'info',
      readings: {
        metric: 'milestone_schedule_slip',
        hasBaseline: true,
        baselineSavedAt: facts.baselineSavedAt,
        milestoneCount: readings.milestoneCount,
        baselineCoveredCount: readings.baselineCoveredCount,
        missingPlannedDateCount: readings.missingPlannedDateCount,
        slippedMilestoneCount: readings.slippedMilestoneCount,
        cumulativeSlipDays: readings.cumulativeSlipDays,
        maxSlipDays: readings.maxSlipDays,
        slipDaysBasis: 'planned_date_vs_baseline_snapshot',
        replaySupported: false,
        replayReason: MILESTONE_REPLAY_UNSUPPORTED,
        coveredCycles: 1,
      },
      thresholds: {
        cumulativeDays: MILESTONE_SLIP_CUMULATIVE_DAYS,
        singleDays: MILESTONE_SLIP_SINGLE_DAYS,
        cumulativeDaysSignificant: MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT,
        singleDaysSignificant: MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT,
      },
      hitConditions: triggered ? ['milestone_slip'] : [],
      entityRefs: { milestones: slippedIds },
      truncated: facts.truncated,
    }
  }
}
