/**
 * v3-ui-next-org-portfolio-domains W5 · tasks 5.6 —— 资源需求预测展示层纯函数适配器。
 *
 * 新轨需求预测工作台（/next/organization/resource-demand-forecasting）的呈现侧纯函数底座：
 * - 预测窗口/粒度中文标签与 URL 状态（view/granularity/startDate/endDate）解析序列化
 *   ——URL query 是筛选唯一事实来源（restorable filters，design Decision 5）；
 * - demand-curves 点序列化：按 bucketStart 聚合（角色/技能/项目维度桶）成曲线数据点
 *   数组，供 echarts-core 折线渲染；
 * - 置信度档位（high/medium/low/unknown）与预测告警码（10 类 FORECAST_WARNING_CODES）
 *   中文标签与徽标语义色（全部 `--nx-*` 既有令牌固定 rgba 展开，杜绝臆造令牌）；
 * - 驱动（项目/技能）标签与数值格式化：脱敏判定中性呈现、工时/占比/缺口格式化；
 * - gap-analysis 桶格式化：缺口类型/方向标签色阶、瀑布桶聚合（短缺/盈余小时）、
 *   维度聚合行模型（供高密度表格渲染）。
 *
 * 本文件为纯计算层：零网络、零 DOM、零 store 依赖。
 */
import type {
  ForecastConfidenceBand,
  ForecastDemandCurve,
  ForecastGapAnalysis,
  ForecastGapEntry,
  ForecastGapType,
  ForecastGranularity,
  ForecastLoadStatus,
  ForecastMetricBucket,
  ForecastProjectBucket,
  ForecastProjectDriver,
  ForecastRedactionState,
  ForecastRoleBucket,
  ForecastSkillBucket,
  ForecastSkillDriver,
  ForecastWarningCode,
  ResourceDemandForecastingMetricKey,
} from '@aiproj/types'
import {
  FORECAST_GRANULARITIES,
  FORECAST_GRANULARITY_VALUES,
  FORECAST_LOAD_STATUSES,
  FORECAST_MAX_WINDOW_WEEKS,
  FORECAST_METHODS,
} from '@aiproj/types'

// ─── 常量与默认窗口 ───────────────────────────────────────────────────────

export const FORECAST_DEFAULT_GRANULARITY: ForecastGranularity = FORECAST_GRANULARITIES.WEEK

/** 预测窗口默认长度：12 周（对齐 FORECAST_MAX_WINDOW_WEEKS）。 */
export const FORECAST_DEFAULT_WINDOW_DAYS = FORECAST_MAX_WINDOW_WEEKS * 7

