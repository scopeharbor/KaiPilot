import type {
  ProjectSignal,
  ProjectSignalEvidence,
  ProjectSignalSeverity,
  ProjectSignalTier,
  ProjectSignalType,
} from '@/lib/api/project-signals'

/**
 * 信号呈现层共用转换（v3-triz-contradiction-copilot W6 · tasks 6.1/6.2）。
 *
 * 本模块是**两处承载唯一一份**呈现口径（角色首页建议队列 / 项目空间信号卡，
 * design D10）：严重度双通道（颜色 + 文字）、证据摘要取键顺序、阈值与基期文案、
 * 分层理由文案、权限裁剪说明，全部在这里，禁止组件各写一套。
 *
 * 三条硬边界（design D9，护栏见 `__tests__/next-signal-*.test.*`）：
 * ① 只呈现团队 / 项目聚合口径读数，不构造任何按人拆分的度量、排名或告警；
 * ② 不消费打卡 / 考勤 / 独立工时日志类数据源（本模块只读信号契约字段）；
 * ③ 不生成「预警 / 告警」式煽动文案，只做描述性陈述。
 */

export const SIGNAL_TIER_LABELS: Record<ProjectSignalTier, string> = {
  low: '低置信',
  high: '高置信',
}

/** 严重度文字（颜色之外的第二通道，RL-15 状态双通道）。 */
export const SIGNAL_SEVERITY_LABELS: Record<ProjectSignalSeverity, string> = {
  info: '提示',
  warning: '关注',
  critical: '严重',
}

/** 证据读数键 → 中文标签（后端 detector 的 readings 键，逐一对齐）。 */
export const SIGNAL_READING_LABELS: Record<string, string> = {
  spi: '排程绩效指数 SPI',
  spiPrevious: '上一周期 SPI',
  sv: '排程偏差 SV（天）',
  svPrevious: '上一周期 SV（天）',
  scheduleStatus: '排程状态',
  plannedValue: '计划价值 PV',
  earnedValue: '挣值 EV',
  budgetAtCompletion: '完工预算 BAC',
  hasBaseline: '是否已建基线',
  activeRisksCurrent: '活跃登记项（本期）',
  activeRisksPrevious: '活跃登记项（上期）',
  activeRisksBase: '活跃登记项（基期）',
  activeRiskGrowthRatio: '活跃登记项环比增幅',
  newHighRisksCurrent: '新增高危项（本期）',
  newHighRisksPrevious: '新增高危项（上期）',
  newHighRiskGrowthRatio: '高危项环比增幅',
  newSevereDefectsCurrent: '新增严重缺陷（本期）',
  newSevereDefectsPrevious: '新增严重缺陷（上期）',
  severeDefectGrowthRatio: '严重缺陷环比增幅',
  resourceCount: '参与分配的资源数',
  overloadedResourceCount: '超载资源数',
  overloadedResourceCountPrevious: '超载资源数（上期）',
  overloadRatioPercent: '超载占比（%）',
  overloadRatioPercentPrevious: '超载占比（%，上期）',
  teamAverageUtilizationPercent: '团队平均分配比例（%）',
  peakAllocationPercent: '单资源峰值分配比例（%）',
  overloadedHours: '超载工作量（小时）',
  overloadedHoursPrevious: '超载工作量（小时，上期）',
  milestoneCount: '里程碑总数',
  baselineCoveredCount: '基线覆盖里程碑数',
  missingPlannedDateCount: '缺计划日里程碑数',
  slippedMilestoneCount: '滑移里程碑数',
  cumulativeSlipDays: '累计滑移（天）',
  maxSlipDays: '最大单条滑移（天）',
  slipDaysBasis: '滑移口径',
  baselineSavedAt: '基线保存时间',
  replaySupported: '支持历史重放',
  replayReason: '不支持重放原因',
  coveredCycles: '覆盖周期数',
}

