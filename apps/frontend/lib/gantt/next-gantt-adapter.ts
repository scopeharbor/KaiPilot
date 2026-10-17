/**
 * 新轨甘特镜头（v3-ui-next-gantt-lens W1）—— 数据适配与确定性几何层。
 *
 * 职责（tasks 1.1 / design D1）：
 * - **数据适配**：组合既有 `useProjectGanttModel`（并行拉项目/1000 任务/依赖/里程碑，
 *   组织隔离由服务端保证，前端零脏数据残留）并经由 `buildNextGanttModel` 把
 *   `GanttModel` 增强为带 5 级优先级等确定性渲染属性的 `NextGanttModel`；
 * - **时间比例尺**：以 `@visx/scale` 的 `scaleTime` 驱动「时间定义域 → 像素值域」线性映射
 *   （日单元格 40px / 周 80px / 月 ≈120px，design D1.4）；
 * - **双向视口裁剪**：`ROW_BUFFER = 4` 纵向行裁剪 + `DAY_BUFFER = 4` 横向天窗口裁剪
 *   （design D1.3），配合 `DependencyIndex` 空间相交索引过滤视口外依赖；
 * - **确定性图元属性**：状态发丝线令牌、优先级微标令牌与文案、里程碑令牌、
 *   四类依赖（FS/SS/FF/SF）正交折线路径纯函数。
 *
 * 纯函数优先、无副作用，jsdom/SSR 均可用；hooks 部分消费 TanStack Query（只读）。
 */

'use client'

import { useMemo } from 'react'
import { scaleTime } from '@visx/scale'
import { useProjectGanttModel } from '@/hooks/use-project-gantt'
import type { TaskPriority, TaskStatus } from '@/lib/api/tasks'
import type { MilestoneStatus } from '@/lib/api/milestones'
import type { Project } from '@/lib/api/projects'
import {
  buildBarBoxes,
  buildDepEndpoints,
  buildRowIndex,
  dayRangeToPx,
  DependencyIndex,
  type DepEndpoints,
} from './dependency-index'
import type {
  GanttModel,
  GanttMilestoneMark,
  GanttRenderDependency,
  GanttRenderTask,
} from './types'
import type { DependencyType } from './types'

/** 复用旧轨行索引构建（任务 id → 行号）。 */
export { buildRowIndex } from './dependency-index'

const MS_PER_DAY = 86_400_000

/** @visx scaleTime 实例的最小调用签名（`@visx/vendor/d3-scale` 未声明为直接依赖，
 *  仅以结构类型描述「时间 → 像素」映射，避免引入未声明包）。 */
export type NextTimeScale = (value: Date | number) => number

// --- 新轨画板常量（design D1.3 / D1.4） -------------------------------------------

/** 新轨时间粒度（旧轨另有 quarter，新轨三档）。 */
export type NextGranularity = 'day' | 'week' | 'month'

/** 粒度 → 中文文案。 */
export const NX_GRANULARITY_LABEL: Record<NextGranularity, string> = {
  day: '日',
  week: '周',
  month: '月',
}

/** 单格固定列宽（px）：日 40 / 周 80 / 月 ≈120（按 30 天均值 4px/天，自然月列宽 112–124px）。 */
export const NX_CELL_PX: Record<NextGranularity, number> = {
  day: 40,
  week: 80,
  month: 120,
}

/** 每天像素数（周 = 80/7、月 = 120/30 = 4）。 */
export const NX_PX_PER_DAY: Record<NextGranularity, number> = {
  day: NX_CELL_PX.day,
  week: NX_CELL_PX.week / 7,
  month: NX_CELL_PX.month / 30,
}

/** 默认行高（px）。 */
export const NX_ROW_HEIGHT = 36

/** 时间刻度表头高度（px）。 */
export const NX_TIME_AXIS_HEIGHT = 44

/** 纵向缓冲行数（design D1.3）。 */
export const ROW_BUFFER = 4

/** 横向缓冲天数（design D1.3）。 */
export const DAY_BUFFER = 4

/** 依赖线横向相交缓冲（px，design D1.3：minX−240 / maxX+240）。 */
export const NX_DEP_PX_BUFFER = 240

/** 画板右端留白（px），避免最右任务条贴边。 */
export const NX_HORIZONTAL_PAD_PX = 48

