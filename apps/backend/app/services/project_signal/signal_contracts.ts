/**
 * v3-triz-contradiction-copilot W3 —— 被动雷达信号契约（design D5/D8/D9/D10）。
 *
 * 契约是「检测 → 分层 → 持久化 → 两处承载」共用的**唯一一份**形状（D10：低置信建议队列与
 * 高置信信号卡消费同一数据契约与同一权限裁剪逻辑，禁止各写一套判据）。
 *
 * 三条硬边界（D9）落在类型层：
 * ① `PROJECT_SIGNAL_TYPES` 是闭集且不含任何 S 曲线 / 进化法则阶段类取值（二期候选）；
 * ② 证据只接受数值、枚举码与实体 ID（无时间打卡 / 考勤 / 独立工时日志维度）；
 * ③ 证据与呈现契约只到团队 / 项目聚合粒度（无个人维度度量或排名键）。
 */

/** 四类硬信号（且仅限这四类，spec「四类硬信号检测」）。 */
export const PROJECT_SIGNAL_TYPES = [
  'progress_deviation',
  'risk_surge',
  'resource_overload',
  'milestone_slip',
] as const

export type ProjectSignalType = (typeof PROJECT_SIGNAL_TYPES)[number]

/** 中文标签（呈现层直用，不引入第二份文案映射）。 */
export const PROJECT_SIGNAL_TYPE_LABELS: Record<ProjectSignalType, string> = {
  progress_deviation: '进度偏差',
  risk_surge: '风险/缺陷突变',
  resource_overload: '资源负载过载',
  milestone_slip: '里程碑滑移',
}

/** 置信分层：低置信 → 角色首页建议队列；高置信 → 项目空间信号卡。 */
export const PROJECT_SIGNAL_TIERS = ['low', 'high'] as const
export type ProjectSignalTier = (typeof PROJECT_SIGNAL_TIERS)[number]

/** 状态机闭集：`open → dismissed / adopted / expired`。 */
export const PROJECT_SIGNAL_STATUSES = ['open', 'dismissed', 'adopted', 'expired'] as const
export type ProjectSignalStatus = (typeof PROJECT_SIGNAL_STATUSES)[number]

export const PROJECT_SIGNAL_SEVERITIES = ['info', 'warning', 'critical'] as const
export type ProjectSignalSeverity = (typeof PROJECT_SIGNAL_SEVERITIES)[number]

export function isProjectSignalType(value: unknown): value is ProjectSignalType {
  return typeof value === 'string' && (PROJECT_SIGNAL_TYPES as readonly string[]).includes(value)
}

export function isProjectSignalTier(value: unknown): value is ProjectSignalTier {
  return typeof value === 'string' && (PROJECT_SIGNAL_TIERS as readonly string[]).includes(value)
}