/** 阈值键 → 中文标签。 */
export const SIGNAL_THRESHOLD_LABELS: Record<string, string> = {
  spiDelayed: 'SPI 滞后线',
  spiSignificant: 'SPI 显著档',
  svNegative: 'SV 参考线',
  riskGrowthRatio: '活跃登记项增幅阈值',
  riskAbsoluteMin: '活跃登记项绝对下限',
  highRiskGrowthRatio: '高危项增幅阈值',
  highRiskAbsoluteMin: '高危项绝对下限',
  defectGrowthRatio: '严重缺陷增幅阈值',
  defectAbsoluteMin: '严重缺陷绝对下限',
  referencePercent: '分配比例参考线（%）',
  ratioPercent: '超载占比阈值（%）',
  countMin: '超载资源数下限',
  hoursMin: '超载工作量下限（小时）',
  ratioPercentSignificant: '超载占比显著档（%）',
  countSignificant: '超载资源数显著档',
  peakAllocationPercentSignificant: '峰值分配显著档（%）',
  cumulativeDays: '累计滑移阈值（天）',
  singleDays: '单条滑移阈值（天）',
  cumulativeDaysSignificant: '累计滑移显著档（天）',
  singleDaysSignificant: '单条滑移显著档（天）',
}

/** 每个信号类型的首要读数键顺序（先展示最可解释的读数，不按对象键序碰运气）。 */
const PRIMARY_READING_KEYS: Record<ProjectSignalType, readonly string[]> = {
  progress_deviation: ['spi', 'sv', 'spiPrevious', 'svPrevious', 'scheduleStatus', 'coveredCycles'],
  risk_surge: [
    'activeRisksCurrent',
    'activeRiskGrowthRatio',
    'newHighRisksCurrent',
    'newSevereDefectsCurrent',
    'coveredCycles',
  ],
  resource_overload: [
    'overloadRatioPercent',
    'overloadedResourceCount',
    'resourceCount',
    'teamAverageUtilizationPercent',
    'overloadedHours',
  ],
  milestone_slip: [
    'cumulativeSlipDays',
    'maxSlipDays',
    'slippedMilestoneCount',
    'milestoneCount',
    'coveredCycles',
  ],
}

const PRIMARY_THRESHOLD_KEYS: Record<ProjectSignalType, readonly string[]> = {
  progress_deviation: ['spiDelayed', 'spiSignificant', 'svNegative'],
  risk_surge: ['riskGrowthRatio', 'riskAbsoluteMin', 'highRiskGrowthRatio', 'defectAbsoluteMin'],
  resource_overload: ['referencePercent', 'ratioPercent', 'countMin', 'hoursMin'],
  milestone_slip: ['cumulativeDays', 'singleDays', 'cumulativeDaysSignificant'],
}

const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  ahead: '超前',
  on_track: '按计划',
  delayed: '滞后',
}

export interface SignalEvidenceEntry {
  key: string
  label: string
  value: string
}

/** 数值格式化（整数直出，小数保留至多 2 位并去掉尾零）。 */
export function formatSignalNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(2)))
}

/** 读数键的中文标签；未知键回退键名本体（诚实披露，不造词）。 */
export function signalReadingLabel(key: string): string {
  return SIGNAL_READING_LABELS[key] ?? key
}

/** 阈值键的中文标签；未知键回退键名本体。 */
export function signalThresholdLabel(key: string): string {
  return SIGNAL_THRESHOLD_LABELS[key] ?? key
}

/** 单个读数值 → 展示文本（枚举码做中文平替，其余原样，不打分不排名）。 */
export function formatReadingValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return formatSignalNumber(value)
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (key === 'scheduleStatus' && typeof value === 'string') {
    return SCHEDULE_STATUS_LABELS[value] ?? value
  }
  return String(value)
}

function collectEntries(
  source: Record<string, unknown> | Record<string, number>,
  preferredKeys: readonly string[],
  limit: number,
  labelOf: (key: string) => string,
): SignalEvidenceEntry[] {
  const entries: SignalEvidenceEntry[] = []
  const seen = new Set<string>()
  const push = (key: string, value: unknown) => {
    if (seen.has(key) || entries.length >= limit) return
    seen.add(key)
    entries.push({ key, label: labelOf(key), value: formatReadingValue(key, value) })
  }
  for (const key of preferredKeys) {
    if (key in source) push(key, (source as Record<string, unknown>)[key])
    if (entries.length >= limit) return entries
  }
  // 首选键缺失（契约演进 / 裁剪后残留）时按对象键序补齐，绝不静默空列表。
  for (const [key, value] of Object.entries(source)) {
    if (key === 'metric') continue
    push(key, value)
    if (entries.length >= limit) break
  }
  return entries
}

/** 证据读数条目（按类型首选键顺序，最多 `limit` 条）。 */
export function primaryEvidenceReadings(
  evidence: ProjectSignalEvidence,
  limit = 4,
): SignalEvidenceEntry[] {
  return collectEntries(
    evidence.readings,
    PRIMARY_READING_KEYS[primaryTypeOf(evidence)],
    limit,
    signalReadingLabel,
  )
}

