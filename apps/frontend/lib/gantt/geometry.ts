/**
 * 甘特渲染核 —— 运行时布局几何（纯函数）。
 *
 * **复用来源**：由 `apps/frontend/lib/gantt-m0/layout.ts`（gantt-performance-poc / M0 留存资产）转正，
 * 沿用「行=任务、x=距 epoch 的整数天偏移 × 每天像素」的线性像素换算与固定 epoch 语义（design D5），
 * 扩展为日/周/月/季四档粒度，并把依赖锚点按 fs/ss/ff/sf 精确化。
 *
 * 纯函数、无副作用、无 `Date.now`：坐标只由 `GanttScale` 决定，保证可复现与快速换算
 * （避免每条图元过 D3 scale）。时间轴刻度标签由 `buildTimeTicks` 生成，容器用 @visx/axis 消费。
 */

import type { GanttGranularity } from './types'

/** 固定 epoch 常量（非 `Date.now`），保证时间轴映射可复现（承自 M0 `CHART_EPOCH_MS`）。 */
export const CHART_EPOCH_MS = Date.parse('2026-01-01T00:00:00Z')

const MS_PER_DAY = 86_400_000

/** 每天像素默认值：日密、季疏；切换粒度触发坐标重排（数据不变）。 */
export const DEFAULT_PX_PER_DAY: Record<GanttGranularity, number> = {
  day: 28,
  week: 8,
  month: 3,
  quarter: 1.3,
}

/** 默认行高（px）；实际由密度令牌 `--row-h` 解析后传入。 */
export const DEFAULT_ROW_HEIGHT = 34

/** 冻结左栏默认宽度（px）。 */
export const DEFAULT_LEFT_COLUMN_WIDTH = 260

/** 时间轴表头高度（px）。 */
export const TIME_AXIS_HEIGHT = 44

/** 坐标系配置：粒度 + 像素密度 + 行高 + epoch。切换任一即触发几何重算。 */
export interface GanttScale {
  granularity: GanttGranularity
  pxPerDay: number
  rowHeight: number
  epochMs: number
}

export function createScale(
  granularity: GanttGranularity,
  opts: { rowHeight?: number; epochMs?: number; pxPerDay?: number } = {},
): GanttScale {
  return {
    granularity,
    pxPerDay: opts.pxPerDay ?? DEFAULT_PX_PER_DAY[granularity],
    rowHeight: opts.rowHeight ?? DEFAULT_ROW_HEIGHT,
    epochMs: opts.epochMs ?? CHART_EPOCH_MS,
  }
}

// --- 水平（时间）换算 -------------------------------------------------------

export function dayToX(scale: GanttScale, day: number): number {
  return day * scale.pxPerDay
}

export function xToDay(scale: GanttScale, x: number): number {
  return x / scale.pxPerDay
}

export function durationToWidth(scale: GanttScale, durationDays: number): number {
  // 里程碑（0 工期）宽度归零，由菱形标记表达；叶子任务保底 3px 可见。
  if (durationDays <= 0) return 0
  return Math.max(3, durationDays * scale.pxPerDay)
}

export function chartWidth(scale: GanttScale, spanDays: number): number {
  return Math.max(320, Math.ceil(spanDays * scale.pxPerDay))
}

// --- 垂直（行）换算 ---------------------------------------------------------

export function rowTop(scale: GanttScale, rowIndex: number): number {
  return rowIndex * scale.rowHeight
}

export function rowCenterY(scale: GanttScale, rowIndex: number): number {
  return rowIndex * scale.rowHeight + scale.rowHeight / 2
}

export function rowIndexAtY(scale: GanttScale, y: number): number {
  return Math.floor(y / scale.rowHeight)
}

export function chartHeight(scale: GanttScale, rowCount: number): number {
  return rowCount * scale.rowHeight
}

// --- 日期换算 ---------------------------------------------------------------

export function dayToDate(scale: GanttScale, day: number): Date {
  return new Date(scale.epochMs + day * MS_PER_DAY)
}

/** 真实时刻（ms）→ 距 epoch 的整数天偏移（向下取整到天）。 */
export function dateToDay(scale: GanttScale, dateMs: number): number {
  return Math.floor((dateMs - scale.epochMs) / MS_PER_DAY)
}

// --- 依赖锚点与连线 ---------------------------------------------------------

/** 依赖类型 → 前置/后置任务的锚点边（start=条头、finish=条尾）。 */
export type DependencyAnchorSide = 'start' | 'finish'

