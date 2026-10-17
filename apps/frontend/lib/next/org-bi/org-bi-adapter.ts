/**
 * 组织 BI 域纯函数适配器（v3-ui-next-org-portfolio-domains W3 · tasks 3.1）。
 *
 * - 零 UI / 零网络依赖：只消费 `@aiproj/types` 既有契约（bi-dashboard-builder、
 *   bi-risk-heatmap、bi-trend-analysis 三份共享类型）与 `--nx-*` 令牌语义
 *   （next-tokens.css 数值展开）——色彩一律以 CSS 变量名/固定透明度展开表达，
 *   组件层再做「CSS 变量任意值」工具类或 inline style 绑定；
 * - 双通道：所有状态呈现同时产出「中文语义文案」与「色阶令牌」，不单靠颜色；
 * - 确定性：全部为纯函数/常量映射，禁止运行时随机、Math.random 或环境依赖。
 */
import type {
  BiRiskHeatmapMetricKey,
  BiRiskHeatmapWindow,
  BiRiskHeatmapDimensionKey,
  BiRiskHeatmapCompareMode,
  BiRiskHeatmapCellRiskLevel,
  BiTrendMetricKey,
  BiTrendWindow,
  BiTrendGrain,
  BiTrendDirection,
  BiTrendInsightSeverity,
  BiDashboardWidgetKey,
  BiDashboardScope,
  BiDashboardWidgetSize,
  BiTrendSeries,
  BiTrendPoint,
} from '@aiproj/types'
import {
  BI_RISK_HEATMAP_METRIC_KEY_VALUES,
  BI_RISK_HEATMAP_WINDOW_VALUES,
  BI_RISK_HEATMAP_DIMENSION_KEY_VALUES,
  BI_RISK_HEATMAP_COMPARE_MODE_VALUES,
  BI_RISK_HEATMAP_CELL_RISK_LEVEL_VALUES,
  BI_TREND_METRIC_KEY_VALUES,
  BI_TREND_WINDOW_VALUES,
  BI_TREND_GRAIN_VALUES,
  BI_DASHBOARD_WIDGET_KEY_VALUES,
  BI_DASHBOARD_WIDGET_SIZES,
} from '@aiproj/types'

// ─── 1. BI 指标/维度中文标签 ───────────────────────────────────────────────

/** BI 风险热力指标 → 中文标签（与旧轨页面同源语义）。 */
export const BI_RISK_HEATMAP_METRIC_LABELS: Record<BiRiskHeatmapMetricKey, string> = {
  risk_exposure_score: '风险暴露评分',
  risk_count: '风险数量',
  high_risk_ratio: '高风险占比',
  overdue_risk_ratio: '逾期风险占比',
  risk_delta: '风险变化量',
  traffic_light_risk_ratio: '交通灯风险比',
}

export function biRiskHeatmapMetricLabel(key: BiRiskHeatmapMetricKey): string {
  return BI_RISK_HEATMAP_METRIC_LABELS[key] ?? key
}

export const BI_RISK_HEATMAP_WINDOW_LABELS: Record<BiRiskHeatmapWindow, string> = {
  last_7_days: '最近 7 天',
  last_30_days: '最近 30 天',
  last_90_days: '最近 90 天',
  last_180_days: '最近 180 天',
  last_365_days: '最近 365 天',
  current_month: '本月',
  current_quarter: '本季度',
  current_year: '本年度',
}

export function biRiskHeatmapWindowLabel(window: BiRiskHeatmapWindow): string {
  return BI_RISK_HEATMAP_WINDOW_LABELS[window] ?? window
}

export const BI_RISK_HEATMAP_DIMENSION_LABELS: Record<BiRiskHeatmapDimensionKey, string> = {
  project: '项目',
  portfolio_group: '组合分组',
  risk_category: '风险类别',
  risk_level: '风险等级',
  risk_status: '风险状态',
  assignee: '负责人',
  time_bucket: '时间桶',
  department: '部门',
}

export function biRiskHeatmapDimensionLabel(key: BiRiskHeatmapDimensionKey): string {
  return BI_RISK_HEATMAP_DIMENSION_LABELS[key] ?? key
}

export const BI_RISK_HEATMAP_COMPARE_LABELS: Record<BiRiskHeatmapCompareMode, string> = {
  previous_period: '与上期对比',
  same_period_last_year: '与去年同期对比',
  none: '无对比',
}

export function biRiskHeatmapCompareLabel(mode: BiRiskHeatmapCompareMode): string {
  return BI_RISK_HEATMAP_COMPARE_LABELS[mode] ?? mode
}

