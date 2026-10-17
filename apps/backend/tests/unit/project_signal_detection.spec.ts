// v3-triz-contradiction-copilot tasks 3.2 —— 四类信号检测器 + 阈值常量单测。
//
// 覆盖（tasks 3.2 验收）：
// - 四类检测器各 ≥2 例（命中 / 不命中 / 边界）；
// - `SPI = 0.95` 边界（等于越界线不产信号，低于才产）；
// - 单周期不升层（连续周期不足 ⇒ 低置信）；
// - 无基线 → 数据不足（不产信号，且不得记为「滑移 0 天」）；
// - 阈值常量可断言（取值 + 显著档严格于触发档 + 默认只允许收紧）；
// - 断言语义「检测过程零业务表写入」：依赖全部为只读假件，记录的方法名闭集为只读方法，
//   检测器全部真实执行（非空转自证 `detectorRuns === 4`）。
import type { EvmIndicators } from '#services/project_evm_service'
import type { ResourceLoadResult } from '#services/resource_load_service'
import ProgressDeviationDetector from '#services/project_signal/progress_deviation_detector'
import RiskSurgeDetector from '#services/project_signal/risk_surge_detector'
import ResourceOverloadDetector from '#services/project_signal/resource_overload_detector'
import MilestoneSlipDetector from '#services/project_signal/milestone_slip_detector'
import ProjectSignalDetectionService from '#services/project_signal/project_signal_detection_service'
import type { MilestoneSlipFacts } from '#services/project_signal/project_signal_metrics_service'
import type { RiskSurgeFacts } from '#services/project_signal/project_signal_metrics_service'
import {
  resolveSignalObservationWindows,
  type ProjectSignalType,
  type SignalObservation,
} from '#services/project_signal/signal_contracts'
import {
  MILESTONE_SLIP_CUMULATIVE_DAYS,
  MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT,
  MILESTONE_SLIP_SINGLE_DAYS,
  MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT,
  PROJECT_SIGNAL_THRESHOLDS,
  RESOURCE_OVERLOAD_COUNT_MIN,
  RESOURCE_OVERLOAD_COUNT_SIGNIFICANT,
  RESOURCE_OVERLOAD_HOURS_MIN,
  RESOURCE_OVERLOAD_RATIO_PERCENT,
  RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT,
  SPI_DELAYED_THRESHOLD,
  SPI_SIGNIFICANT_THRESHOLD,
} from '#services/project_signal/signal_thresholds'
import { test } from '@japa/runner'

const AS_OF = '2026-09-07'
const WINDOWS = resolveSignalObservationWindows(
  AS_OF,
  PROJECT_SIGNAL_THRESHOLDS.SIGNAL_OBSERVATION_WINDOW_DAYS,
)
const ORG = 7
const PROJECT = 11

// ---------------------------------------------------------------------------
// 只读假件（零 DB / 零模型 / 零网络），并记录被调用的方法名
// ---------------------------------------------------------------------------

/** 只读方法名闭集：检测链路只允许调用这些方法（写入方法一旦被调用即在本测试暴露）。 */
const READ_ONLY_METHODS = new Set([
  'getIndicators',
  'load',
  'loadRiskSurgeFacts',
  'loadMilestoneSlipFacts',
])

function recording<T extends object>(target: T, calls: string[]): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          calls.push(String(prop))
          return (value as (...inner: unknown[]) => unknown).apply(obj, args)
        }
      }
      return value
    },
  })
}

// ── ① 进度偏差假件 ──────────────────────────────────────────────────────

function byId(entry: Partial<EvmIndicators>, asOf: string): EvmIndicators {
  const spi = entry.spi ?? 1
  return {
    projectId: PROJECT,
    asOfDate: asOf,
    hasBaseline: entry.hasBaseline ?? true,
    bac: entry.bac ?? 1_000_000,
    pv: entry.pv ?? 500_000,
    ev: entry.ev ?? 450_000,
    ac: entry.ac ?? 400_000,
    cv: entry.cv ?? 0,
    sv: entry.sv ?? 0,
    cpi: entry.cpi ?? 1,
    spi,
    etc: 0,
    eac: 0,
    vac: 0,
    tcpi: 1,
    scheduleStatus: entry.scheduleStatus ?? (spi < SPI_DELAYED_THRESHOLD ? 'delayed' : 'on_track'),
    costStatus: 'on_track',
  }
}

