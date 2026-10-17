/**
 * v3-triz-contradiction-copilot W3 任务 3.2 —— 被动雷达阈值常量模块（单一事实源）。
 *
 * spec「四类硬信号检测」第 7 条：阈值 MUST 集中定义、可测试断言，MUST NOT 散落在业务代码里；
 * design D8：阈值集中定义（单一常量模块）+ 默认值只允许收紧。
 *
 * 取值依据（逐条）：
 * - 进度偏差：沿用既有 `ProjectEvmService.scheduleStatus` 的 `delayed = SPI < 0.95` 语义
 *   （避免自造阈值口径），不另设「越界线」；显著档取 0.85（较越界线再降 10 个点，幅值明显）。
 * - 风险与缺陷突变：tasks 3.2 建议值「环比增长 ≥ 50% 且绝对新增 ≥ 3」；显著档取「翻倍且
 *   绝对新增加码」，避免小基数（1 → 2）把 100% 增长率放大成显著。
 * - 资源过载：单资源分配比例 > 100% 即过载（与 `triz_context_pack_service` 同款判定）；
 *   项目级触发要求「超载资源 ≥ 2 个」且「超载占比 ≥ 25% 或窗口内超载工时 ≥ 8 小时」，
 *   单点噪音（1 人短期超载）不产信号。
 * - 里程碑滑移：相对甘特基线的累计正滑移 ≥ 7 天触发、≥ 14 天显著；单里程碑 ≥ 14 天触发、
 *   ≥ 30 天显著（一个迭代 ~2 周，7 天滑移已足以影响里程碑序列）。
 * - 连续周期：design D8 ② 为「≥ 2 个采样周期」；复合证据：design D8 ④ 为「≥ 2 类」。
 * - 观测窗：7 天（周节奏，与 risk_workbench 的 30 天趋势同量级但更短，保证「连续 2 周期」≈ 2 周）。
 */

// ── 观测窗与生命周期 ───────────────────────────────────────────────────
/** 单个观测窗长度（天）。 */
export const SIGNAL_OBSERVATION_WINDOW_DAYS = 7
/** 信号过期 TTL：观测窗结束后保留的活跃天数（超期未被处理即转 expired）。 */
export const SIGNAL_EXPIRY_TTL_DAYS = 14

// ── 置信分层（design D8：四条件缺一不可） ────────────────────────────────
/** 高置信条件 ②：连续越界采样周期数下限。 */
export const SIGNAL_TIER_MIN_CONSECUTIVE_CYCLES = 2
/** 高置信条件 ④：同观测窗内复合证据类型数下限。 */
export const SIGNAL_TIER_MIN_COMPOSITE_TYPES = 2

// ── 证据与读取边界 ─────────────────────────────────────────────────────
/** 证据中引用的实体 ID 条数上限（低敏 + 有界；超出即截断并诚实披露）。 */
export const SIGNAL_EVIDENCE_ENTITY_REF_LIMIT = 50
/** 单项目事实行数上限（风险 / 议题各一次读取；超限即标记 truncated 并判字段不完整）。 */
export const SIGNAL_FACT_ROW_LIMIT = 2000
/** 单次过期扫描的处理上限（按最早超期优先；余量留待下次扫描）。 */
export const SIGNAL_EXPIRY_SWEEP_LIMIT = 500

// ── ① 进度偏差 ─────────────────────────────────────────────────────────
/** 越界线：与 `ProjectEvmService` 的 `scheduleStatus='delayed'` 同源（SPI < 0.95）。 */
export const SPI_DELAYED_THRESHOLD = 0.95
/** 显著档：SPI < 0.85（越界线再降 10 个点）。 */
export const SPI_SIGNIFICANT_THRESHOLD = 0.85
/** 进度偏差 MUST 同时要求 SV < 0（spec 第 1 条）。 */
export const SV_NEGATIVE_THRESHOLD = 0

// ── ② 风险与缺陷突变 ───────────────────────────────────────────────────
/** 活跃风险数环比增长阈值。 */
export const RISK_SURGE_GROWTH_RATIO = 0.5
/** 活跃风险数环比绝对新增下限。 */
export const RISK_SURGE_ABSOLUTE_MIN = 3
export const RISK_SURGE_SIGNIFICANT_GROWTH_RATIO = 1
export const RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN = 5

/** 高危风险（`risk_level ∈ high/critical`）新增环比阈值。 */
export const HIGH_RISK_SURGE_GROWTH_RATIO = 0.5
export const HIGH_RISK_SURGE_ABSOLUTE_MIN = 2
export const HIGH_RISK_SURGE_SIGNIFICANT_GROWTH_RATIO = 1
export const HIGH_RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN = 4

/** 严重缺陷（`issues.type='bug' ∧ severity ∈ critical/major`）新增环比阈值。 */
export const DEFECT_SURGE_GROWTH_RATIO = 0.5
export const DEFECT_SURGE_ABSOLUTE_MIN = 3
export const DEFECT_SURGE_SIGNIFICANT_GROWTH_RATIO = 1
export const DEFECT_SURGE_SIGNIFICANT_ABSOLUTE_MIN = 5

/** 活跃风险闭集（与 `RiskWorkbenchService` 同源，避免第二套口径）。 */
export const ACTIVE_RISK_STATUSES = ['identified', 'analyzing', 'mitigating'] as const
/** 高危风险级别闭集（design 待核实清单第 6 项：`risk_level IN ('high','critical')`）。 */
export const HIGH_RISK_LEVELS = ['high', 'critical'] as const
/** 严重缺陷类型闭集（依 design 第 6 项核实结论：`type='bug'`）。 */
export const SEVERE_DEFECT_TYPES = ['bug'] as const
/** 严重缺陷严重度闭集。 */
export const SEVERE_DEFECT_SEVERITIES = ['critical', 'major'] as const
/** 风险关闭事件闭集（`risk_histories.event_type`，与 `RiskWorkbenchService.getTrend` 同源）。 */
export const RISK_CLOSED_EVENT_TYPES = ['closed'] as const

