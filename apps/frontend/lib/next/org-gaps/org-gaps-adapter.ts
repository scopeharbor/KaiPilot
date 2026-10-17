/**
 * 资源缺口分析呈现侧纯函数适配器（v3-ui-next-org-portfolio-domains W4 · tasks 4.6）。
 *
 * - 维度序列化：URL query 为筛选唯一事实来源（restorable filters），解析/序列化
 *   全部走白名单收敛（非法维度/粒度回落默认值）；
 * - 严重度标签与 --nx-* 令牌色阶（DOM chip 双通道）+ 图表十六进制展开
 *   （echarts nx-dark 主题同源纪律，色值 = next-tokens.css 数值展开）；
 * - 图表数据点纯函数：ResourceGapEntry[] → 柱图行模型（需求/供给/缺口/严重度）；
 * - 零 UI / 零 DOM / 零网络；中文标签同源 @aiproj/types 常量（契约同源）。
 */
import {
  RESOURCE_GAP_DIMENSION_LABELS,
  RESOURCE_GAP_METRIC_LABELS,
  RESOURCE_GAP_SEVERITY_LABELS,
  RESOURCE_GAP_METRIC_VALUES,
  RESOURCE_GAP_SEVERITY_VALUES,
  type ResourceGapDimension,
  type ResourceGapEntry,
  type ResourceGapMetric,
  type ResourceGapQuery,
  type ResourceGapSeverity,
} from '@aiproj/types'

// ─── 维度 Tab（工作台五维切换；organization 维不在本页切换范围） ───────────

export const GAP_DIMENSION_TABS = [
  { key: 'role', label: '角色' },
  { key: 'skill', label: '技能' },
  { key: 'timeBucket', label: '时段' },
  { key: 'project', label: '项目' },
  { key: 'portfolio', label: '组合' },
] as const satisfies ReadonlyArray<{ key: ResourceGapDimension; label: string }>

/** 缺口维度标签（含 organization 全量映射，供 header/说明复用）。 */
export { RESOURCE_GAP_DIMENSION_LABELS as GAP_DIMENSION_LABELS }
export { RESOURCE_GAP_METRIC_LABELS as GAP_METRIC_LABELS }
export { RESOURCE_GAP_SEVERITY_LABELS as GAP_SEVERITY_LABELS }

export function getGapSeverityLabel(severity: ResourceGapSeverity): string {
  return RESOURCE_GAP_SEVERITY_LABELS[severity] ?? severity
}

// ─── URL 状态序列化（restorable filters） ─────────────────────────────────

export type GapTimeBucketGranularity = 'day' | 'iso_week' | 'month'

export const GAP_DEFAULT_DIMENSION: ResourceGapDimension = 'skill'
export const GAP_DEFAULT_TOP_N = 10
export const GAP_DEFAULT_GRANULARITY: GapTimeBucketGranularity = 'iso_week'

export const GAP_TOP_N_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 5, label: 'Top 5' },
  { value: 10, label: 'Top 10' },
  { value: 20, label: 'Top 20' },
  { value: 50, label: 'Top 50' },
]

export interface GapUrlState {
  dimension: ResourceGapDimension
  metric: ResourceGapMetric | null
  severity: ResourceGapSeverity | null
  topN: number
  granularity: GapTimeBucketGranularity
}

function clampTopN(value: number): number {
  if (!Number.isFinite(value)) return GAP_DEFAULT_TOP_N
  return Math.min(50, Math.max(5, Math.round(value)))
}

/** 从 URLSearchParams 解析缺口页状态（非法值回落默认，白名单收敛）。 */
export function parseGapUrlState(searchParams: URLSearchParams): GapUrlState {
  const rawDimension = searchParams.get('dimension') as ResourceGapDimension | null
  const dimension = GAP_DIMENSION_TABS.some((tab) => tab.key === rawDimension)
    ? (rawDimension as ResourceGapDimension)
    : GAP_DEFAULT_DIMENSION
  const rawMetric = searchParams.get('metric') as ResourceGapMetric | null
  const metric = rawMetric && RESOURCE_GAP_METRIC_VALUES.includes(rawMetric) ? rawMetric : null
  const rawSeverity = searchParams.get('severity') as ResourceGapSeverity | null
  const severity =
    rawSeverity && RESOURCE_GAP_SEVERITY_VALUES.includes(rawSeverity) ? rawSeverity : null
  const rawTopN = Number(searchParams.get('topN') ?? String(GAP_DEFAULT_TOP_N))
  const rawGranularity = searchParams.get('granularity') as GapTimeBucketGranularity | null
  const granularity =
    rawGranularity === 'day' || rawGranularity === 'iso_week' || rawGranularity === 'month'
      ? rawGranularity
      : GAP_DEFAULT_GRANULARITY
  return { dimension, metric, severity, topN: clampTopN(rawTopN), granularity }
}