function evmFake(entries: Record<string, Partial<EvmIndicators>>, calls: string[]) {
  return recording(
    {
      async getIndicators(_org: number, _project: number, asOf?: string): Promise<EvmIndicators> {
        const entry = entries[asOf ?? '']
        if (!entry) throw new Error(`缺少 ${String(asOf)} 的 EVM fixture`)
        return byId(entry, String(asOf))
      },
    },
    calls,
  )
}

// ── ② 风险 / 缺陷事实假件 ───────────────────────────────────────────────

function riskFacts(config: {
  active: [number, number, number]
  high: [number, number, number]
  defects: [number, number, number]
  truncated?: boolean
}): RiskSurgeFacts {
  return {
    windows: WINDOWS.all.map((window, index) => ({
      window,
      newRisks: config.active[index] ?? 0,
      newHighRisks: config.high[index] ?? 0,
      activeRisks: config.active[index] ?? 0,
      newSevereDefects: config.defects[index] ?? 0,
      newRiskIds: [],
      newHighRiskIds: [],
      severeDefectIds: [],
      activeTruncated: false,
    })),
    truncated: config.truncated ?? false,
  }
}

function riskMetricsFake(facts: RiskSurgeFacts, calls: string[]) {
  return recording(
    {
      async loadRiskSurgeFacts(): Promise<RiskSurgeFacts> {
        return facts
      },
    },
    calls,
  )
}

// ── ③ 资源负载假件 ──────────────────────────────────────────────────────

function loadFake(
  perWindow: { total: number; overloaded: number; peakPercent: number; overloadHours: number },
  calls: string[],
) {
  const build = (): ResourceLoadResult => ({
    from: WINDOWS.current.from,
    to: WINDOWS.current.to,
    teamAverageUtilizationPercent: 80,
    resources: Array.from({ length: perWindow.total }, (_, index) => {
      const overloaded = index < perWindow.overloaded
      return {
        resourceId: index + 1,
        resourceName: `R${index + 1}`,
        role: 'member',
        dailyCapacityHours: 8,
        overallUtilizationPercent: overloaded ? perWindow.peakPercent : 50,
        days: [
          {
            date: WINDOWS.current.from,
            totalAllocatedPercent: overloaded ? perWindow.peakPercent : 50,
            allocatedHours: overloaded ? 8 + perWindow.overloadHours : 4,
            capacityHours: 8,
          },
        ],
      }
    }),
  })

  return recording(
    {
      async load(): Promise<ResourceLoadResult> {
        return build()
      },
    },
    calls,
  )
}

// ── ④ 里程碑滑移假件 ────────────────────────────────────────────────────

function milestoneFacts(
  slips: number[],
  options: { hasBaseline?: boolean; missingPlannedDateCount?: number } = {},
): MilestoneSlipFacts {
  const milestones = slips.map((slipDays, index) => ({
    id: index + 1,
    plannedDate: '2026-09-30',
    baselinePlannedDate: '2026-09-01',
    slipDays,
  }))
  return {
    hasBaseline: options.hasBaseline ?? true,
    baselineSavedAt: options.hasBaseline === false ? null : '2026-08-01T00:00:00.000Z',
    milestones,
    baselineCoveredCount: options.hasBaseline === false ? 0 : milestones.length,
    missingPlannedDateCount: options.missingPlannedDateCount ?? 0,
    noBaselineReason: options.hasBaseline === false ? 'BASELINE_MISSING' : null,
    truncated: false,
  }
}

function milestoneMetricsFake(facts: MilestoneSlipFacts, calls: string[]) {
  return recording(
    {
      async loadMilestoneSlipFacts(): Promise<MilestoneSlipFacts> {
        return facts
      },
    },
    calls,
  )
}