export interface DependencyEndpoints {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface BarBox {
  x: number
  width: number
  rowIndex: number
}

function anchorX(box: BarBox, side: DependencyAnchorSide): number {
  return side === 'finish' ? box.x + box.width : box.x
}

/** fs/ss/ff/sf → (前置锚点边, 后置锚点边)。 */
const DEP_ANCHORS: Record<string, [DependencyAnchorSide, DependencyAnchorSide]> = {
  fs: ['finish', 'start'],
  ss: ['start', 'start'],
  ff: ['finish', 'finish'],
  sf: ['start', 'finish'],
}

/** 由前置/后置任务的条盒与依赖类型算出连线端点。 */
export function dependencyEndpoints(
  scale: GanttScale,
  predecessor: BarBox,
  successor: BarBox,
  type: string,
): DependencyEndpoints {
  const [predSide, succSide] = DEP_ANCHORS[type] ?? DEP_ANCHORS.fs!
  return {
    x1: anchorX(predecessor, predSide),
    y1: rowCenterY(scale, predecessor.rowIndex),
    x2: anchorX(successor, succSide),
    y2: rowCenterY(scale, successor.rowIndex),
  }
}

/**
 * 依赖连线的三次贝塞尔 path（承自 M0 `dependencyPath`）：水平出入的平滑曲线，
 * 控制点按水平跨度自适应，短距离也保留最小 24px 弧度，避免直角折线的廉价观感。
 */
export function dependencyPath(e: DependencyEndpoints): string {
  const dx = Math.max(24, Math.abs(e.x2 - e.x1) * 0.5)
  return `M${e.x1},${e.y1} C${e.x1 + dx},${e.y1} ${e.x2 - dx},${e.y2} ${e.x2},${e.y2}`
}

// --- 时间轴刻度 -------------------------------------------------------------

export interface TimeTick {
  /** 屏幕 x（相对图表原点）。 */
  x: number
  /** 距 epoch 天偏移。 */
  day: number
  label: string
  /** 主刻度（月/季边界）加粗，次刻度较淡。 */
  major: boolean
}

/** 每档粒度的刻度步长（天）：日=1、周=7、月≈自然月、季≈自然季（由 label 逻辑对齐月首）。 */
function tickStepDays(g: GanttGranularity): number {
  switch (g) {
    case 'day':
      return 1
    case 'week':
      return 7
    case 'month':
      return 30
    case 'quarter':
      return 91
  }
}

const ZH_MONTHS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
]

/**
 * 生成 [startDay, endDay] 区间的时间轴刻度。日/周粒度按等距天步长；月/季对齐自然月首，
 * 主刻度落在月/季边界。标签本地化为简体中文。纯函数、可单测。
 */
export function buildTimeTicks(
  scale: GanttScale,
  range: { startDay: number; endDay: number },
): TimeTick[] {
  const ticks: TimeTick[] = []
  const g = scale.granularity
  if (g === 'day' || g === 'week') {
    const step = tickStepDays(g)
    for (let day = range.startDay; day <= range.endDay; day += step) {
      const d = dayToDate(scale, day)
      const isMonthStart = d.getUTCDate() <= step
      ticks.push({
        x: dayToX(scale, day),
        day,
        label:
          g === 'day'
            ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
            : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
        major: isMonthStart,
      })
    }
    return ticks
  }
  // 月/季：从起点所在月首开始，逐月/逐季步进，对齐自然边界。
  const start = dayToDate(scale, range.startDay)
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  const endMs = scale.epochMs + range.endDay * MS_PER_DAY
  const monthStride = g === 'quarter' ? 3 : 1
  while (cursor <= endMs) {
    const d = new Date(cursor)
    const day = dateToDay(scale, cursor)
    const month = d.getUTCMonth()
    const isQuarterStart = month % 3 === 0
    ticks.push({
      x: dayToX(scale, day),
      day,
      label:
        g === 'quarter'
          ? `${d.getUTCFullYear()} Q${Math.floor(month / 3) + 1}`
          : month === 0
            ? `${d.getUTCFullYear()}年`
            : ZH_MONTHS[month]!,
      major: g === 'quarter' ? isQuarterStart : month === 0,
    })
    cursor = Date.UTC(d.getUTCFullYear(), month + monthStride, 1)
  }
  return ticks
}

/** 判断某天是否为周末（非工作日底纹用；holidays 由上游注入，本函数只判周六日）。 */
export function isWeekend(scale: GanttScale, day: number): boolean {
  const dow = dayToDate(scale, day).getUTCDay()
  return dow === 0 || dow === 6
}
