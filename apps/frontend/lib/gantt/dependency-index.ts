/**
 * 甘特依赖线 —— 空间索引与几何预算（design D9 / task 4.2、4.7）。
 *
 * - **条盒/端点几何缓存**（4.7）：任务条盒与依赖端点坐标只在 scale/模型/行序变化时重算一次，
 *   滚动时复用（Canvas 层按 -scroll 平移即可，禁止逐帧重算贝塞尔）。
 * - **端点空间索引**（4.2/D9）：把依赖按端点所在行分桶，使「找出与可见行相交的连线」为 O(命中)
 *   而非 O(全部依赖)；随结构（依赖/行序/折叠/刻度）变化重建，不随滚动重建。
 *
 * 纯数据结构、无副作用、可单测。
 */

import { dayToX, dependencyEndpoints, durationToWidth, type GanttScale } from './geometry'
import type { GanttRenderDependency, GanttRenderTask } from './types'

/** 任务条盒（图表绝对坐标）。里程碑 width=0，锚点在 x。 */
export interface BarBox {
  x: number
  width: number
  rowIndex: number
}

/** 依赖端点几何（图表绝对坐标）+ 两端行号（供视口裁剪）。 */
export interface DepEndpoints {
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
  predRow: number
  succRow: number
}

/** 任务 id → 行号（行序＝`tasks` 数组序）。 */
export function buildRowIndex(tasks: GanttRenderTask[]): Map<number, number> {
  const map = new Map<number, number>()
  for (let i = 0; i < tasks.length; i++) map.set(tasks[i]!.id, i)
  return map
}

/** 任务 id → 条盒。只在 scale/模型/行序变化时重算（4.7 几何缓存）。 */
export function buildBarBoxes(scale: GanttScale, tasks: GanttRenderTask[]): Map<number, BarBox> {
  const boxes = new Map<number, BarBox>()
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!
    boxes.set(t.id, {
      x: dayToX(scale, t.startDay),
      width: durationToWidth(scale, t.durationDays),
      rowIndex: i,
    })
  }
  return boxes
}

/** 依赖端点几何缓存。跳过端点任务缺失的依赖（数据不一致时不崩）。 */
export function buildDepEndpoints(
  scale: GanttScale,
  deps: GanttRenderDependency[],
  boxes: Map<number, BarBox>,
): Map<number, DepEndpoints> {
  const out = new Map<number, DepEndpoints>()
  for (const dep of deps) {
    const pred = boxes.get(dep.predecessorId)
    const succ = boxes.get(dep.successorId)
    if (!pred || !succ) continue
    const e = dependencyEndpoints(scale, pred, succ, dep.type)
    out.set(dep.id, {
      id: dep.id,
      x1: e.x1,
      y1: e.y1,
      x2: e.x2,
      y2: e.y2,
      predRow: pred.rowIndex,
      succRow: succ.rowIndex,
    })
  }
  return out
}

/**
 * 依赖端点空间索引：按端点所在行分桶。查询与可见行区间相交的依赖为 O(区间行数 + 命中)。
 * 随结构变化重建（依赖集/行序），不随滚动重建。
 */
export class DependencyIndex {
  private readonly byRow = new Map<number, number[]>()

  constructor(deps: GanttRenderDependency[], rowIndexByTask: Map<number, number>) {
    for (const dep of deps) {
      const predRow = rowIndexByTask.get(dep.predecessorId)
      const succRow = rowIndexByTask.get(dep.successorId)
      if (predRow === undefined || succRow === undefined) continue
      this.push(predRow, dep.id)
      if (succRow !== predRow) this.push(succRow, dep.id)
    }
  }

  private push(row: number, depId: number): void {
    const list = this.byRow.get(row)
    if (list) list.push(depId)
    else this.byRow.set(row, [depId])
  }

  /** 返回至少一端落在 [minRow, maxRow]（含端点）的依赖 id 集合。 */
  incidentToRange(minRow: number, maxRow: number): Set<number> {
    const hits = new Set<number>()
    for (let row = minRow; row <= maxRow; row++) {
      const list = this.byRow.get(row)
      if (list) for (const id of list) hits.add(id)
    }
    return hits
  }
}

/** 把可见时间窗（天）换算为像素区间（带缓冲）。 */
export function dayRangeToPx(
  scale: GanttScale,
  dayRange: { startDay: number; endDay: number },
  bufferPx: number,
): { minX: number; maxX: number } {
  return {
    minX: dayToX(scale, dayRange.startDay) - bufferPx,
    maxX: dayToX(scale, dayRange.endDay) + bufferPx,
  }
}