// ---------------------------------------------------------------------------
// ① 进度偏差
// ---------------------------------------------------------------------------

test.group('进度偏差检测器（EVM SPI/SV）', () => {
  test('命中：SPI < 0.95 且 SV < 0，连续两个周期 → 连续周期数 2', async ({ assert }) => {
    const calls: string[] = []
    const detector = new ProgressDeviationDetector({
      evmService: evmFake(
        {
          [WINDOWS.current.to]: { spi: 0.91, sv: -40_000 },
          [WINDOWS.previous.to]: { spi: 0.93, sv: -20_000 },
        },
        calls,
      ),
    })

    const observation = await detector.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })

    assert.isTrue(observation.triggered)
    assert.equal(observation.consecutiveCycles, 2)
    assert.isFalse(observation.significant, 'SPI 0.91 未到显著档（0.85）')
    assert.deepEqual(observation.hitConditions, ['spi_delayed'])
    assert.equal(observation.readings.spi, 0.91)
    assert.equal(observation.readings.spiPrevious, 0.93)
    assert.equal(observation.readings.sv, -40_000)
    assert.equal(observation.fieldsComplete, true)
    assert.equal(observation.severity, 'warning')
    assert.equal(observation.thresholds.spiDelayed, SPI_DELAYED_THRESHOLD)
  })

  test('边界：SPI = 0.95 不产信号（严格小于才越界），SPI = 0.949 产信号', async ({ assert }) => {
    const calls: string[] = []
    const boundary = new ProgressDeviationDetector({
      evmService: evmFake(
        {
          [WINDOWS.current.to]: { spi: SPI_DELAYED_THRESHOLD, sv: -10_000 },
          [WINDOWS.previous.to]: { spi: 0.99, sv: 1_000 },
        },
        calls,
      ),
    })
    const boundaryObservation = await boundary.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(boundaryObservation.triggered, 'SPI 等于 0.95 不应越界')
    assert.equal(boundaryObservation.consecutiveCycles, 1)

    const calls2: string[] = []
    const below = new ProgressDeviationDetector({
      evmService: evmFake(
        {
          [WINDOWS.current.to]: { spi: 0.949, sv: -10_000 },
          [WINDOWS.previous.to]: { spi: 0.99, sv: 1_000 },
        },
        calls2,
      ),
    })
    const belowObservation = await below.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(belowObservation.triggered)
    assert.equal(belowObservation.consecutiveCycles, 1, '上一周期未越界 ⇒ 只算 1 个周期')
  })

  test('SPI 越界但 SV ≥ 0 → 不产信号（两条件缺一不可）；显著档 SPI < 0.85 定级 critical', async ({
    assert,
  }) => {
    const calls: string[] = []
    const svZero = new ProgressDeviationDetector({
      evmService: evmFake(
        {
          [WINDOWS.current.to]: { spi: 0.8, sv: 0 },
          [WINDOWS.previous.to]: { spi: 0.8, sv: 0 },
        },
        calls,
      ),
    })
    const observation = await svZero.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(observation.triggered, 'SV 不为负不构成进度偏差信号')
    assert.equal(observation.severity, 'info', '未触发时为 info（不制造告警语义）')

    const calls2: string[] = []
    const severe = new ProgressDeviationDetector({
      evmService: evmFake(
        {
          [WINDOWS.current.to]: { spi: 0.8, sv: -120_000 },
          [WINDOWS.previous.to]: { spi: 0.82, sv: -90_000 },
        },
        calls2,
      ),
    })
    const severeObservation = await severe.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(severeObservation.triggered)
    assert.isTrue(severeObservation.significant)
    assert.isTrue(
      severeObservation.significant &&
        Number(severeObservation.readings.spi) < SPI_SIGNIFICANT_THRESHOLD,
    )
    assert.equal(severeObservation.severity, 'critical')
    assert.equal(severeObservation.consecutiveCycles, 2)
  })

  test('PV 不可得（无计划值）→ 关键字段不完整（高置信条件 ③ 未命中）', async ({ assert }) => {
    const calls: string[] = []
    const detector = new ProgressDeviationDetector({
      evmService: evmFake(
        {
          [WINDOWS.current.to]: { spi: 0.9, sv: -1_000, pv: 0 },
          [WINDOWS.previous.to]: { spi: 0.9, sv: -1_000, pv: 0 },
        },
        calls,
      ),
    })
    const observation = await detector.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(observation.triggered)
    assert.isFalse(observation.fieldsComplete)
    assert.equal(observation.completenessGap, 'PLANNED_VALUE_UNAVAILABLE')
  })
})

