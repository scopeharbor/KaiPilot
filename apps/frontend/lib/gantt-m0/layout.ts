/**
 * gantt-performance-poc / M0 —— 共享布局几何（纯函数）。
 *
 * 供纯 SVG（方案 A）、SVG+Canvas 混合（方案 B）与 frappe 适配层共用同一坐标系：
 * 行=任务（按任务 id 顺序），x=距 epoch 的天偏移 × 每天像素。时间轴由容器用 @visx/scale 的
 * scaleTime + @visx/axis 渲染（任务 3.1，`dayToDate` 提供 domain）；任务条/依赖锚点用等价
 * 线性像素换算以避免每条都过 D3 scale。
 */

export type Granularity = 'day' | 'week'

/** 行高（px）。刻意偏小以在 1000 行下制造足够长的虚拟滚动区。 */
export const ROW_HEIGHT = 26

/** 固定 epoch 常量（非 Date.now），保证时间轴映射可复现。 */
export const CHART_EPOCH_MS = Date.parse('2026-01-01T00:00:00Z')

/** 每天像素：day 粒度较密、week 粒度较疏（切换时触发重排程，供测量）。 */
export const PX_PER_DAY: Record<Granularity, number> = { day: 12, week: 3 }

export function dayToDate(day: number): Date {
  return new Date(CHART_EPOCH_MS + day * 86_400_000)
}

export function chartWidth(spanDays: number, g: Granularity): number {
  return Math.max(320, Math.ceil(spanDays * PX_PER_DAY[g]))
}

export function barX(startDay: number, g: Granularity): number {
  return startDay * PX_PER_DAY[g]
}

export function barWidth(durationDays: number, g: Granularity): number {
  return Math.max(3, durationDays * PX_PER_DAY[g])
}

export function rowTop(rowIndex: number): number {
  return rowIndex * ROW_HEIGHT
}

export function rowCenterY(rowIndex: number): number {
  return rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2
}

/**
 * 依赖连线的贝塞尔 path：从前置条尾端到后置条头端（POC 统一用「尾→头」锚点，
 * 不区分 FS/SS/FF/SF 的精确锚点，仅以颜色区分类型——几何成本等价，足够测渲染开销）。
 */
export function dependencyPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(24, Math.abs(x2 - x1) * 0.5)
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
}

/** 四类依赖的区分色（仅视觉，用于证明四类都被渲染）。 */
export const DEPENDENCY_COLOR: Record<string, string> = {
  FS: '#6366f1',
  SS: '#0ea5e9',
  FF: '#f59e0b',
  SF: '#ec4899',
}