/** 枚举值数组（供筛选条稳定遍历）。 */
export const BI_RISK_HEATMAP_METRIC_KEYS = BI_RISK_HEATMAP_METRIC_KEY_VALUES
export const BI_RISK_HEATMAP_WINDOWS = BI_RISK_HEATMAP_WINDOW_VALUES
export const BI_RISK_HEATMAP_DIMENSIONS = BI_RISK_HEATMAP_DIMENSION_KEY_VALUES
export const BI_RISK_HEATMAP_COMPARE_MODES = BI_RISK_HEATMAP_COMPARE_MODE_VALUES

// ─── 2. BI 趋势指标/窗口标签 ───────────────────────────────────────────────

/** BI 趋势指标 → 中文标签（白名单六个指标，与后端 metric registry 同源）。 */
export const BI_TREND_METRIC_LABELS: Record<BiTrendMetricKey, string> = {
  project_progress: '项目进度',
  schedule_delay_pressure: '延期压力',
  risk_pressure: '风险压力',
  resource_pressure: '资源压力',
  forecast_demand_pressure: '预测需求压力',
  okr_progress: 'OKR 进展',
}

export function biTrendMetricLabel(key: BiTrendMetricKey): string {
  return BI_TREND_METRIC_LABELS[key] ?? key
}

/** 指标数值单位：百分比类 / 缺口小时类 / 无单位评分类。 */
export type BiTrendMetricUnit = 'percent' | 'hours' | 'score'

export const BI_TREND_METRIC_UNITS: Record<BiTrendMetricKey, BiTrendMetricUnit> = {
  project_progress: 'percent',
  schedule_delay_pressure: 'percent',
  risk_pressure: 'score',
  resource_pressure: 'percent',
  forecast_demand_pressure: 'hours',
  okr_progress: 'percent',
}

/** 趋势指标主键白名单（遍历顺序即默认展示顺序）。 */
export const BI_TREND_METRIC_KEYS = BI_TREND_METRIC_KEY_VALUES

/** 窗口标签补齐（类型包已含部分键；补齐缺省键并统一文案）。 */
export const BI_TREND_WINDOW_LABELS: Record<BiTrendWindow, string> = {
  last_7_days: '最近 7 天',
  last_30_days: '最近 30 天',
  last_90_days: '最近 90 天',
  last_12_weeks: '最近 12 周',
  last_6_months: '最近 6 个月',
  last_12_months: '最近 12 个月',
}

export function biTrendWindowLabel(window: BiTrendWindow): string {
  return BI_TREND_WINDOW_LABELS[window] ?? window
}

export const BI_TREND_WINDOWS = BI_TREND_WINDOW_VALUES

export function biTrendGrainLabel(grain: BiTrendGrain): string {
  if (grain === 'day') return '日'
  if (grain === 'week') return '周'
  return '月'
}

export const BI_TREND_GRAINS = BI_TREND_GRAIN_VALUES

/** 趋势方向中文标签（与类型包 BI_TREND_DIRECTION_LABELS 语义一致）。 */
export const BI_TREND_DIRECTION_LABELS: Record<BiTrendDirection, string> = {
  up: '上升',
  down: '下降',
  flat: '持平',
  unknown: '未知',
}

export function biTrendDirectionLabel(direction: BiTrendDirection): string {
  return BI_TREND_DIRECTION_LABELS[direction] ?? direction
}

// ─── 3. 热力色阶（5×5 概率×影响 → --nx-* 令牌，双通道） ──────────────────

/** 热力单元风险等级元数据（色 + 文案双通道；令牌色值见 next-tokens.css）。 */
export interface OrgBiHeatLevelMeta {
  /** 展示语义文案（第二通道）。 */
  label: string
  /** 语义档位（组件据此绑定令牌）。 */
  tone: 'danger' | 'warning' | 'caution' | 'success' | 'neutral'
  /** 前景令牌（CSS 变量引用）。 */
  token: string
  /** 背景固定透明度展开（令牌数值展开，与 echarts nx-dark 一致）。 */
  bg: string
  /** 边框/描边令牌。 */
  border: string
}

const DANGER_HEX = '#ef4444' // --nx-status-danger
const WARNING_HEX = '#f59e0b' // --nx-status-warning
const CAUTION_HEX = '#fbbf24' // --nx-chart-4
const SUCCESS_HEX = '#10b981' // --nx-status-success