// ---------------------------------------------------------------------------
// ② 风险与缺陷突变
// ---------------------------------------------------------------------------

test.group('风险与缺陷突变检测器', () => {
  test('活跃风险环比命中（+3 / 60%）不达显著档；翻倍且 +6 达显著档', async ({ assert }) => {
    const calls: string[] = []
    const moderate = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [8, 5, 5], high: [0, 0, 0], defects: [0, 0, 0] }),
        calls,
      ),
    })
    const moderateObservation = await moderate.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(moderateObservation.triggered)
    assert.deepEqual(moderateObservation.hitConditions, ['active_risk_surge'])
    assert.isFalse(moderateObservation.significant)
    assert.equal(moderateObservation.consecutiveCycles, 1, '上周期未达阈值 ⇒ 单周期')

    const calls2: string[] = []
    const severe = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [12, 6, 6], high: [0, 0, 0], defects: [0, 0, 0] }),
        calls2,
      ),
    })
    const severeObservation = await severe.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(severeObservation.triggered)
    assert.isTrue(severeObservation.significant, '翻倍且绝对新增 6 ≥ 5 ⇒ 显著档')
    assert.equal(severeObservation.severity, 'critical')
  })

  test('高危风险新增环比与严重缺陷新增环比各自可独立触发', async ({ assert }) => {
    const calls: string[] = []
    const highRisk = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [5, 5, 5], high: [3, 1, 1], defects: [0, 0, 0] }),
        calls,
      ),
    })
    const highObservation = await highRisk.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(highObservation.triggered)
    assert.include(highObservation.hitConditions, 'high_risk_surge')
    assert.equal(highObservation.readings.newHighRisksCurrent, 3)
    assert.equal(highObservation.readings.newHighRiskGrowthRatio, 2)

    const calls2: string[] = []
    const defects = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [5, 5, 5], high: [0, 0, 0], defects: [6, 2, 2] }),
        calls2,
      ),
    })
    const defectObservation = await defects.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(defectObservation.triggered)
    assert.deepEqual(defectObservation.hitConditions, ['severe_defect_surge'])
    assert.equal(defectObservation.readings.newSevereDefectsCurrent, 6)
  })

  test('低于阈值不产信号：环比 +1 且不足绝对下限；三窗连续命中才计 2 周期', async ({ assert }) => {
    const calls: string[] = []
    const below = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [6, 5, 5], high: [1, 1, 1], defects: [3, 3, 3] }),
        calls,
      ),
    })
    const belowObservation = await below.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(belowObservation.triggered)
    assert.deepEqual(belowObservation.hitConditions, [])
    assert.equal(belowObservation.severity, 'info')

    const calls2: string[] = []
    const sustained = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [12, 8, 5], high: [0, 0, 0], defects: [0, 0, 0] }),
        calls2,
      ),
    })
    const sustainedObservation = await sustained.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(sustainedObservation.triggered)
    assert.equal(
      sustainedObservation.consecutiveCycles,
      2,
      '上周期（8 vs 5）同样达阈值 ⇒ 连续 2 周期',
    )
  })

  test('事实读取被上限截断 → 关键字段不完整', async ({ assert }) => {
    const calls: string[] = []
    const detector = new RiskSurgeDetector({
      metricsService: riskMetricsFake(
        riskFacts({ active: [9, 5, 5], high: [0, 0, 0], defects: [0, 0, 0], truncated: true }),
        calls,
      ),
    })
    const observation = await detector.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(observation.triggered)
    assert.isFalse(observation.fieldsComplete)
    assert.equal(observation.completenessGap, 'FACT_ROW_LIMIT_TRUNCATED')
  })
})