/** 今天（本地日历日）→ 默认窗口起始。 */
export function defaultForecastStartDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 今天 + N 天 → 默认窗口结束。 */
export function defaultForecastEndDate(
  now: Date = new Date(),
  days: number = FORECAST_DEFAULT_WINDOW_DAYS,
): string {
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`
}

/** 默认预测窗口（{startDate,endDate}，组件缺省与测试共用）。 */
export function createDefaultForecastWindow(now?: Date): {
  startDate: string
  endDate: string
} {
  return { startDate: defaultForecastStartDate(now), endDate: defaultForecastEndDate(now) }
}

// ─── 中文标签映射 ─────────────────────────────────────────────────────────

/** 粒度 → 中文短标签。 */
export const DEMAND_GRANULARITY_LABELS: Record<ForecastGranularity, string> = {
  day: '日',
  week: '周',
  month: '月',
}

/** 粒度筛选选项。 */
export const DEMAND_GRANULARITY_OPTIONS: ReadonlyArray<{
  value: ForecastGranularity
  label: string
}> = [
  { value: 'week', label: '按周' },
  { value: 'day', label: '按日' },
  { value: 'month', label: '按月' },
]

/** 负载状态 → 中文短标签。 */
export const DEMAND_LOAD_STATUS_LABELS: Record<ForecastLoadStatus, string> = {
  idle: '闲置',
  normal: '正常',
  high: '偏高',
  overloaded: '过载',
}

/** 预测方法 → 中文标签。 */
export const DEMAND_METHOD_LABELS: Record<string, string> = {
  [FORECAST_METHODS.DETERMINISTIC_BUCKET]: '确定性分桶',
  [FORECAST_METHODS.TREND_PROJECTION]: '趋势外推',
  [FORECAST_METHODS.MOVING_AVERAGE]: '移动平均',
}

export function demandMethodLabel(method: string | undefined | null): string {
  if (!method) return '—'
  return DEMAND_METHOD_LABELS[method] ?? method
}

// ─── 数值格式化 ───────────────────────────────────────────────────────────

/** 工时小时数（四舍五入 + 千分位；无符号）。 */
export function formatDemandHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—'
  return `${Math.round(hours).toLocaleString('zh-CN')}h`
}

/** 占比（0-1）→ 百分比（四舍五入整数）。 */
export function formatDemandPercentRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—'
  return `${Math.round(ratio * 100)}%`
}

/** 缺口小时带符号（shortage 短缺为负向缺口，前缀 '-'）。 */
export function formatSignedGapHours(gapHours: number, direction: 'shortage' | 'surplus'): string {
  const rounded = Math.round(gapHours).toLocaleString('zh-CN')
  return direction === 'shortage' ? `-${rounded}h` : `+${rounded}h`
}

/** 纯数字计数（千分位）。 */
export function formatDemandCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return '—'
  return Math.round(count).toLocaleString('zh-CN')
}

/** 时间戳/日期 → YYYY-MM-DD（UTC 日历日）。 */
export function formatForecastDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 窗口文案（startDate ~ endDate）。 */
export function formatForecastWindow(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  return `${formatForecastDate(start)} ~ ${formatForecastDate(end)}`
}

// ─── 置信度档位徽标 ───────────────────────────────────────────────────────

/** 置信度档位 → 中文标签。 */
export const DEMAND_CONFIDENCE_LABELS: Record<ForecastConfidenceBand, string> = {
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
}

/** 置信度徽标语义色（success/warning/警戒橙红/中性）。 */
const CONFIDENCE_CHIP_TEXT: Record<ForecastConfidenceBand, string> = {
  high: 'text-[var(--nx-status-success)]',
  medium: 'text-[var(--nx-status-warning)]',
  low: 'text-[var(--nx-chart-5)]',
  unknown: 'text-[var(--nx-text-muted)]',
}

const CONFIDENCE_CHIP_BORDER_BG: Record<ForecastConfidenceBand, string> = {
  high: 'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)]',
  medium: 'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)]',
  low: 'border-[rgba(248,113,113,0.45)] bg-[rgba(248,113,113,0.14)]',
  unknown: 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]',
}

export interface DemandConfidenceMeta {
  band: ForecastConfidenceBand
  label: string
  chipClass: string
}

export const DEMAND_CONFIDENCE_META: Record<ForecastConfidenceBand, DemandConfidenceMeta> = {
  high: {
    band: 'high',
    label: DEMAND_CONFIDENCE_LABELS.high,
    chipClass: `${CONFIDENCE_CHIP_BORDER_BG.high} ${CONFIDENCE_CHIP_TEXT.high}`,
  },
  medium: {
    band: 'medium',
    label: DEMAND_CONFIDENCE_LABELS.medium,
    chipClass: `${CONFIDENCE_CHIP_BORDER_BG.medium} ${CONFIDENCE_CHIP_TEXT.medium}`,
  },
  low: {
    band: 'low',
    label: DEMAND_CONFIDENCE_LABELS.low,
    chipClass: `${CONFIDENCE_CHIP_BORDER_BG.low} ${CONFIDENCE_CHIP_TEXT.low}`,
  },
  unknown: {
    band: 'unknown',
    label: DEMAND_CONFIDENCE_LABELS.unknown,
    chipClass: `${CONFIDENCE_CHIP_BORDER_BG.unknown} ${CONFIDENCE_CHIP_TEXT.unknown}`,
  },
}

/** 未知档位回退中性。 */
export function confidenceMetaOf(
  band: ForecastConfidenceBand | undefined | null,
): DemandConfidenceMeta {
  if (band && DEMAND_CONFIDENCE_META[band]) return DEMAND_CONFIDENCE_META[band]
  return DEMAND_CONFIDENCE_META.unknown
}

/** 多桶置信度收敛：取最不确定档位（worst），空列表回退 unknown。 */
export function worstConfidence(bands: readonly ForecastConfidenceBand[]): ForecastConfidenceBand {
  if (bands.length === 0) return 'unknown'
  const rank: Record<ForecastConfidenceBand, number> = { high: 0, medium: 1, low: 2, unknown: 3 }
  let worst: ForecastConfidenceBand = 'unknown'
  let worstRank = -1
  for (const band of bands) {
    const r = rank[band] ?? 3
    if (r > worstRank) {
      worstRank = r
      worst = band
    }
  }
  return worst
}

// ─── 预测告警码徽标 ───────────────────────────────────────────────────────

/** 告警码 → 中文标签（与旧轨 WARNING_LABELS 同文案）。 */
export const DEMAND_WARNING_LABELS: Record<ForecastWarningCode, string> = {
  INSUFFICIENT_HISTORY: '历史数据不足',
  STALE_SOURCE: '源数据过期',
  PARTIAL_VISIBILITY: '部分可见',
  CACHE_DEGRADED: '缓存降级',
  AI_UNAVAILABLE: 'AI 不可用',
  FEATURE_DISABLED: '功能已禁用',
  DIMENSION_REDACTED: '维度已脱敏',
  LOW_CONFIDENCE: '低置信度',
  EXCEEDS_MAX_WINDOW: '超出窗口上限',
  NO_PROJECTS_VISIBLE: '无可视项目',
}

/** 告警码 → 徽标语义色类名。 */
const WARNING_CHIP_CLASS: Record<ForecastWarningCode, string> = {
  INSUFFICIENT_HISTORY:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
  STALE_SOURCE:
    'border-[rgba(251,191,36,0.45)] bg-[rgba(251,191,36,0.14)] text-[var(--nx-chart-4)]',
  PARTIAL_VISIBILITY:
    'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
  CACHE_DEGRADED:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
  AI_UNAVAILABLE:
    'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
  FEATURE_DISABLED:
    'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
  DIMENSION_REDACTED:
    'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
  LOW_CONFIDENCE:
    'border-[rgba(248,113,113,0.45)] bg-[rgba(248,113,113,0.14)] text-[var(--nx-chart-5)]',
  EXCEEDS_MAX_WINDOW:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
  NO_PROJECTS_VISIBLE:
    'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] text-[var(--nx-text-muted)]',
}

export function demandWarningLabel(code: ForecastWarningCode | string | undefined): string {
  if (!code) return '未知告警'
  return DEMAND_WARNING_LABELS[code as ForecastWarningCode] ?? code
}

export function demandWarningChipClass(code: ForecastWarningCode | string | undefined): string {
  if (!code) return WARNING_CHIP_CLASS.FEATURE_DISABLED
  return WARNING_CHIP_CLASS[code as ForecastWarningCode] ?? WARNING_CHIP_CLASS.FEATURE_DISABLED
}

// ─── 缺口类型/方向标签与徽标 ──────────────────────────────────────────────

/** 缺口类型 → 中文标签（与旧轨 GAP_TYPE_LABELS 同文案）。 */
export const DEMAND_GAP_TYPE_LABELS: Record<ForecastGapType, string> = {
  shortage: '短缺',
  surplus: '盈余',
  volatility: '波动',
  insufficient_history: '历史不足',
  stale_source: '源过期',
  low_confidence: '低置信度',
}

/** 缺口类型 → 徽标语义色类名。 */
const GAP_TYPE_CHIP_CLASS: Record<ForecastGapType, string> = {
  shortage: 'border-[rgba(239,68,68,0.5)] bg-[rgba(239,68,68,0.16)] text-[var(--nx-status-danger)]',
  surplus:
    'border-[rgba(16,185,129,0.45)] bg-[rgba(16,185,129,0.14)] text-[var(--nx-status-success)]',
  volatility:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
  insufficient_history:
    'border-[rgba(251,191,36,0.45)] bg-[rgba(251,191,36,0.14)] text-[var(--nx-chart-4)]',
  stale_source:
    'border-[rgba(245,158,11,0.45)] bg-[rgba(245,158,11,0.14)] text-[var(--nx-status-warning)]',
  low_confidence:
    'border-[rgba(248,113,113,0.45)] bg-[rgba(248,113,113,0.14)] text-[var(--nx-chart-5)]',
}

export function gapTypeLabel(gapType: ForecastGapType | string | undefined): string {
  if (!gapType) return '未知'
  return DEMAND_GAP_TYPE_LABELS[gapType as ForecastGapType] ?? gapType
}

export function gapTypeChipClass(gapType: ForecastGapType | string | undefined): string {
  if (!gapType) return GAP_TYPE_CHIP_CLASS.volatility
  return GAP_TYPE_CHIP_CLASS[gapType as ForecastGapType] ?? GAP_TYPE_CHIP_CLASS.volatility
}

/** 缺口方向 → 中文标签。 */
export const DEMAND_GAP_DIRECTION_LABELS: Record<'shortage' | 'surplus', string> = {
  shortage: '短缺',
  surplus: '盈余',
}

// ─── Summary KPI 指标标签与格式化 ─────────────────────────────────────────

type MetricShape = 'hours' | 'count' | 'ratio' | 'gapHours'

/** 指标键 → {标签, 形态}。 */
export const DEMAND_METRIC_META: Record<
  ResourceDemandForecastingMetricKey,
  { label: string; shape: MetricShape }
> = {
  forecast_total_demand_hours: { label: '预测总需求', shape: 'hours' },
  forecast_total_allocated_hours: { label: '当前分配', shape: 'hours' },
  forecast_total_available_hours: { label: '可用容量', shape: 'hours' },
  forecast_total_remaining_hours: { label: '剩余容量', shape: 'hours' },
  forecast_projected_gap_hours: { label: '预测缺口', shape: 'gapHours' },
  forecast_visible_project_count: { label: '可见项目', shape: 'count' },
  forecast_visible_resource_count: { label: '可见资源', shape: 'count' },
  forecast_skill_coverage_ratio: { label: '技能覆盖率', shape: 'ratio' },
  forecast_shortage_count: { label: '短缺桶', shape: 'count' },
  forecast_surplus_count: { label: '盈余桶', shape: 'count' },
}

export function demandMetricLabel(key: ResourceDemandForecastingMetricKey): string {
  return DEMAND_METRIC_META[key]?.label ?? key
}

/** 指标值格式化（缺口以幅值呈现，方向由调用方着色——与旧轨 KPI 语义一致）。 */
export function formatDemandMetric(key: ResourceDemandForecastingMetricKey, value: number): string {
  const shape = DEMAND_METRIC_META[key]?.shape ?? 'hours'
  switch (shape) {
    case 'count':
      return formatDemandCount(value)
    case 'ratio':
      return formatDemandPercentRatio(value)
    case 'gapHours':
      return formatDemandHours(Math.abs(value))
    case 'hours':
    default:
      return formatDemandHours(value)
  }
}

// ─── demand-curves 点序列化（按 bucketStart 聚合） ────────────────────────

export type DemandBucketDim = 'role' | 'skill' | 'project'

export const DEMAND_DIMENSION_LABELS: Record<DemandBucketDim, string> = {
  role: '角色',
  skill: '技能',
  project: '项目',
}

/** 序列化后的曲线数据点模型（供 echarts-core 折线渲染与表格）。 */
export interface DemandCurveSeriesModel {
  /** 桶起始日期轴（升序去重）。 */
  categories: string[]
  forecastDemand: number[]
  actualAllocation: number[]
  available: number[]
  remaining: number[]
  gap: number[]
  /** 覆盖桶行数（透视前明细行）。 */
  bucketRows: number
}

function sum(nums: number[]): number {
  return nums.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0)
}

function aggregateBuckets(buckets: readonly ForecastMetricBucket[]): DemandCurveSeriesModel {
  const byBucket = new Map<string, ForecastMetricBucket[]>()
  for (const bucket of buckets) {
    const key = bucket.bucketStart
    const list = byBucket.get(key) ?? []
    list.push(bucket)
    byBucket.set(key, list)
  }
  const sortedKeys = Array.from(byBucket.keys()).sort()
  const empty = { forecastDemand: [], actualAllocation: [], available: [], remaining: [], gap: [] }
  const series = sortedKeys.reduce(
    (acc, key) => {
      const group = byBucket.get(key)!
      acc.forecastDemand.push(sum(group.map((b) => b.forecastDemand)))
      acc.actualAllocation.push(sum(group.map((b) => b.actualAllocation)))
      acc.available.push(sum(group.map((b) => b.available)))
      acc.remaining.push(sum(group.map((b) => b.remaining)))
      acc.gap.push(sum(group.map((b) => b.gap)))
      return acc
    },
    { ...empty } as {
      forecastDemand: number[]
      actualAllocation: number[]
      available: number[]
      remaining: number[]
      gap: number[]
    },
  )
  return {
    categories: sortedKeys.map((key) => formatForecastDate(key)),
    ...series,
    bucketRows: buckets.length,
  }
}

/** 需求曲线 → 按所选维度聚合为曲线序列（空输入安全）。 */
export function serializeDemandCurveSeries(
  curve: ForecastDemandCurve,
  dimension: DemandBucketDim,
): DemandCurveSeriesModel {
  if (dimension === 'role') return aggregateBuckets(curve.roleBuckets)
  if (dimension === 'skill') return aggregateBuckets(curve.skillBuckets)
  return aggregateBuckets(curve.projectBuckets)
}

/** 是否无任何维度桶行（整曲线空态判定）。 */
export function isDemandCurveEmpty(curve: ForecastDemandCurve | null | undefined): boolean {
  if (!curve) return true
  return (
    curve.roleBuckets.length === 0 &&
    curve.skillBuckets.length === 0 &&
    curve.projectBuckets.length === 0
  )
}

// ─── 维度聚合行模型（驱动/曲线表格高密度行） ─────────────────────────────

/** 受限中性占位（维度名不可见时使用，RL-05）。 */
export const DEMAND_REDACTED_PLACEHOLDER = '不可见'

/** 维度是否受限（服务端 redaction 状态非空即受限——FORECAST_REDACTION_STATES 三态）。 */
export function isDemandDimensionRedacted(redaction: ForecastRedactionState | undefined): boolean {
  return Boolean(redaction)
}

/** 项目驱动名称展示（受限 → 中性占位）。 */
export function formatProjectDriverLabel(driver: ForecastProjectDriver): {
  display: string
  redacted: boolean
} {
  const redacted = isDemandDimensionRedacted(driver.redaction)
  if (redacted || !driver.projectName || driver.projectName.trim() === '') {
    return { display: DEMAND_REDACTED_PLACEHOLDER, redacted: true }
  }
  return { display: driver.projectName, redacted: false }
}

/** 技能驱动名称展示（原始标签优先；受限 → 中性占位）。 */
export function formatSkillDriverLabel(driver: ForecastSkillDriver): {
  display: string
  redacted: boolean
} {
  const redacted = isDemandDimensionRedacted(driver.redaction)
  const label = driver.originalLabel?.trim() || driver.skill.trim()
  if (redacted || label === '') {
    return { display: DEMAND_REDACTED_PLACEHOLDER, redacted: true }
  }
  return { display: label, redacted: false }
}

/** 聚合维度行模型（供曲线视图维度表格渲染）。 */
export interface DemandDimensionRowModel {
  /** 维度键（role/skill/project 键或 id 字符串）。 */
  key: string
  /** 展示名（受限 → 中性占位）。 */
  display: string
  redacted: boolean
  totalDemand: number
  totalAllocation: number
  gap: number
  /** 峰值缺口绝对值最大桶。 */
  peakGapBucket: string | null
  bucketCount: number
  confidence: ForecastConfidenceBand
}

type DimensionBucket = ForecastRoleBucket | ForecastSkillBucket | ForecastProjectBucket

function dimensionKeyAndName(bucket: DimensionBucket): {
  key: string
  name: string | null
  redacted: boolean
} {
  if ('role' in bucket) {
    return {
      key: bucket.role,
      name: bucket.role,
      redacted: isDemandDimensionRedacted(bucket.roleRedaction),
    }
  }
  if ('skill' in bucket) {
    return {
      key: bucket.skill,
      name: bucket.originalLabel?.trim() || bucket.skill,
      redacted: isDemandDimensionRedacted(bucket.skillRedaction),
    }
  }
  return {
    key: String(bucket.projectId),
    name: bucket.projectName?.trim() ?? null,
    redacted: isDemandDimensionRedacted(bucket.projectRedaction),
  }
}

/** 维度桶列表 → 按维度聚合行（空输入安全；时段为各维度的桶序列，缺口取汇总）。 */
export function aggregateDemandDimensionRows(
  buckets: readonly DimensionBucket[],
): DemandDimensionRowModel[] {
  const groups = new Map<string, DimensionBucket[]>()
  for (const bucket of buckets) {
    const { key } = dimensionKeyAndName(bucket)
    const list = groups.get(key) ?? []
    list.push(bucket)
    groups.set(key, list)
  }
  const rows: DemandDimensionRowModel[] = []
  for (const [key, group] of groups) {
    // 展示名取首个未受限且有名称的行；维度全部受限 → 中性占位（RL-05）。
    const namedRow = group.find((bucket) => {
      const meta = dimensionKeyAndName(bucket)
      return !meta.redacted && Boolean(meta.name && meta.name.trim() !== '')
    })
    const named = namedRow ? dimensionKeyAndName(namedRow) : null
    let totalDemand = 0
    let totalAllocation = 0
    let gap = 0
    let peakAbs = 0
    let peakGapBucket: string | null = null
    for (const bucket of group) {
      totalDemand += bucket.forecastDemand
      totalAllocation += bucket.actualAllocation
      gap += bucket.gap
      if (Math.abs(bucket.gap) > peakAbs) {
        peakAbs = Math.abs(bucket.gap)
        peakGapBucket = formatForecastDate(bucket.bucketStart)
      }
    }
    rows.push({
      key,
      display: named && named.name ? named.name : DEMAND_REDACTED_PLACEHOLDER,
      redacted: !(named && named.name),
      totalDemand,
      totalAllocation,
      gap,
      peakGapBucket,
      bucketCount: group.length,
      confidence: worstConfidence(group.map((b) => b.confidence)),
    })
  }
  rows.sort((a, b) => b.totalDemand - a.totalDemand)
  return rows
}

// ─── gap-analysis 桶格式化（瀑布聚合） ───────────────────────────────────

/** 瀑布聚合桶（按 bucketStart 汇总短缺/盈余小时）。 */
export interface DemandGapWaterfallBucket {
  bucketStart: string
  bucketEnd: string
  shortageHours: number
  surplusHours: number
}

/** 缺口条目桶起始去重排序 → 汇总短缺/盈余（空输入安全）。 */
export function buildGapWaterfall(gaps: readonly ForecastGapEntry[]): DemandGapWaterfallBucket[] {
  const byBucket = new Map<string, ForecastGapEntry[]>()
  for (const gap of gaps) {
    const key = gap.bucketStart ?? '未排程'
    const list = byBucket.get(key) ?? []
    list.push(gap)
    byBucket.set(key, list)
  }
  const buckets = Array.from(byBucket.entries())
    .sort((a, b) => (a[0] === '未排程' ? 1 : b[0] === '未排程' ? -1 : a[0].localeCompare(b[0])))
    .map(([key, entries]) => ({
      bucketStart: key === '未排程' ? '未排程' : formatForecastDate(key),
      bucketEnd: entries[0]?.bucketEnd ? formatForecastDate(entries[0].bucketEnd) : '',
      shortageHours: sum(entries.filter((e) => e.direction === 'shortage').map((e) => e.gapHours)),
      surplusHours: sum(entries.filter((e) => e.direction === 'surplus').map((e) => e.gapHours)),
    }))
  return buckets
}

/** gap 汇总行模型（缺口列表表格）。 */
export function formatGapEntryBucket(gap: ForecastGapEntry): string {
  if (!gap.bucketStart) return '—'
  if (!gap.bucketEnd) return formatForecastDate(gap.bucketStart)
  return `${formatForecastDate(gap.bucketStart)} → ${formatForecastDate(gap.bucketEnd)}`
}

/** 缺口条目关联维度展示（角色/技能/项目，均缺失 → '—'）。 */
export function formatGapEntryDimension(gap: ForecastGapEntry): string {
  const parts: string[] = []
  if (gap.role) parts.push(`角色 ${gap.role}`)
  if (gap.skill) parts.push(`技能 ${gap.skill}`)
  if (gap.projectId) parts.push(`项目 #${gap.projectId}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** gap 分析总览数值（短缺/盈余/净缺口，均含符号口径）。 */
export function formatGapAnalysisTotals(analysis: ForecastGapAnalysis): {
  totalShortage: string
  totalSurplus: string
  netGap: string
} {
  return {
    totalShortage: formatSignedGapHours(analysis.totalShortage, 'shortage'),
    totalSurplus: formatSignedGapHours(analysis.totalSurplus, 'surplus'),
    netGap:
      analysis.netGap === 0
        ? '0h'
        : analysis.netGap > 0
          ? formatSignedGapHours(analysis.netGap, 'shortage')
          : formatSignedGapHours(Math.abs(analysis.netGap), 'surplus'),
  }
}

// ─── URL 状态解析/序列化（restorable filters） ─────────────────────────

export const DEMAND_URL_VIEWS = ['curves', 'gaps', 'drivers'] as const
export type DemandUrlView = (typeof DEMAND_URL_VIEWS)[number]
export const DEMAND_DEFAULT_VIEW: DemandUrlView = 'curves'

export interface DemandUrlState {
  view: DemandUrlView
  granularity: ForecastGranularity
  startDate: string
  endDate: string
}

function isValidDateString(value: string | null): value is string {
  if (!value) return false
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  )
}