// ── ③ 资源过载 ─────────────────────────────────────────────────────────
/** 过载判定线：单资源单日分配比例 > 100%（与既有上下文包判定同款）。 */
export const RESOURCE_OVERLOAD_REFERENCE_PERCENT = 100
/** 触发线：项目内超载资源占比下限（%）。 */
export const RESOURCE_OVERLOAD_RATIO_PERCENT = 25
/** 触发线：项目内超载资源个数下限（单点超载不产信号）。 */
export const RESOURCE_OVERLOAD_COUNT_MIN = 2
/** 触发线：窗口内超载工时合计下限（小时）——「超载工作量」维度。 */
export const RESOURCE_OVERLOAD_HOURS_MIN = 8
/** 显著档：超载资源占比 ≥ 50%。 */
export const RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT = 50
/** 显著档：超载资源个数 ≥ 3。 */
export const RESOURCE_OVERLOAD_COUNT_SIGNIFICANT = 3
/** 显著档：单资源峰值分配比例 ≥ 150%。 */
export const RESOURCE_PEAK_ALLOCATION_PERCENT_SIGNIFICANT = 150

// ── ④ 里程碑滑移 ───────────────────────────────────────────────────────
/** 触发线：相对基线的累计正滑移（天）。 */
export const MILESTONE_SLIP_CUMULATIVE_DAYS = 7
/** 触发线：单里程碑正滑移（天）。 */
export const MILESTONE_SLIP_SINGLE_DAYS = 14
/** 显著档：累计正滑移（天）。 */
export const MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT = 14
/** 显著档：单里程碑正滑移（天）。 */
export const MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT = 30

/** 无基线时的数据不足原因码（spec：MUST NOT 以「滑移 0 天」作为结论）。 */
export const MILESTONE_BASELINE_MISSING = 'BASELINE_MISSING'

/** 里程碑滑移不可跨周期重放的原因码（一期无计划变更历史，诚实披露而非假称连续）。 */
export const MILESTONE_REPLAY_UNSUPPORTED = 'REPLAY_UNSUPPORTED'

/** 阈值常量快照（测试直接断言取值与「只允许收紧」的相对关系）。 */
export const PROJECT_SIGNAL_THRESHOLDS = {
  SIGNAL_OBSERVATION_WINDOW_DAYS,
  SIGNAL_EXPIRY_TTL_DAYS,
  SIGNAL_TIER_MIN_CONSECUTIVE_CYCLES,
  SIGNAL_TIER_MIN_COMPOSITE_TYPES,
  SIGNAL_EVIDENCE_ENTITY_REF_LIMIT,
  SIGNAL_FACT_ROW_LIMIT,
  SPI_DELAYED_THRESHOLD,
  SPI_SIGNIFICANT_THRESHOLD,
  SV_NEGATIVE_THRESHOLD,
  RISK_SURGE_GROWTH_RATIO,
  RISK_SURGE_ABSOLUTE_MIN,
  RISK_SURGE_SIGNIFICANT_GROWTH_RATIO,
  RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
  HIGH_RISK_SURGE_GROWTH_RATIO,
  HIGH_RISK_SURGE_ABSOLUTE_MIN,
  HIGH_RISK_SURGE_SIGNIFICANT_GROWTH_RATIO,
  HIGH_RISK_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
  DEFECT_SURGE_GROWTH_RATIO,
  DEFECT_SURGE_ABSOLUTE_MIN,
  DEFECT_SURGE_SIGNIFICANT_GROWTH_RATIO,
  DEFECT_SURGE_SIGNIFICANT_ABSOLUTE_MIN,
  RESOURCE_OVERLOAD_REFERENCE_PERCENT,
  RESOURCE_OVERLOAD_RATIO_PERCENT,
  RESOURCE_OVERLOAD_COUNT_MIN,
  RESOURCE_OVERLOAD_HOURS_MIN,
  RESOURCE_OVERLOAD_RATIO_PERCENT_SIGNIFICANT,
  RESOURCE_OVERLOAD_COUNT_SIGNIFICANT,
  RESOURCE_PEAK_ALLOCATION_PERCENT_SIGNIFICANT,
  MILESTONE_SLIP_CUMULATIVE_DAYS,
  MILESTONE_SLIP_SINGLE_DAYS,
  MILESTONE_SLIP_CUMULATIVE_DAYS_SIGNIFICANT,
  MILESTONE_SLIP_SINGLE_DAYS_SIGNIFICANT,
} as const

export type ProjectSignalThresholdKey = keyof typeof PROJECT_SIGNAL_THRESHOLDS

/**
 * 环比（增长）判定：任意一侧数据缺失时按「无基期」处理——基期为 0 且有实质新增视为命中，
 * 否则不命中（保守：缺基期不升级为高置信）。
 */
export function isSurgeHit(input: {
  current: number
  previous: number
  growthRatio: number
  absoluteMin: number
}): boolean {
  const { current, previous, growthRatio, absoluteMin } = input
  const delta = current - previous
  if (delta < absoluteMin) return false
  if (previous === 0) return current >= absoluteMin
  return delta / previous >= growthRatio
}

/** 环比增长率（基期为 0 且当前为 0 → 0；基期为 0 且有新增 → 返回 null 表示不可比）。 */
export function surgeGrowth(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Number(((current - previous) / previous).toFixed(4))
}