/** 证据 `metric` 码 → 四类信号之一（未知码按进度类回退，绝不抛错）。 */
function primaryTypeOf(evidence: ProjectSignalEvidence): ProjectSignalType {
  switch (evidence.metric) {
    case 'risk_register_surge':
      return 'risk_surge'
    case 'resource_allocation_overload':
      return 'resource_overload'
    case 'milestone_schedule_slip':
      return 'milestone_slip'
    default:
      return 'progress_deviation'
  }
}

/** 证据阈值条目（最多 `limit` 条）。 */
export function primaryEvidenceThresholds(
  evidence: ProjectSignalEvidence,
  limit = 3,
): SignalEvidenceEntry[] {
  const preferred = PRIMARY_THRESHOLD_KEYS[primaryTypeOf(evidence)]
  return collectEntries(evidence.thresholds, preferred, limit, signalThresholdLabel)
}

/** 观测窗与可比基期文案（读数 / 阈值 / 基期三件套之一）。 */
export function evidenceWindowLabel(evidence: ProjectSignalEvidence): string {
  const { from, to, previousFrom, previousTo } = evidence.window
  return `本期 ${from} ~ ${to} · 基期 ${previousFrom} ~ ${previousTo}`
}

/** 数据覆盖周期数文案。 */
export function evidenceCoverageLabel(evidence: ProjectSignalEvidence): string {
  return `覆盖 ${evidence.coveredCycles} 个周期（含可比基期）`
}

export interface SignalTierConditionView {
  key: 'amplitude' | 'consecutive' | 'completeness' | 'composite'
  label: string
  hit: boolean
  detail: string | null
}

const TIER_CONDITION_LABELS: Record<SignalTierConditionView['key'], string> = {
  amplitude: '越界幅度达显著档',
  consecutive: '连续 ≥ 2 个采样周期',
  completeness: '关键字段完整',
  composite: '存在复合证据（同窗 ≥ 2 类）',
}

/**
 * 高置信四条件命中情况（spec「置信分层与呈现路由」第 5 条：分层理由可读）。
 * 缺字段时按未命中呈现（fail-closed），绝不臆测命中。
 */
export function tierConditionViews(signal: ProjectSignal): SignalTierConditionView[] {
  const reasons = signal.tierReasons ?? {}
  return (Object.keys(TIER_CONDITION_LABELS) as SignalTierConditionView['key'][]).map((key) => {
    const condition = reasons[key]
    return {
      key,
      label: TIER_CONDITION_LABELS[key],
      hit: condition?.hit === true,
      detail: condition?.hit === true || condition?.detail ? (condition?.detail ?? null) : null,
    }
  })
}

/** 分层理由一句话摘要（建议队列用「为什么是低置信」，信号卡用四条件全览）。 */
export function tierSummaryText(signal: ProjectSignal): string {
  const views = tierConditionViews(signal)
  const hitCount = views.filter((view) => view.hit).length
  if (signal.confidenceTier === 'high') {
    return `高置信：四条件命中 ${hitCount} / ${views.length}`
  }
  const missed = views.filter((view) => !view.hit).map((view) => view.label)
  if (missed.length === 0) {
    return '低置信：条件命中情况以服务端分层为准'
  }
  return `低置信：未命中 ${missed.join(' · ')}`
}

/**
 * 权限裁剪说明：证据被裁剪时给中性说明（不泄露受限数据内容，只说缺哪个领域权限）。
 * 未裁剪返回 null。
 */
export function evidenceRedactionNotice(evidence: {
  evidenceRedacted: boolean
  requiredPermission: string
}): string | null {
  if (!evidence.evidenceRedacted) return null
  return `证据已按权限裁剪：需 ${evidence.requiredPermission} 权限查看明细`
}

/** 严重度徽标样式（颜色 + 文字双通道，RL-15）。 */
export function signalSeverityChipClass(severity: ProjectSignalSeverity): string {
  switch (severity) {
    case 'critical':
      return 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]'
    case 'warning':
      return 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]'
    default:
      return 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]'
  }
}

/** 分层徽标样式：高置信用强调色，低置信保持中性（不制造紧张感）。 */
export function signalTierChipClass(tier: ProjectSignalTier): string {
  return tier === 'high'
    ? 'border-[var(--nx-accent)] text-[var(--nx-accent)]'
    : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]'
}