/** 序列化为 URL 参数（仅写非默认值；dimension 恒写保证状态可读）。 */
export function serializeGapUrlState(state: GapUrlState): Record<string, string> {
  const params: Record<string, string> = { dimension: state.dimension }
  if (state.metric) params.metric = state.metric
  if (state.severity) params.severity = state.severity
  if (state.topN !== GAP_DEFAULT_TOP_N) params.topN = String(state.topN)
  if (state.granularity !== GAP_DEFAULT_GRANULARITY) params.granularity = state.granularity
  return params
}

/** 页面状态 → 既有 ResourceGapQuery（供 use-resource-gap-analysis hooks 消费）。 */
export function gapUrlStateToQuery(state: GapUrlState): ResourceGapQuery {
  return {
    metrics: state.metric ? [state.metric] : undefined,
    severity: state.severity ?? undefined,
    topN: state.topN,
    timeBucketGranularity: state.granularity,
  }
}

// ─── 严重度色阶（DOM 令牌 + ECharts 十六进制，双通道） ─────────────────────

/** 严重度 → --nx-* 令牌（chip 颜色通道；文字标签为另一通道）。 */
export const GAP_SEVERITY_TONES: Readonly<Record<ResourceGapSeverity, string>> = {
  critical: '--nx-status-danger',
  high: '--nx-status-warning',
  medium: '--nx-chart-4',
  low: '--nx-chart-1',
  none: '--nx-text-muted',
}

/** 严重度 → 十六进制展开（与 next-tokens.css / nx-dark 主题数值同源）。 */
export const GAP_SEVERITY_HEX: Readonly<Record<ResourceGapSeverity, string>> = {
  critical: '#ef4444', // --nx-status-danger
  high: '#f59e0b', // --nx-status-warning
  medium: '#fbbf24', // --nx-chart-4
  low: '#38bdf8', // --nx-chart-1
  none: '#7a8ba1', // --nx-text-muted
}

export function getGapSeverityTone(severity: ResourceGapSeverity): string {
  return GAP_SEVERITY_TONES[severity] ?? '--nx-text-muted'
}

export function getGapSeverityHex(severity: ResourceGapSeverity): string {
  return GAP_SEVERITY_HEX[severity] ?? GAP_SEVERITY_HEX.none
}

// ─── 图表数据点纯函数 ─────────────────────────────────────────────────────

export interface GapBarModel {
  categories: string[]
  /** 需求容量（小时）。 */
  demandHours: number[]
  /** 供给容量（小时）。 */
  supplyHours: number[]
  /** 缺口容量（小时，柱体主值）。 */
  gapHours: number[]
  /** 每柱严重度（颜色 + 悬浮标签用）。 */
  severities: ResourceGapSeverity[]
  /** 每柱缺口比率（0-1）。 */
  gapRatios: number[]
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100
}

/** 缺口条目列表 → 柱图行模型（按 gapHours 降序，适配 topN 截断后的输入）。 */
export function buildGapBarModel(entries: readonly ResourceGapEntry[]): GapBarModel {
  const sorted = [...entries].sort((a, b) => b.gapHours - a.gapHours)
  const categories: string[] = []
  const demandHours: number[] = []
  const supplyHours: number[] = []
  const gapHours: number[] = []
  const severities: ResourceGapSeverity[] = []
  const gapRatios: number[] = []
  for (const entry of sorted) {
    if (entry.redacted) continue
    categories.push(entry.dimensionLabel || entry.dimensionValue || entry.gapId)
    demandHours.push(roundTwo(entry.demandHours))
    supplyHours.push(roundTwo(entry.supplyHours))
    gapHours.push(roundTwo(entry.gapHours))
    severities.push(entry.severity)
    gapRatios.push(roundTwo(entry.gapRatio))
  }
  return { categories, demandHours, supplyHours, gapHours, severities, gapRatios }
}

/** 缺口小时格式化（保留 1 位小数 + h）。 */
export function formatGapHours(hours: number): string {
  if (!Number.isFinite(hours)) return '—'
  return `${hours.toFixed(1)}h`
}

/** 维度 tab 标签（工作台五维 + 顺序）。 */
export function getGapDimensionTabLabel(dimension: ResourceGapDimension): string | undefined {
  return GAP_DIMENSION_TABS.find((tab) => tab.key === dimension)?.label
}

export type { ResourceGapDimension, ResourceGapEntry, ResourceGapSeverity, ResourceGapMetric }