/** URLSearchParams → 工作台状态（脏值一律回落默认，绝不原样外发）。 */
export function parseDemandUrlState(searchParams: URLSearchParams): DemandUrlState {
  const rawView = searchParams.get('view')
  const view: DemandUrlView = (DEMAND_URL_VIEWS as readonly string[]).includes(rawView ?? '')
    ? (rawView as DemandUrlView)
    : DEMAND_DEFAULT_VIEW
  const rawGranularity = searchParams.get('granularity')
  const granularity: ForecastGranularity = (
    FORECAST_GRANULARITY_VALUES as readonly string[]
  ).includes(rawGranularity ?? '')
    ? (rawGranularity as ForecastGranularity)
    : FORECAST_DEFAULT_GRANULARITY
  const fallback = createDefaultForecastWindow()
  const startDate = isValidDateString(searchParams.get('startDate'))
    ? (searchParams.get('startDate') as string)
    : fallback.startDate
  const endDate = isValidDateString(searchParams.get('endDate'))
    ? (searchParams.get('endDate') as string)
    : fallback.endDate
  return { view, granularity, startDate, endDate }
}

/** 工作台状态 → URLSearchParams（默认值不落参，URL 洁净可分享）。 */
export function serializeDemandUrlState(state: DemandUrlState): URLSearchParams {
  const params = new URLSearchParams()
  if (state.view !== DEMAND_DEFAULT_VIEW) params.set('view', state.view)
  if (state.granularity !== FORECAST_DEFAULT_GRANULARITY)
    params.set('granularity', state.granularity)
  const fallback = createDefaultForecastWindow()
  if (state.startDate !== fallback.startDate) params.set('startDate', state.startDate)
  if (state.endDate !== fallback.endDate) params.set('endDate', state.endDate)
  return params
}