// --- 确定性图元令牌与文案（design D18 方案 A，仅消费 --nx-* 令牌） ------------------

/** 任务 6 状态 → 发丝线边框令牌。 */
export const NEXT_STATUS_HAIRLINE_TOKEN: Record<TaskStatus, string> = {
  completed: '--nx-status-success',
  in_progress: '--nx-space-cyan',
  not_started: '--nx-text-muted',
  blocked: '--nx-status-danger',
  on_hold: '--nx-status-warning',
  cancelled: '--nx-text-muted',
}

/** 任务 6 状态 → 中文文案。 */
export const NEXT_STATUS_LABEL: Record<TaskStatus, string> = {
  completed: '已完成',
  in_progress: '进行中',
  not_started: '未开始',
  blocked: '受阻',
  on_hold: '已挂起',
  cancelled: '已取消',
}

/** 5 级优先级 → 微标填充令牌（最低/低/中/高/紧急）。 */
export const NEXT_PRIORITY_TOKEN: Record<TaskPriority, string> = {
  lowest: '--nx-text-muted',
  low: '--nx-chart-6',
  medium: '--nx-chart-3',
  high: '--nx-chart-7',
  highest: '--nx-status-danger',
}

/** 5 级优先级 → 中文文案。 */
export const NEXT_PRIORITY_LABEL: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '紧急',
}

/** 优先级排序权重（微标/排序用）。 */
export const NEXT_PRIORITY_RANK: Record<TaskPriority, number> = {
  lowest: 0,
  low: 1,
  medium: 2,
  high: 3,
  highest: 4,
}

/** 里程碑 5 状态 → 菱形填充令牌。 */
export const NEXT_MILESTONE_TOKEN: Record<MilestoneStatus, string> = {
  not_started: '--nx-text-muted',
  planned: '--nx-workspace-blue',
  at_risk: '--nx-status-warning',
  achieved: '--nx-status-success',
  missed: '--nx-status-danger',
}

/** 里程碑 5 状态 → 中文文案。 */
export const NEXT_MILESTONE_LABEL: Record<MilestoneStatus, string> = {
  not_started: '未开始',
  planned: '规划中',
  at_risk: '风险',
  achieved: '已达成',
  missed: '已错过',
}

// --- 时间比例尺（@visx/scale scaleTime 驱动） --------------------------------------

/** 距 epoch 的整数天偏移 → 真实毫秒。 */
export function dayMs(epochMs: number, day: number): number {
  return epochMs + day * MS_PER_DAY
}

/** 真实毫秒 → 距 epoch 的整数天偏移（向下取整）。 */
export function dayOf(epochMs: number, ms: number): number {
  return Math.floor((ms - epochMs) / MS_PER_DAY)
}

/** 新轨时间比例尺：scaleTime（线性）+ 渲染几何常量。 */
export interface NextGanttScale {
  granularity: NextGranularity
  /** 每天像素数。 */
  pxPerDay: number
  rowHeight: number
  epochMs: number
  /** 时间轴总跨度（天，含今天右延）。 */
  spanDays: number
  /** @visx/scale `scaleTime`：时间定义域 → 像素值域。 */
  timeScale: NextTimeScale
}

/**
 * 由模型组装新轨时间比例尺。向右扩展至今天（+7 天余量），保证「定位到今天」可聚焦。
 * 定义域 = [epochMs, epochMs + spanDays×天]，值域 = [0, spanDays×pxPerDay]（线性）。
 */
export function buildNextTimeScale(
  model: GanttModel,
  granularity: NextGranularity,
  opts: { rowHeight?: number; todayMs?: number } = {},
): NextGanttScale {
  const rowHeight = opts.rowHeight ?? NX_ROW_HEIGHT
  const pxPerDay = NX_PX_PER_DAY[granularity]
  const todayDay =
    opts.todayMs != null ? dayOf(model.epochMs, opts.todayMs) : Number.NEGATIVE_INFINITY
  const endDay = Math.max(model.timeRange.endDay, todayDay + 7)
  const spanDays = Math.max(1, endDay - Math.min(0, model.timeRange.startDay))
  const timeScale = scaleTime<number>({
    domain: [model.epochMs, model.epochMs + spanDays * MS_PER_DAY],
    range: [0, spanDays * pxPerDay],
  })
  return { granularity, pxPerDay, rowHeight, epochMs: model.epochMs, spanDays, timeScale }
}

