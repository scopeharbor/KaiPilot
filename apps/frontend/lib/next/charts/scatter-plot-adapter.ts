/**
 * 双变量散布图镜头纯函数适配层（v3-ui-next-chart-gallery W2 · tasks 2.3/2.4）。
 *
 * 三大 PM 分析维度（design §3.3 / spec「双变量散布图」）：
 * - hours：预估工时 vs 实际工时（消费 tasksApi.list，双方均已记录的叶子任务）；
 * - cost：估算成本 vs 实际成本（costEstimateCents/costActualCents → 元）；
 * - risk：发生概率 vs 影响度（概率/影响 1-5 级，半径按 score 缩放、
 *   颜色按后端 risk_level_service 同款阈值分档）。
 *
 * 统计参考线：
 * - hours/cost 维度：Y=X 45° 理想基准对角线（数据坐标跨轴全宽）；
 * - hours/cost 维度：X/Y 均值虚线划分四象限（design 语言限定在工时与成本维度）；
 * - risk 维度：按 1-5 离散坐标出图，半径/颜色表达敞口，不再叠加均值线。
 *
 * 纯函数、零 DOM、零网络（RL-01）；Tooltip 正文构造器独立导出供单测。
 */
import type { Risk } from '@/lib/api/risks'
import type { Task } from '@/lib/api/tasks'

export type ScatterDimensionId = 'hours' | 'cost' | 'risk'

export interface ScatterDimensionMeta {
  id: ScatterDimensionId
  /** 切换 Tab 文案。 */
  tabLabel: string
  /** 图题（Toolbar 汇出视图段语义同源，由镜头自行组织）。 */
  chartTitle: string
  /** 横轴标签。 */
  xLabel: string
  /** 纵轴标签。 */
  yLabel: string
  /** 数值单位（工时 h / 元）。 */
  unit: string
  /** 是否绘制 Y=X 理想基准线与均值象限线。 */
  hasIdealLine: boolean
}

export const SCATTER_DIMENSIONS: Record<ScatterDimensionId, ScatterDimensionMeta> = {
  hours: {
    id: 'hours',
    tabLabel: '工时偏差',
    chartTitle: '预估工时 vs 实际工时',
    xLabel: '预估工时 (h)',
    yLabel: '实际工时 (h)',
    unit: 'h',
    hasIdealLine: true,
  },
  cost: {
    id: 'cost',
    tabLabel: '成本偏差',
    chartTitle: '估算成本 vs 实际成本',
    xLabel: '估算成本 (元)',
    yLabel: '实际成本 (元)',
    unit: '元',
    hasIdealLine: true,
  },
  risk: {
    id: 'risk',
    tabLabel: '风险敞口',
    chartTitle: '风险发生概率 vs 影响度',
    xLabel: '发生概率 (1-5 级)',
    yLabel: '影响度 (1-5 级)',
    unit: '级',
    hasIdealLine: false,
  },
}

export const SCATTER_DIMENSION_ORDER: readonly ScatterDimensionId[] = ['hours', 'cost', 'risk']

/** 语义色板 = --nx-* 令牌数值展开（与 nx-dark 主题同源）。 */
export const NX_CHART_1 = '#38bdf8'
export const NX_STATUS_DANGER = '#ef4444'
export const NX_TEXT_MUTED = '#7a8ba1'

/** 风险敞口分档色（阈值对齐后端 risk_level_service：低 <4 / 中 4-9 / 高 10-15 / 极 16+）。 */
export const RISK_BAND_COLOR = {
  low: '#34d399', // --nx-chart-3 / --nx-status-success 同族
  medium: '#fbbf24', // --nx-chart-4 / --nx-status-warning 同族
  high: '#f87171', // --nx-chart-5
  critical: '#ef4444', // --nx-status-danger
} as const

export type RiskBand = keyof typeof RISK_BAND_COLOR

