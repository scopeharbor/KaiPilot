import ProjectEvmService from '#services/project_evm_service'
import type { SignalObservation, SignalObservationWindows } from './signal_contracts.js'
import {
  SPI_DELAYED_THRESHOLD,
  SPI_SIGNIFICANT_THRESHOLD,
  SV_NEGATIVE_THRESHOLD,
} from './signal_thresholds.js'

/**
 * v3-triz-contradiction-copilot W3 任务 3.2 ①——进度偏差检测器（只读）。
 *
 * 口径（spec「四类硬信号检测」第 1 条）：`SPI < 0.95`（沿用既有 `scheduleStatus='delayed'`
 * 语义）**且** `SV < 0` 即候选；数据 MUST 走既有 EVM 服务（`ProjectEvmService.getIndicators`），
 * 本检测器不重算 EVM、不自造阈值口径。
 *
 * 「连续 ≥2 周期」可复算：EVM 服务原生支持 `asOfDate` 历史重放，故用同一判定函数在
 * 本周期（`windows.current.to`）与上一周期（`windows.previous.to`）各评一次——
 * 两次都越界才算连续 2 周期（design D8 ②）。
 *
 * 只读：仅调用 EVM 读取，零写入（含零业务表写入）。
 */
export interface ProgressDeviationDetectorDeps {
  /** 可注入替身（单测零 DB）；缺省即既有 EVM 服务。 */
  evmService?: Pick<ProjectEvmService, 'getIndicators'>
}

export interface ProgressDeviationEvaluateRequest {
  organizationId: number
  projectId: number
  windows: SignalObservationWindows
}

export default class ProgressDeviationDetector {
  readonly #deps: ProgressDeviationDetectorDeps

  constructor(deps: ProgressDeviationDetectorDeps = {}) {
    this.#deps = deps
  }

  async evaluate(request: ProgressDeviationEvaluateRequest): Promise<SignalObservation> {
    const evm = this.#deps.evmService ?? new ProjectEvmService()
    const [current, previous] = await Promise.all([
      evm.getIndicators(request.organizationId, request.projectId, request.windows.current.to),
      evm.getIndicators(request.organizationId, request.projectId, request.windows.previous.to),
    ])

    const currentHit = isDelayed(current)
    const previousHit = isDelayed(previous)
    const measurable = Number.isFinite(current.pv) && current.pv > 0
    const completenessGap = measurable
      ? null
      : current.pv <= 0
        ? 'PLANNED_VALUE_UNAVAILABLE'
        : 'SPI_UNAVAILABLE'
    const significant = current.spi < SPI_SIGNIFICANT_THRESHOLD

    return {
      signalType: 'progress_deviation',
      triggered: currentHit,
      significant,
      fieldsComplete: completenessGap === null,
      consecutiveCycles: currentHit && previousHit ? 2 : 1,
      completenessGap,
      dataInsufficient: false,
      insufficientReason: null,
      severity: currentHit ? (significant ? 'critical' : 'warning') : 'info',
      readings: {
        metric: 'schedule_performance_index',
        spi: current.spi,
        spiPrevious: previous.spi,
        sv: current.sv,
        svPrevious: previous.sv,
        scheduleStatus: current.scheduleStatus,
        plannedValue: current.pv,
        earnedValue: current.ev,
        budgetAtCompletion: current.bac,
        hasBaseline: current.hasBaseline,
      },
      thresholds: {
        spiDelayed: SPI_DELAYED_THRESHOLD,
        spiSignificant: SPI_SIGNIFICANT_THRESHOLD,
        svNegative: SV_NEGATIVE_THRESHOLD,
      },
      hitConditions: currentHit ? ['spi_delayed'] : [],
      entityRefs: {},
      truncated: false,
    }
  }
}

/** 越界判定：SPI 低于既有 delayed 线且进度偏差为负（两条件缺一不可）。 */
export function isDelayed(indicators: { spi: number; sv: number }): boolean {
  return indicators.spi < SPI_DELAYED_THRESHOLD && indicators.sv < SV_NEGATIVE_THRESHOLD
}