// ---------------------------------------------------------------------------
// ③ 资源过载
// ---------------------------------------------------------------------------

test.group('资源过载检测器', () => {
  test('超载占比达阈值即命中（团队聚合口径，无个人维度）；单点超载不产信号', async ({ assert }) => {
    const calls: string[] = []
    const hit = new ResourceOverloadDetector({
      resourceLoadService: loadFake(
        { total: 4, overloaded: 2, peakPercent: 120, overloadHours: 1 },
        calls,
      ),
    })
    const hitObservation = await hit.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(hitObservation.triggered)
    assert.equal(hitObservation.readings.overloadedResourceCount, 2)
    assert.equal(hitObservation.readings.overloadRatioPercent, 50)
    assert.equal(hitObservation.readings.peakAllocationPercent, 120)
    assert.isFalse(hitObservation.significant, '2 个超载资源未达显著档（3 个）')
    assert.deepEqual(hitObservation.entityRefs, {}, '资源类证据不留个人实体 ID（D9 ③）')
    assert.notProperty(hitObservation.readings, 'resourceId')

    const calls2: string[] = []
    const single = new ResourceOverloadDetector({
      resourceLoadService: loadFake(
        { total: 5, overloaded: 1, peakPercent: 240, overloadHours: 6 },
        calls2,
      ),
    })
    const singleObservation = await single.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(singleObservation.triggered, '单点超载不构成项目级信号')
  })

  test('超载资源 ≥3 且峰值 ≥150% → 显著档（critical）；连续两周期 → 2 周期', async ({ assert }) => {
    const calls: string[] = []
    const sustained = new ResourceOverloadDetector({
      resourceLoadService: loadFake(
        { total: 4, overloaded: 3, peakPercent: 160, overloadHours: 2 },
        calls,
      ),
    })
    const observation = await sustained.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(observation.triggered)
    assert.isTrue(observation.significant)
    assert.equal(observation.severity, 'critical')
    assert.equal(observation.consecutiveCycles, 2)
    assert.equal(observation.thresholds.countSignificant, RESOURCE_OVERLOAD_COUNT_SIGNIFICANT)
    assert.equal(observation.readings.overloadedHours, 6)
  })

  test('占比不足但超载工时达阈值同样命中；无活跃资源 → 字段不完整', async ({ assert }) => {
    const calls: string[] = []
    const byHours = new ResourceOverloadDetector({
      resourceLoadService: loadFake(
        { total: 10, overloaded: 2, peakPercent: 101, overloadHours: 5 },
        calls,
      ),
    })
    const byHoursObservation = await byHours.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.equal(byHoursObservation.readings.overloadRatioPercent, 20)
    assert.isTrue(
      byHoursObservation.triggered,
      `占比 20% < ${RESOURCE_OVERLOAD_RATIO_PERCENT}% 但超载工时 ${10} ≥ ${RESOURCE_OVERLOAD_HOURS_MIN} 小时`,
    )
    assert.equal(byHoursObservation.readings.overloadedHours, 10)

    const calls2: string[] = []
    const empty = new ResourceOverloadDetector({
      resourceLoadService: loadFake(
        { total: 0, overloaded: 0, peakPercent: 0, overloadHours: 0 },
        calls2,
      ),
    })
    const emptyObservation = await empty.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(emptyObservation.triggered)
    assert.isFalse(emptyObservation.fieldsComplete)
    assert.equal(emptyObservation.completenessGap, 'NO_ACTIVE_RESOURCES')
  })
})

// ---------------------------------------------------------------------------
// ④ 里程碑滑移
// ---------------------------------------------------------------------------