export function isProjectSignalStatus(value: unknown): value is ProjectSignalStatus {
  return typeof value === 'string' && (PROJECT_SIGNAL_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 观测窗
// ---------------------------------------------------------------------------

export interface SignalWindowRange {
  /** 窗口起始日（含） */
  from: string
  /** 窗口结束日（含） */
  to: string
  /** 稳定键 `from..to`（幂等与库层唯一约束的组成项） */
  key: string
}

export interface SignalObservationWindows {
  days: number
  /** 本次检测窗口 */
  current: SignalWindowRange
  /** 上一采样周期 */
  previous: SignalWindowRange
  /** 上上周期（仅用于计算 `previous` 的环比基期，使「连续 ≥2 周期」可复算） */
  base: SignalWindowRange
  /** 三个窗口由近及远的列表（[current, previous, base]） */
  all: SignalWindowRange[]
}

// ---------------------------------------------------------------------------
// 检测输出（未持久化）
// ---------------------------------------------------------------------------

/** 命中的条件码（可读、可断言；不引入长文本）。 */
export type SignalHitCondition =
  | 'spi_delayed'
  | 'active_risk_surge'
  | 'high_risk_surge'
  | 'severe_defect_surge'
  | 'resource_overload'
  | 'milestone_slip'

/** 单个检测器的观测结论（只读检测的产物，尚未分层、尚未落库）。 */
export interface SignalObservation {
  signalType: ProjectSignalType
  /** 是否越界（命中触发阈值） */
  triggered: boolean
  /** 越界幅度是否达到「显著档」（高置信条件 ①） */
  significant: boolean
  /** 关键字段是否完整（高置信条件 ③） */
  fieldsComplete: boolean
  /** 连续越界采样周期数（1 = 仅本周期；不可重放的信号源恒为 1） */
  consecutiveCycles: number
  /** 关键字段不完整的原因码（fieldsComplete=false 时给出） */
  completenessGap: string | null
  /** 数据不足（例如无甘特基线）→ 不产信号，且 MUST NOT 记为「滑移 0」 */
  dataInsufficient: boolean
  insufficientReason: string | null
  severity: ProjectSignalSeverity
  /** 可复算读数（数值 / 枚举 / 有界 ID 数组；无长文本、无个人维度） */
  readings: Record<string, unknown>
  /** 命中的阈值常量（键值对，测试可直接断言） */
  thresholds: Record<string, number>
  hitConditions: SignalHitCondition[]
  /** 证据引用的实体 ID（风险 / 议题 / 里程碑；资源过载不留个人实体 ID，D9 ③） */
  entityRefs: {
    risks?: number[]
    issues?: number[]
    milestones?: number[]
  }
  /** 事实读取被上限截断（诚实披露，同时使字段完整性判定为未命中） */
  truncated: boolean
}

/** 高置信四条件中单条的命中情况（spec：分层理由 MUST 可读到四项命中情况）。 */
export interface SignalTierConditionReason {
  hit: boolean
  /** 机器可读依据（枚举码 + 数值），供审计与「为什么它是高置信」展示。 */
  detail: string
}

export interface SignalTierReasons {
  amplitude: SignalTierConditionReason
  consecutive: SignalTierConditionReason
  completeness: SignalTierConditionReason
  composite: SignalTierConditionReason
  /** 本次分层评估的观测窗与时间戳 */
  window: string
  evaluatedAt: string
  compositeTypes: ProjectSignalType[]
  /** 分层发生变更时保留的痕迹（旧分层），未变更为 null */
  previousTier: ProjectSignalTier | null
}

/** 低敏证据载荷（数值 / 阈值 / 基期 / 覆盖周期数 / 实体 ID）。 */
export interface ProjectSignalEvidence {
  /** 指标名（如 `schedule_performance_index`） */
  metric: string
  window: {
    from: string
    to: string
    previousFrom: string
    previousTo: string
    days: number
  }
  readings: Record<string, unknown>
  thresholds: Record<string, number>
  /** 数据覆盖周期数（1–3：本周期 + 可比基期） */
  coveredCycles: number
  hitConditions: SignalHitCondition[]
  /** 同观测窗内命中的信号类型集合（复合证据，高置信条件 ④ 的可读依据） */
  compositeTypes: ProjectSignalType[]
  entityRefs: SignalObservation['entityRefs']
  truncated: boolean
  dataInsufficient?: boolean
  insufficientReason?: string | null
}

/** 分层完成后的候选信号（尚未落库）。 */
export interface DetectedProjectSignal {
  signalType: ProjectSignalType
  confidenceTier: ProjectSignalTier
  tierReasons: SignalTierReasons
  severity: ProjectSignalSeverity
  evidence: ProjectSignalEvidence
  idempotencyKey: string
  observationWindow: SignalWindowRange
}

/** 数据不足的检测结论（不产信号，必须可被上层读到「为什么没有信号」）。 */
export interface SignalInsufficientConclusion {
  signalType: ProjectSignalType
  reason: string
  window: string
}

export interface ProjectSignalDetectionResult {
  organizationId: number
  projectId: number
  asOfDate: string
  windows: SignalObservationWindows
  /** 命中并完成分层的候选信号 */
  signals: DetectedProjectSignal[]
  /** 未命中（含数据不足）的检测器结论，便于诊断「雷达为什么没动静」 */
  skipped: Array<{
    signalType: ProjectSignalType
    triggered: boolean
    dataInsufficient: boolean
    reason: string
  }>
  insufficient: SignalInsufficientConclusion[]
  /** 实际执行的检测器数量（非空转自证：四个检测器全部评过一遍） */
  detectorRuns: number
}

// ---------------------------------------------------------------------------
// 观测窗计算
// ---------------------------------------------------------------------------

function isoDay(date: string, offsetDays: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed)) {
    throw new Error(`观测窗基准日非法：${date}`)
  }
  return new Date(parsed + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

export function toWindowRange(from: string, to: string): SignalWindowRange {
  return { from, to, key: `${from}..${to}` }
}

/**
 * 由基准日推导本周期 / 上一周期 / 上上周期三个闭区间观测窗。
 * 全部由日期确定性算出（无随机数、无当前时间参与唯一性）。
 */
export function resolveSignalObservationWindows(
  asOfDate: string,
  days: number,
): SignalObservationWindows {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`观测窗长度非法：${days}`)
  }
  const currentTo = asOfDate
  const currentFrom = isoDay(asOfDate, -(days - 1))
  const previousTo = isoDay(currentFrom, -1)
  const previousFrom = isoDay(previousTo, -(days - 1))
  const baseTo = isoDay(previousFrom, -1)
  const baseFrom = isoDay(baseTo, -(days - 1))

  return {
    days,
    current: toWindowRange(currentFrom, currentTo),
    previous: toWindowRange(previousFrom, previousTo),
    base: toWindowRange(baseFrom, baseTo),
    all: [
      toWindowRange(currentFrom, currentTo),
      toWindowRange(previousFrom, previousTo),
      toWindowRange(baseFrom, baseTo),
    ],
  }
}

/** 闭区间窗口 → 右开区间上界（用于 `created_at < 上界` 的时间窗查询，避免边界重复计数）。 */
export function windowExclusiveEnd(toDate: string): string {
  return `${isoDay(toDate, 1)}T00:00:00.000Z`
}

/** 闭区间窗口 → 左闭下界（当日 00:00 UTC）。 */
export function windowInclusiveStart(fromDate: string): string {
  return `${fromDate}T00:00:00.000Z`
}

/** 观测窗的过期时刻（窗口结束日 + TTL 天，当日末刻）。 */
export function windowExpiry(toDate: string, ttlDays: number): string {
  return `${isoDay(toDate, ttlDays)}T23:59:59.000Z`
}