/** 工作台状态 → 数据层查询。 */
export function demandUrlStateToQuery(
  state: DemandUrlState,
): Partial<import('@aiproj/types').ResourceDemandForecastQuery> {
  return {
    startDate: state.startDate,
    endDate: state.endDate,
    granularity: state.granularity,
  }
}

/** 当前状态是否偏离缺省（重置按钮可见性依据）。 */
export function hasActiveDemandFilters(state: DemandUrlState): boolean {
  return (
    state.view !== DEMAND_DEFAULT_VIEW ||
    state.granularity !== FORECAST_DEFAULT_GRANULARITY ||
    state.startDate !== createDefaultForecastWindow().startDate ||
    state.endDate !== createDefaultForecastWindow().endDate
  )
}

// ─── 驾驶/方法/负载筛选选项（视图条用） ──────────────────────────────────

/** 维度筛选选项（曲线视图维度切换）。 */
export const DEMAND_DIMENSION_OPTIONS: ReadonlyArray<{
  value: DemandBucketDim
  label: string
}> = [
  { value: 'role', label: '按角色' },
  { value: 'skill', label: '按技能' },
  { value: 'project', label: '按项目' },
]

/** 负载状态筛选选项（含全部）。 */
export const DEMAND_LOAD_STATUS_OPTIONS: ReadonlyArray<{
  value: ForecastLoadStatus | ''
  label: string
}> = [
  { value: '', label: '全部负载' },
  ...(Object.keys(FORECAST_LOAD_STATUSES) as ForecastLoadStatus[]).map((status) => ({
    value: status,
    label: DEMAND_LOAD_STATUS_LABELS[status],
  })),
]

/** 缺口方向文字（双通道用途的补充描述）。 */
export function directionHintOf(direction: 'shortage' | 'surplus'): string {
  return direction === 'shortage' ? '短缺（需求超过容量）' : '盈余（容量富余）'
}