/** day → 画板 x（图表绝对坐标）。 */
export function nxDayToX(scale: NextGanttScale, day: number): number {
  return scale.timeScale(dayMs(scale.epochMs, day))
}

/** x → day（线性反算，供视口窗口推算）。 */
export function nxXToDay(scale: NextGanttScale, x: number): number {
  return x / scale.pxPerDay
}

export function nxRowTop(scale: NextGanttScale, rowIndex: number): number {
  return rowIndex * scale.rowHeight
}

export function nxRowCenterY(scale: NextGanttScale, rowIndex: number): number {
  return rowIndex * scale.rowHeight + scale.rowHeight / 2
}

export function nxChartHeight(scale: NextGanttScale, rowCount: number): number {
  return rowCount * scale.rowHeight
}

export function nxChartWidth(scale: NextGanttScale): number {
  return Math.max(320, Math.ceil(scale.spanDays * scale.pxPerDay) + NX_HORIZONTAL_PAD_PX)
}

// --- 视口与双向裁剪（design D1.3） --------------------------------------------------

export interface NextGanttViewport {
  width: number
  height: number
  scrollLeft: number
  scrollTop: number
}

export interface RowRange {
  startRow: number
  endRow: number
}

export interface DayRange {
  startDay: number
  endDay: number
}

/** 纵向虚拟行窗口（±ROW_BUFFER）。 */
export function visibleRowRange(
  viewport: NextGanttViewport,
  scale: NextGanttScale,
  rowCount: number,
): RowRange {
  const startRow = Math.max(0, Math.floor(viewport.scrollTop / scale.rowHeight) - ROW_BUFFER)
  const endRow = Math.min(
    rowCount - 1,
    Math.ceil((viewport.scrollTop + viewport.height) / scale.rowHeight) + ROW_BUFFER,
  )
  return { startRow, endRow }
}

/** 横向时间窗口（±DAY_BUFFER 天）。 */
export function visibleDayRange(viewport: NextGanttViewport, scale: NextGanttScale): DayRange {
  return {
    startDay: Math.floor(nxXToDay(scale, viewport.scrollLeft)) - DAY_BUFFER,
    endDay: Math.ceil(nxXToDay(scale, viewport.scrollLeft + viewport.width)) + DAY_BUFFER,
  }
}

/** 判断某天是否为周末（UTC，非工作日阴影块用）。 */
export function isWeekendDay(scale: NextGanttScale, day: number): boolean {
  const dow = new Date(dayMs(scale.epochMs, day)).getUTCDay()
  return dow === 0 || dow === 6
}

/** 网格发丝线的步长（天）：按粒度对齐单元格边界，控制线数 ≤ 50。 */
export function gridStepDays(granularity: NextGranularity): number {
  return granularity === 'day' ? 1 : granularity === 'week' ? 7 : 30
}

/** 纵向+横向双向裁剪可见任务条（不含里程碑行，菱形由 milestones 标记驱动）。 */
export function selectVisibleBars(
  tasks: GanttRenderTask[],
  rows: RowRange,
  days: DayRange,
): GanttRenderTask[] {
  const out: GanttRenderTask[] = []
  for (let i = rows.startRow; i <= rows.endRow; i++) {
    const task = tasks[i]
    if (!task || task.kind === 'milestone') continue
    const endDay = task.startDay + Math.max(0, task.durationDays - 1)
    if (task.startDay <= days.endDay && endDay >= days.startDay) out.push(task)
  }
  return out
}

/** 里程碑标记 + 所在行号（菱形锚点）。 */
export interface NextMilestoneMark {
  mark: GanttMilestoneMark
  rowIndex: number
}

/** 纵向+横向双向裁剪可见里程碑。 */
export function selectVisibleMilestones(
  model: GanttModel,
  rowIndex: Map<number, number>,
  rows: RowRange,
  days: DayRange,
): NextMilestoneMark[] {
  const out: NextMilestoneMark[] = []
  for (const mark of model.milestones) {
    const ri = rowIndex.get(mark.taskId)
    if (ri === undefined) continue
    if (ri < rows.startRow || ri > rows.endRow) continue
    if (mark.day < days.startDay || mark.day > days.endDay) continue
    out.push({ mark, rowIndex: ri })
  }
  return out
}