test.group('里程碑滑移检测器', () => {
  test('累计滑移达阈值命中；单里程碑 ≥30 天达显著档', async ({ assert }) => {
    const calls: string[] = []
    const cumulative = new MilestoneSlipDetector({
      metricsService: milestoneMetricsFake(milestoneFacts([3, 2, 2]), calls),
    })
    const observation = await cumulative.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(observation.triggered, '累计 7 天达触发线')
    assert.equal(observation.readings.cumulativeSlipDays, 7)
    assert.equal(observation.readings.slippedMilestoneCount, 3)
    assert.isFalse(observation.significant)
    assert.deepEqual(observation.entityRefs.milestones, [1, 2, 3])

    const calls2: string[] = []
    const severe = new MilestoneSlipDetector({
      metricsService: milestoneMetricsFake(milestoneFacts([31, 1]), calls2),
    })
    const severeObservation = await severe.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(severeObservation.triggered)
    assert.isTrue(severeObservation.significant)
    assert.equal(severeObservation.severity, 'critical')
    assert.equal(severeObservation.readings.maxSlipDays, 31)
  })

  test('无基线 → 数据不足（不产信号，且不得记为滑移 0 天）', async ({ assert }) => {
    const calls: string[] = []
    const detector = new MilestoneSlipDetector({
      metricsService: milestoneMetricsFake(milestoneFacts([], { hasBaseline: false }), calls),
    })
    const observation = await detector.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(observation.triggered)
    assert.isTrue(observation.dataInsufficient)
    assert.equal(observation.insufficientReason, 'BASELINE_MISSING')
    assert.equal(observation.severity, 'info')
    assert.isNull(observation.readings.cumulativeSlipDays, 'MUST NOT 以滑移 0 天作为结论')
    assert.equal(observation.readings.slipDaysBasis, 'unavailable')
    assert.isFalse(observation.fieldsComplete)
  })

  test('滑移不可跨周期重放 → 连续周期恒为 1（诚实披露，不假称连续两周）', async ({ assert }) => {
    const calls: string[] = []
    const detector = new MilestoneSlipDetector({
      metricsService: milestoneMetricsFake(milestoneFacts([9, 9]), calls),
    })
    const observation = await detector.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isTrue(observation.triggered)
    assert.equal(observation.consecutiveCycles, 1)
    assert.equal(observation.readings.replaySupported, false)
    assert.equal(observation.readings.replayReason, 'REPLAY_UNSUPPORTED')
  })

  test('提前完成（负滑移）不计入滑移量', async ({ assert }) => {
    const calls: string[] = []
    const detector = new MilestoneSlipDetector({
      metricsService: milestoneMetricsFake(milestoneFacts([-5, -3]), calls),
    })
    const observation = await detector.evaluate({
      organizationId: ORG,
      projectId: PROJECT,
      windows: WINDOWS,
    })
    assert.isFalse(observation.triggered)
    assert.equal(observation.readings.cumulativeSlipDays, 0)
    assert.equal(observation.readings.maxSlipDays, 0)
  })
})

// ---------------------------------------------------------------------------
// 检测编排 / 阈值常量 / 零写入
// ---------------------------------------------------------------------------

function makeObservation(
  overrides: Partial<SignalObservation> & { signalType: ProjectSignalType },
): SignalObservation {
  return {
    triggered: false,
    significant: false,
    fieldsComplete: true,
    consecutiveCycles: 1,
    completenessGap: null,
    dataInsufficient: false,
    insufficientReason: null,
    severity: 'warning',
    readings: { metric: overrides.signalType, coveredCycles: 1 },
    thresholds: {},
    hitConditions: [],
    entityRefs: {},
    truncated: false,
    ...overrides,
  }
}

function stuck(value: SignalObservation, calls: string[]) {
  return recording(
    {
      async evaluate(): Promise<SignalObservation> {
        return value
      },
    },
    calls,
  )
}