function heatMeta(
  label: string,
  tone: OrgBiHeatLevelMeta['tone'],
  hex: string,
  bgAlpha: number,
): OrgBiHeatLevelMeta {
  const tokenByName: Record<OrgBiHeatLevelMeta['tone'], string> = {
    danger: 'var(--nx-status-danger)',
    warning: 'var(--nx-status-warning)',
    caution: 'var(--nx-chart-4)',
    success: 'var(--nx-status-success)',
    neutral: 'var(--nx-text-secondary)',
  }
  return {
    label,
    tone,
    token: tokenByName[tone],
    bg: `rgba(${hexToRgbTriple(hex)}, ${bgAlpha})`,
    border: tone === 'neutral' ? 'var(--nx-border-hairline)' : tokenByName[tone],
  }
}

function hexToRgbTriple(hex: string): string {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

/** 五级热力单元（critical/high/medium/low/insufficient_data）→ 色阶元数据。 */
export const BI_HEAT_LEVEL_META: Record<BiRiskHeatmapCellRiskLevel, OrgBiHeatLevelMeta> = {
  critical: heatMeta('严重', 'danger', DANGER_HEX, 0.18),
  high: heatMeta('高', 'warning', WARNING_HEX, 0.14),
  medium: heatMeta('中', 'caution', CAUTION_HEX, 0.12),
  low: heatMeta('低', 'success', SUCCESS_HEX, 0.1),
  insufficient_data: heatMeta('数据不足', 'neutral', '#64748b', 0.06),
}

export function biHeatLevelMeta(level: BiRiskHeatmapCellRiskLevel): OrgBiHeatLevelMeta {
  return BI_HEAT_LEVEL_META[level] ?? BI_HEAT_LEVEL_META.insufficient_data
}

/** 5×5 概率×影响 → 风险等级（归一化 score = p×i/25，分级沿用类型包阈值）。 */
export function probabilityImpactHeatLevel(
  probability: number,
  impact: number,
): BiRiskHeatmapCellRiskLevel {
  const p = Math.min(5, Math.max(1, Math.round(probability)))
  const i = Math.min(5, Math.max(1, Math.round(impact)))
  const score = (p * i) / 25
  if (score >= 0.8) return 'critical'
  if (score >= 0.5) return 'high'
  if (score >= 0.25) return 'medium'
  return 'low'
}

/** 单元分数 → 等级（sampleCount 不足时统一数据不足，语义与类型包 classify 一致）。 */
export function heatLevelOfScore(score: number, sampleCount: number): BiRiskHeatmapCellRiskLevel {
  if (sampleCount < 3) return 'insufficient_data'
  if (score >= 0.8) return 'critical'
  if (score >= 0.5) return 'high'
  if (score >= 0.25) return 'medium'
  return 'low'
}

/** 热力等级枚举数组（表头/图例遍历顺序）。 */
export const BI_HEAT_LEVEL_ORDER: readonly BiRiskHeatmapCellRiskLevel[] =
  BI_RISK_HEATMAP_CELL_RISK_LEVEL_VALUES

// ─── 4. 趋势异常分级与洞察严重度 ───────────────────────────────────────────

export type OrgBiAnomalySeverity = 'critical' | 'high' | 'medium' | 'low'

export interface OrgBiAnomalySeverityMeta {
  /** 语义文案（第二通道）。 */
  label: string
  tone: OrgBiHeatLevelMeta['tone']
  token: string
}

/** 异常严重度 → 文案 + 令牌。分级基准：|z|≥4 严重 / ≥3 高 / ≥2 中 / 其余低。 */
export const BI_ANOMALY_SEVERITY_META: Record<OrgBiAnomalySeverity, OrgBiAnomalySeverityMeta> = {
  critical: { label: '严重', tone: 'danger', token: 'var(--nx-status-danger)' },
  high: { label: '高', tone: 'warning', token: 'var(--nx-status-warning)' },
  medium: { label: '中', tone: 'caution', token: 'var(--nx-chart-4)' },
  low: { label: '低', tone: 'neutral', token: 'var(--nx-text-secondary)' },
}

/** 按 |zScore| 分级异常点（确定性阈值）。 */
export function classifyTrendAnomalySeverity(zScore: number): OrgBiAnomalySeverity {
  const magnitude = Math.abs(zScore)
  if (magnitude >= 4) return 'critical'
  if (magnitude >= 3) return 'high'
  if (magnitude >= 2) return 'medium'
  return 'low'
}

/** 异常方向 → 文案（双通道：文字 + 方向色由组件用图标表达）。 */
export const BI_ANOMALY_DIRECTION_LABELS: Record<'above' | 'below', string> = {
  above: '高于期望',
  below: '低于期望',
}

/** 洞察严重度（info/attention/critical）→ 徽标元数据。 */
export interface OrgBiInsightSeverityMeta {
  label: string
  tone: OrgBiHeatLevelMeta['tone']
  token: string
}

export const BI_TREND_INSIGHT_SEVERITY_META: Record<
  BiTrendInsightSeverity,
  OrgBiInsightSeverityMeta
> = {
  info: { label: '信息', tone: 'neutral', token: 'var(--nx-text-secondary)' },
  attention: { label: '关注', tone: 'warning', token: 'var(--nx-status-warning)' },
  critical: { label: '严重', tone: 'danger', token: 'var(--nx-status-danger)' },
}

// ─── 5. BI 仪表盘 widget/作用域/尺寸标签 ──────────────────────────────────

/** 服务端确定性 widget 键白名单（RL-14：只渲染注册表既有类型）。 */
export const BI_DASHBOARD_WIDGET_KEYS = BI_DASHBOARD_WIDGET_KEY_VALUES

export const BI_WIDGET_TYPE_LABELS: Record<BiDashboardWidgetKey, string> = {
  bi_trend: 'BI 趋势',
  bi_risk_heatmap: '风险热力图',
  bi_custom_report_summary: '报表摘要',
  pmo_health: 'PMO 健康',
  resource_summary: '资源概览',
  okr_summary: 'OKR 概览',
  organization_dashboard_summary: '组织概览',
}

export const BI_WIDGET_TYPE_DESCRIPTIONS: Record<BiDashboardWidgetKey, string> = {
  bi_trend: '组织指标时序趋势（只读分析镜头）',
  bi_risk_heatmap: '组织风险概率×影响热力矩阵（只读分析镜头）',
  bi_custom_report_summary: '预设报表关键摘要',
  pmo_health: '组合健康与红绿灯摘要',
  resource_summary: '组织资源负载概览',
  okr_summary: 'OKR 达成进展概览',
  organization_dashboard_summary: '组织概览关键指标摘要',
}

export function biWidgetTypeLabel(key: string): string {
  return BI_WIDGET_TYPE_LABELS[key as BiDashboardWidgetKey] ?? key
}

export function biWidgetTypeDescription(key: string): string {
  return BI_WIDGET_TYPE_DESCRIPTIONS[key as BiDashboardWidgetKey] ?? ''
}

export const BI_DASHBOARD_SCOPE_LABELS: Record<BiDashboardScope, string> = {
  personal: '我的仪表盘',
  organization_shared: '组织共享',
}

export function biDashboardScopeLabel(scope: BiDashboardScope): string {
  return BI_DASHBOARD_SCOPE_LABELS[scope] ?? scope
}

export const BI_WIDGET_SIZE_LABELS: Record<BiDashboardWidgetSize, string> = {
  small: '小',
  medium: '中',
  large: '大',
  full: '全宽',
}

export function biWidgetSizeLabel(size: BiDashboardWidgetSize): string {
  return BI_WIDGET_SIZE_LABELS[size] ?? size
}

export const BI_WIDGET_SIZES: readonly BiDashboardWidgetSize[] =
  Object.values(BI_DASHBOARD_WIDGET_SIZES)

export const BI_DASHBOARD_DENSITY_LABELS: Record<'comfortable' | 'compact', string> = {
  comfortable: '舒适',
  compact: '紧凑',
}

// ─── 6. 数值格式化（大数/百分比/带符号变化量） ───────────────────────────

/** 大数格式化：≥1 亿 → x.xx 亿；≥1 万 → x.xx 万；其余千分位。 */
export function formatBiMetricNumber(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${trimZeros((value / 1e8).toFixed(fractionDigits))} 亿`
  if (abs >= 1e4) return `${trimZeros((value / 1e4).toFixed(fractionDigits))} 万`
  const [integerPart, decimalPart] = value.toFixed(fractionDigits).split('.')
  const grouped = integerPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const trimmedDecimal = decimalPart ? decimalPart.replace(/0+$/, '') : ''
  return trimmedDecimal === '' ? grouped : `${grouped}.${trimmedDecimal}`
}

function trimZeros(raw: string): string {
  const withSign = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return withSign === '-0' ? '0' : withSign
}

/** 百分比格式化（保留 digits 位小数）。 */
export function formatBiMetricPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** 带符号数值（同比/环比符号），零值无符号；尾随小数零修剪。 */
export function formatSignedDelta(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  const sign = value > 0 ? '+' : '-'
  return `${sign}${trimZeros(Math.abs(value).toFixed(digits))}`
}

/** 同比/环比组合文案：deltaRatio 优先（可读率），缺失回退绝对量。 */
export function formatCompareText(
  deltaRatio: number | null,
  delta: number,
  options: { ratioDigits?: number; deltaDigits?: number } = {},
): string {
  if (deltaRatio !== null && Number.isFinite(deltaRatio)) {
    return formatSignedDelta(deltaRatio * 100, options.ratioDigits ?? 1).concat('%')
  }
  return formatSignedDelta(delta, options.deltaDigits ?? 1)
}

/** 指标值格式化（按单位：百分比类加 %、缺口小时类加 h）。 */
export function formatBiTrendValue(metricKey: BiTrendMetricKey, value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  const unit = BI_TREND_METRIC_UNITS[metricKey]
  if (unit === 'percent') return formatBiMetricPercent(value, digits)
  if (unit === 'hours') return `${trimZeros(value.toFixed(digits))} h`
  return trimZeros(value.toFixed(digits))
}

// ─── 7. 趋势线图纯映射模型（categories/series/异常点/外推合并） ───────────

export interface OrgBiTrendChartModel {
  /** 合并后时间桶标签（主序列 + 外推续段）。 */
  categories: string[]
  /** 主序列数值（null=缺失桶留缺口）。 */
  values: (number | null)[]
  /** 移动平均（与 categories 等长，缺失为 null）。 */
  movingAverage: (number | null)[]
  /** 外推续段（与 categories 等长，前缀为 null）。 */
  forecast: (number | null)[]
  /** 异常点（series index → 值）。 */
  anomalyPoints: { index: number; value: number }[]
  /** 主序列末位索引（外推起点判断用）。 */
  lastPointIndex: number
}

/** 时间桶轴标签：day/week → MM-DD；month → YYYY-MM。 */
export function formatTrendBucketLabel(bucketStart: string, grain: BiTrendGrain): string {
  const raw = bucketStart.slice(0, 10)
  if (grain === 'month') return raw.slice(0, 7)
  return raw.slice(5)
}

function toAxisIndex(bucketStart: string, ordered: string[]): number {
  const index = ordered.indexOf(bucketStart)
  return index >= 0 ? index : ordered.length
}

/**
 * 单序列趋势 → ECharts 线图数据模型。
 *
 * - 主序列与移动平均按 points 桶对齐；外推（forecast）若超出主序列末桶，
 *   自动续接为轴尾部追加桶（前缀 null 占位）；
 * - 异常点收敛为 {index, value}（与轴对齐），由 Scatter 层叠加绘制。
 */
export function buildTrendChartModel(series: BiTrendSeries): OrgBiTrendChartModel {
  const mainBuckets: string[] = []
  const valueByBucket = new Map<string, number | null>()
  const maByBucket = new Map<string, number | null>()
  for (const point of series.points) {
    mainBuckets.push(point.bucketStart)
    valueByBucket.set(point.bucketStart, point.value)
  }
  series.points.forEach((point, index) => {
    maByBucket.set(point.bucketStart, series.movingAverage[index] ?? null)
  })

  const orderedBuckets = [...mainBuckets]
  const forecastPoints = series.forecast?.points ?? []
  for (const point of forecastPoints) {
    if (!orderedBuckets.includes(point.bucketStart)) {
      orderedBuckets.push(point.bucketStart)
    }
  }
  const lastMainBucketIndex = mainBuckets.length - 1

  const categories = orderedBuckets.map((bucket) => formatTrendBucketLabel(bucket, series.grain))
  const values: (number | null)[] = orderedBuckets.map(
    (bucket) => valueByBucket.get(bucket) ?? null,
  )
  const movingAverage: (number | null)[] = orderedBuckets.map(
    (bucket) => maByBucket.get(bucket) ?? null,
  )
  const forecastLine: (number | null)[] = orderedBuckets.map(() => null)
  for (const point of forecastPoints) {
    const axisIndex = toAxisIndex(point.bucketStart, orderedBuckets)
    if (axisIndex > lastMainBucketIndex) forecastLine[axisIndex] = point.value
  }

  const anomalyPoints: { index: number; value: number }[] = []
  for (const anomaly of series.anomalies ?? []) {
    const axisIndex = toAxisIndex(anomaly.bucketStart, orderedBuckets)
    anomalyPoints.push({ index: axisIndex, value: anomaly.value })
  }

  return {
    categories,
    values,
    movingAverage,
    forecast: forecastLine,
    anomalyPoints,
    lastPointIndex: lastMainBucketIndex,
  }
}

/** 主序列点 → 最近可用数值（无值返回 null，供摘要展示）。 */
export function latestNonNull(points: readonly BiTrendPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const value = points[i]?.value
    if (value !== null && value !== undefined) return value
  }
  return null
}