/** 依赖空间相交索引：命中可见行区间的依赖 id 集合。 */
export function selectVisibleDepIds(index: DependencyIndex, rows: RowRange): Set<number> {
  return index.incidentToRange(rows.startRow, rows.endRow)
}

/** 水平跨度与「可见时间窗像素区间 + 240px 缓冲」相交的依赖（design D1.3）。 */
export function filterDepsByPxWindow(
  deps: GanttRenderDependency[],
  ids: Set<number>,
  endpoints: Map<number, DepEndpoints>,
  pxWindow: { minX: number; maxX: number },
): GanttRenderDependency[] {
  const out: GanttRenderDependency[] = []
  for (const dep of deps) {
    if (!ids.has(dep.id)) continue
    const ep = endpoints.get(dep.id)
    if (!ep) continue
    const lo = Math.min(ep.x1, ep.x2)
    const hi = Math.max(ep.x1, ep.x2)
    if (hi < pxWindow.minX || lo > pxWindow.maxX) continue
    out.push(dep)
  }
  return out
}

/** 可见天窗口 → 像素区间（带 NX_DEP_PX_BUFFER 缓冲）。 */
export function visiblePxWindow(
  scale: NextGanttScale,
  days: DayRange,
): { minX: number; maxX: number } {
  return dayRangeToPx(scale, days, NX_DEP_PX_BUFFER)
}

// --- 四类依赖正交折线（design D1.6 / tasks 1.6） ------------------------------------

export type NextDepAnchorSide = 'start' | 'finish'

/** 依赖类型 → 前置/后置锚点边（与旧轨 geometry DEP_ANCHORS 同构）。 */
export const NEXT_DEP_ANCHORS: Record<
  DependencyType,
  { predSide: NextDepAnchorSide; succSide: NextDepAnchorSide }
> = {
  fs: { predSide: 'finish', succSide: 'start' },
  ss: { predSide: 'start', succSide: 'start' },
  ff: { predSide: 'finish', succSide: 'finish' },
  sf: { predSide: 'start', succSide: 'finish' },
}

/** 首段水平腿最小长度（px）：起点侧向左、终点侧向右伸出，避免压过任务条本体。 */
export const NX_DEP_LEG_PX = 24

/**
 * 四类依赖的正交折线路径（M → H → V → H 三段式）：
 * 从前置锚点沿锚点外侧伸出 24px，若伸出点位于两端锚点之间则直接下落，
 * 否则在两锚点中点处下落，再水平折回后继锚点。确定性、可单测。
 */
export function orthogonalDependencyPath(e: DepEndpoints, type: DependencyType): string {
  const { predSide } = NEXT_DEP_ANCHORS[type]
  const dir = predSide === 'finish' ? 1 : -1
  const xa = e.x1 + dir * NX_DEP_LEG_PX
  const lo = Math.min(e.x1, e.x2)
  const hi = Math.max(e.x1, e.x2)
  const vx = xa >= lo && xa <= hi ? xa : (e.x1 + e.x2) / 2
  return `M${e.x1},${e.y1} H${vx} V${e.y2} H${e.x2}`
}

// --- 时间刻度（design D1.4） --------------------------------------------------------

export interface NextAxisTick {
  /** 屏幕 x（图表绝对坐标）。 */
  x: number
  /** 距 epoch 天偏移。 */
  day: number
  label: string
  /** 次刻度落于周末（日刻度下的周六/周日标定）。 */
  weekend?: boolean
}