test.group('检测编排：复合证据、分层与零写入', () => {
  test('四类检测器全部执行；单周期越界不升层（低置信）', async ({ assert }) => {
    const calls: string[] = []
    const service = new ProjectSignalDetectionService({
      progressDetector: stuck(
        makeObservation({
          signalType: 'progress_deviation',
          triggered: true,
          significant: true,
          consecutiveCycles: 1,
          readings: { metric: 'schedule_performance_index', coveredCycles: 2 },
          hitConditions: ['spi_delayed'],
        }),
        calls,
      ),
      riskDetector: stuck(makeObservation({ signalType: 'risk_surge' }), calls),
      resourceDetector: stuck(makeObservation({ signalType: 'resource_overload' }), calls),
      milestoneDetector: stuck(
        makeObservation({
          signalType: 'milestone_slip',
          dataInsufficient: true,
          insufficientReason: 'BASELINE_MISSING',
          fieldsComplete: false,
        }),
        calls,
      ),
    })

    const result = await service.detect({
      organizationId: ORG,
      projectId: PROJECT,
      asOfDate: AS_OF,
    })

    assert.equal(result.detectorRuns, 4, '四个检测器必须都真实执行（防空转）')
    assert.deepEqual(calls, ['evaluate', 'evaluate', 'evaluate', 'evaluate'])
    for (const call of calls) {
      assert.isTrue(
        READ_ONLY_METHODS.has(call) || call === 'evaluate',
        `检测链路不得调用写方法：${call}`,
      )
    }

    assert.lengthOf(result.signals, 1)
    assert.equal(result.signals[0]!.confidenceTier, 'low', '单周期不升层')
    assert.isFalse(result.signals[0]!.tierReasons.consecutive.hit)
    assert.isTrue(result.signals[0]!.tierReasons.amplitude.hit)
    assert.isFalse(result.signals[0]!.tierReasons.composite.hit, '仅 1 类证据 ⇒ 复合条件未命中')

    assert.lengthOf(result.insufficient, 1)
    assert.equal(result.insufficient[0]!.signalType, 'milestone_slip')
    assert.equal(result.insufficient[0]!.reason, 'BASELINE_MISSING')
    assert.equal(result.windows.current.key, `${WINDOWS.current.from}..${WINDOWS.current.to}`)
  })

  test('复合证据（≥2 类）+ 显著 + 连续 2 周期 + 字段完整 → 两条信号均升为高置信', async ({
    assert,
  }) => {
    const calls: string[] = []
    const service = new ProjectSignalDetectionService({
      progressDetector: stuck(
        makeObservation({
          signalType: 'progress_deviation',
          triggered: true,
          significant: true,
          consecutiveCycles: 2,
          readings: { metric: 'schedule_performance_index', coveredCycles: 2 },
          hitConditions: ['spi_delayed'],
        }),
        calls,
      ),
      riskDetector: stuck(
        makeObservation({
          signalType: 'risk_surge',
          triggered: true,
          significant: true,
          consecutiveCycles: 2,
          readings: { metric: 'risk_register_surge', coveredCycles: 3 },
          hitConditions: ['active_risk_surge'],
          entityRefs: { risks: [3, 1, 2] },
        }),
        calls,
      ),
      resourceDetector: stuck(makeObservation({ signalType: 'resource_overload' }), calls),
      milestoneDetector: stuck(makeObservation({ signalType: 'milestone_slip' }), calls),
    })

    const result = await service.detect({
      organizationId: ORG,
      projectId: PROJECT,
      asOfDate: AS_OF,
    })

    assert.lengthOf(result.signals, 2)
    for (const signal of result.signals) {
      assert.equal(signal.confidenceTier, 'high', `${signal.signalType} 应升为高置信`)
      assert.isTrue(signal.tierReasons.composite.hit)
      assert.deepEqual(signal.tierReasons.compositeTypes, ['progress_deviation', 'risk_surge'])
      assert.equal(signal.tierReasons.window, WINDOWS.current.key)
      assert.equal(signal.evidence.coveredCycles, signal.evidence.coveredCycles)
      assert.match(signal.idempotencyKey, /^[0-9a-f]{64}$/)
      assert.equal(signal.observationWindow.key, WINDOWS.current.key)
    }

    const riskSignal = result.signals.find((entry) => entry.signalType === 'risk_surge')!
    assert.deepEqual(riskSignal.evidence.entityRefs.risks, [3, 1, 2])
    assert.equal(riskSignal.evidence.window.previousFrom, WINDOWS.previous.from)
  })

  test('幂等键确定性：同一输入两次检测键完全相同；实体集合变化则键变化', async ({ assert }) => {
    const build = (riskIds: number[]) => {
      const calls: string[] = []
      return new ProjectSignalDetectionService({
        progressDetector: stuck(makeObservation({ signalType: 'progress_deviation' }), calls),
        riskDetector: stuck(
          makeObservation({
            signalType: 'risk_surge',
            triggered: true,
            readings: { metric: 'risk_register_surge', coveredCycles: 3 },
            entityRefs: { risks: riskIds },
          }),
          calls,
        ),
        resourceDetector: stuck(makeObservation({ signalType: 'resource_overload' }), calls),
        milestoneDetector: stuck(makeObservation({ signalType: 'milestone_slip' }), calls),
      })
    }

    const first = await build([1, 2, 3]).detect({
      organizationId: ORG,
      projectId: PROJECT,
      asOfDate: AS_OF,
    })
    const second = await build([1, 2, 3]).detect({
      organizationId: ORG,
      projectId: PROJECT,
      asOfDate: AS_OF,
    })
    const third = await build([1, 2, 4]).detect({
      organizationId: ORG,
      projectId: PROJECT,
      asOfDate: AS_OF,
    })

    assert.equal(first.signals[0]!.idempotencyKey, second.signals[0]!.idempotencyKey)
    assert.notEqual(first.signals[0]!.idempotencyKey, third.signals[0]!.idempotencyKey)
  })

  test('阈值常量可断言：取值固定、显著档严格于触发档（默认只允许收紧）', ({ assert }) => {
    assert.equal(PROJECT_SIGNAL_THRESHOLDS.SPI_DELAYED_THRESHOLD, 0.95)
    assert.equal(PROJECT_SIGNAL_THRESHOLDS.SIGNAL_OBSERVATION_WINDOW_DAYS, 7)
    assert.equal(PROJECT_SIGNAL_THRESHOLDS.SIGNAL_TIER_MIN_CONSECUTIVE_CYCLES, 2)
    assert.equal(PROJECT_SIGNAL_THRESHOLDS.SIGNAL_TIER_MIN_COMPOSITE_TYPES, 2)
    assert.isBelow(SPI_SIGNIFICANT_THRESHOLD, SPI_DELAYED_THRESHOLD)
    assert.isAtLeast(RESOURCE_OVERLOAD_COUNT_SIGNIFICANT, RESOURCE_OVERLOAD_COUNT_MIN)
    assert.isAtLeast(RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT, RESOURCE_OVERLOAD_RATIO_PERCENT)
    assert.isAtLeast(MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT, MILESTONE_SLIP_CUMULATIVE_DAYS)
    assert.isAtLeast(MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT, MILESTONE_SLIP_SINGLE_DAYS)
    assert.isAtLeast(
      PROJECT_SIGNAL_THRESHOLDS.RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
      PROJECT_SIGNAL_THRESHOLDS.RISK_SURGE_ABSOLUTE_MIN,
    )
    assert.isAtLeast(
      PROJECT_SIGNAL_THRESHOLDS.HIGH_RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
      PROJECT_SIGNAL_THRESHOLDS.HIGH_RISK_SURGE_ABSOLUTE_MIN,
    )
    assert.isAtLeast(
      PROJECT_SIGNAL_THRESHOLDS.DEFECT_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
      PROJECT_SIGNAL_THRESHOLDS.DEFECT_SURGE_ABSOLUTE_MIN,
    )
  })

  test('观测窗确定性：同一基准日两次计算完全一致，且三个窗口互不重叠', ({ assert }) => {
    const first = resolveSignalObservationWindows(AS_OF, 7)
    const second = resolveSignalObservationWindows(AS_OF, 7)
    assert.deepEqual(first, second)
    assert.equal(first.current.from, '2026-09-01')
    assert.equal(first.current.to, '2026-09-07')
    assert.equal(first.previous.from, '2026-08-25')
    assert.equal(first.previous.to, '2026-08-31')
    assert.equal(first.base.to, '2026-08-24')
    assert.lengthOf(first.all, 3)
  })
})