export function riskScoreBand(score: number): RiskBand {
  if (score >= 16) return 'critical'
  if (score >= 10) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

export function riskBandLabel(band: RiskBand): string {
  switch (band) {
    case 'critical':
      return '极高'
    case 'high':
      return '高'
    case 'medium':
      return '中'
    default:
      return '低'
  }
}

/** 分（cents）→ 元（保留 2 位）。 */
export function centsToYuan(cents: number): number {
  return Math.round(cents) / 100
}

// ---------------------------------------------------------------------------
// 散点构建
// ---------------------------------------------------------------------------

export interface ScatterPoint {
  /** 任务名 / 风险标题。 */
  name: string
  x: number
  y: number
  /** 偏离量 pct：工时/成本 (y-x)/x*100（x<=0 时为 null）；风险维度为 null。 */
  deviationPercent: number | null
  /** 风险维度：敞口得分。 */
  score: number | null
  /** 风险维度：分档色；其余维度 chart-1。 */
  color: string
  /** 风险维度：半径随得分缩放；其余维度统一 8。 */
  radius: number
  /** Tooltip 数据源（任务/风险对象），供镜头 tooltip 回调展开。 */
  sourceId: number
  sourceKind: 'task' | 'risk'
}

/** 半径缩放分母：当前集合最大得分；得分全零时退化为 1（防除零）。 */
export function maxScoreOf(points: ScatterPoint[]): number {
  let max = 0
  for (const point of points) {
    if (point.score !== null && point.score > max) max = point.score
  }
  return max || 1
}

/** 得分 → 散点半径（6~18px 线性缩放）。 */
export function radiusForScore(score: number, maxScore: number): number {
  if (score <= 0) return 6
  return Math.round((6 + (score / (maxScore || 1)) * 12) * 10) / 10
}

export function deviationPercentOf(estimate: number, actual: number): number | null {
  if (!Number.isFinite(estimate) || estimate <= 0 || !Number.isFinite(actual)) return null
  return Math.round(((actual - estimate) / estimate) * 1000) / 10
}

/**
 * 任务散点（hours/cost 维度）。工时：estimatedHours/actualHours 均已记录；
 * 成本：costEstimateCents/costActualCents 均已记录（转元）。
 */
export function buildTaskPoints(tasks: Task[], dimension: 'hours' | 'cost'): ScatterPoint[] {
  const points: ScatterPoint[] = []
  for (const task of tasks) {
    let x: number | null = null
    let y: number | null = null
    if (dimension === 'hours') {
      if (task.estimatedHours === null || task.actualHours === null) continue
      x = task.estimatedHours
      y = task.actualHours
    } else {
      if (task.costEstimateCents === null || task.costActualCents === null) continue
      x = centsToYuan(task.costEstimateCents)
      y = centsToYuan(task.costActualCents)
    }
    if (x === null || y === null) continue
    points.push({
      name: task.name,
      x,
      y,
      deviationPercent: deviationPercentOf(x, y),
      score: null,
      color: NX_CHART_1,
      radius: 8,
      sourceId: task.id,
      sourceKind: 'task',
    })
  }
  return points
}

/** 风险散点（概率 1-5 / 影响 1-5；半径与颜色按 score 敞口）。 */
export function buildRiskPoints(risks: Risk[]): ScatterPoint[] {
  const points = risks.map<ScatterPoint>((risk) => {
    const band = riskScoreBand(risk.score)
    return {
      name: risk.title,
      x: risk.probability,
      y: risk.impact,
      deviationPercent: null,
      score: risk.score,
      color: RISK_BAND_COLOR[band],
      radius: 8,
      sourceId: risk.id,
      sourceKind: 'risk',
    }
  })
  const maxScore = maxScoreOf(points)
  for (const point of points) {
    if (point.score !== null) point.radius = radiusForScore(point.score, maxScore)
  }
  return points
}

export interface ScatterDataModel {
  points: ScatterPoint[]
  /** X/Y 均值（hours/cost 维度象限线；集合空或为 null）。 */
  meanX: number | null
  meanY: number | null
  /** 双侧联合数据域 [lo, hi]（跨 X/Y 取界 + 10% 内边距）；空集返回 null。 */
  domain: { lo: number; hi: number } | null
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const value of values) sum += value
  return Math.round((sum / values.length) * 100) / 100
}

/** 联合数据域：覆盖 X 与 Y 全部取值，向两侧各扩 10%（保底 >0，零值集保底 1）。 */
export function computeScatterDomain(points: ScatterPoint[]): { lo: number; hi: number } | null {
  if (points.length === 0) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of points) {
    min = Math.min(min, point.x, point.y)
    max = Math.max(max, point.x, point.y)
  }
  const pad = Math.max((max - min) * 0.1, min === 0 ? 1 : 0)
  let lo = Math.floor((min - pad) * 100) / 100
  if (lo < 0) lo = 0
  let hi = Math.ceil((max + pad) * 100) / 100
  if (hi <= lo) hi = lo + 1
  return { lo, hi }
}

/** 散点 + 统计 → 渲染模型（均值/域一次计算，组件与测试共用）。 */
export function buildScatterModel(points: ScatterPoint[]): ScatterDataModel {
  return {
    points,
    meanX: meanOf(points.map((point) => point.x)),
    meanY: meanOf(points.map((point) => point.y)),
    domain: computeScatterDomain(points),
  }
}

// ---------------------------------------------------------------------------
// Tooltip 正文（暗黑控制台微标风格 HTML，纯函数便于单测）
// ---------------------------------------------------------------------------

function tag(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;gap:18px"><span>${label}</span><b style="color:#f1f5f9">${value}</b></div>`
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

/** 工时/成本散点 Tooltip：任务名 + 数值 + 偏离量与偏差百分比。 */
export function formatEstimateTooltipHtml(point: ScatterPoint, meta: ScatterDimensionMeta): string {
  const deviation = point.deviationPercent
  const rows = [
    `<div style="color:#f1f5f9;font-weight:600;margin-bottom:4px">${point.name}</div>`,
    tag(`预估${meta.id === 'hours' ? '工时' : '成本'}`, `${formatNumber(point.x)} ${meta.unit}`),
    tag(`实际${meta.id === 'hours' ? '工时' : '成本'}`, `${formatNumber(point.y)} ${meta.unit}`),
  ]
  if (deviation !== null) {
    const over = deviation > 0
    const color = Math.abs(deviation) < 0.5 ? NX_TEXT_MUTED : over ? NX_STATUS_DANGER : '#34d399'
    const glyph = Math.abs(deviation) < 0.5 ? '持平' : over ? '超支/延期' : '结余/提速'
    rows.push(tag('偏差', `<span style="color:${color}">${glyph} ${Math.abs(deviation)}%</span>`))
  }
  return rows.join('')
}

/** 风险散点 Tooltip：标题 + 概率/影响/敞口分档。 */
export function formatRiskTooltipHtml(point: ScatterPoint): string {
  const band = point.score === null ? 'low' : riskScoreBand(point.score)
  const rows = [
    `<div style="color:#f1f5f9;font-weight:600;margin-bottom:4px">${point.name}</div>`,
    tag('发生概率', `${point.x} 级`),
    tag('影响度', `${point.y} 级`),
    tag(
      '敞口得分',
      `<span style="color:${RISK_BAND_COLOR[band]}">${point.score ?? '-'} · ${riskBandLabel(band)}风险</span>`,
    ),
  ]
  return rows.join('')
}