export interface NextTicks {
  major: NextAxisTick[]
  minor: NextAxisTick[]
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** ISO 8601 自然周序号（UTC）。 */
export function isoWeekOf(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
}

/**
 * 生成视口天窗口内的两级刻度：日=主标尺按月、次标尺按日（01/02…，周末标定）；
 * 周=主标尺按月界、次标尺按自然周起点 `W37 (09/07)`；月=主标尺按年界、次标尺按月。
 * 纯函数、可单测。
 */
export function buildNextTicks(scale: NextGanttScale, window: DayRange): NextTicks {
  const major: NextAxisTick[] = []
  const minor: NextAxisTick[] = []
  const g = scale.granularity
  const start = Math.max(0, window.startDay)
  const end = window.endDay
  const monthLabel = (d: Date): string =>
    d.getUTCMonth() === 0 ? `${d.getUTCFullYear()}年` : `${d.getUTCMonth() + 1}月`

  if (g === 'day') {
    for (let day = start; day <= end; day++) {
      const d = new Date(dayMs(scale.epochMs, day))
      minor.push({
        x: nxDayToX(scale, day),
        day,
        label: pad2(d.getUTCDate()),
        weekend: isWeekendDay(scale, day),
      })
      if (d.getUTCDate() === 1) {
        major.push({
          x: nxDayToX(scale, day),
          day,
          label: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`,
        })
      }
    }
    return { major, minor }
  }

  if (g === 'week') {
    for (let day = start; day <= end; day++) {
      const d = new Date(dayMs(scale.epochMs, day))
      if (d.getUTCDate() === 1) {
        major.push({
          x: nxDayToX(scale, day),
          day,
          label: `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`,
        })
      }
    }
    // 自然周起点（周一）步进。
    for (let day = start; day <= end; day += 7) {
      const d = new Date(dayMs(scale.epochMs, day))
      const monday = day - ((d.getUTCDay() + 6) % 7)
      if (monday >= start) {
        const md = new Date(dayMs(scale.epochMs, monday))
        minor.push({
          x: nxDayToX(scale, monday),
          day: monday,
          label: `W${isoWeekOf(md)} (${pad2(md.getUTCMonth() + 1)}/${pad2(md.getUTCDate())})`,
        })
      }
    }
    return { major, minor }
  }

  // month：主标尺年界、次标尺月界。
  for (let day = start; day <= end; day++) {
    const d = new Date(dayMs(scale.epochMs, day))
    if (d.getUTCDate() !== 1) continue
    minor.push({
      x: nxDayToX(scale, day),
      day,
      label: `${d.getUTCFullYear()}年${monthLabel(d)}`,
    })
    if (d.getUTCMonth() === 0) {
      major.push({ x: nxDayToX(scale, day), day, label: `${d.getUTCFullYear()}年` })
    }
  }
  return { major, minor }
}

// --- 数据适配（复用 buildGanttModelFromApi / useProjectGanttModel） -------------------

/** 新轨渲染任务：适配层保证优先级确定性（缺省兜底 medium）。 */
export interface NextGanttRenderTask extends GanttRenderTask {
  priority: TaskPriority
}

/** 新轨渲染模型：与旧轨 GanttModel 同构，仅任务行携带确定性渲染属性。 */
export interface NextGanttModel extends Omit<GanttModel, 'tasks'> {
  tasks: NextGanttRenderTask[]
}

/** 把 GanttModel 增强为新轨渲染模型（纯函数；零脏数据：只派生、不持久化）。 */
export function buildNextGanttModel(model: GanttModel): NextGanttModel {
  return {
    ...model,
    tasks: model.tasks.map((t) => ({ ...t, priority: t.priority ?? 'medium' })),
  }
}

/**
 * 新轨甘特取数组合 Hook：完整复用 `useProjectGanttModel`（并行 4 路拉取，
 * 1000 任务上限、依赖、里程碑），把组装好的 `GanttModel` 增强为新轨渲染模型。
 */
export function useNextGanttModel(projectId: number): {
  model: NextGanttModel | null
  project: Project | null
  isLoading: boolean
  isError: boolean
  error: unknown
} {
  const base = useProjectGanttModel(projectId)
  const model = useMemo(() => (base.model ? buildNextGanttModel(base.model) : null), [base.model])
  return {
    model,
    project: base.project,
    isLoading: base.isLoading,
    isError: base.isError,
    error: base.error,
  }
}

// --- 画板几何缓存（复用旧轨 dependency-index） ----------------------------------------

export interface NextGanttGeometry {
  rowIndex: Map<number, number>
  boxes: ReturnType<typeof buildBarBoxes>
  endpoints: Map<number, DepEndpoints>
  depIndex: DependencyIndex
}

/** 按模型+比例尺构建几何缓存：滚动不复算，仅模型/刻度变化时重建（design D9）。 */
export function buildNextGanttGeometry(
  scale: NextGanttScale,
  model: GanttModel,
): NextGanttGeometry {
  const rowIndex = buildRowIndex(model.tasks)
  const boxes = buildBarBoxes(scale, model.tasks)
  const endpoints = buildDepEndpoints(scale, model.dependencies, boxes)
  const depIndex = new DependencyIndex(model.dependencies, rowIndex)
  return { rowIndex, boxes, endpoints, depIndex }
}
