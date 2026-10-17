/**
 * 里程碑时间轴泳道镜头纯函数适配层（v3-ui-next-chart-gallery W2 · tasks 2.5/2.6）。
 *
 * - 数据：`milestonesApi.list`（五状态机）+ `tasksApi.list`（任务.milestoneId 关联，
 *   达成率口径：已达成 = status 'completed'；cancelled 任务不计入分母）；
 * - 时间域：按含计划日期的里程碑首尾跨度外扩（不足 14 天窗口对称扩到 ≥28 天），
 *   年月旬日历标尺 + 每自然日线性坐标（pxPerDay 自适应缩放）；
 * - 节点严格按 plannedDate 升序线性排布（同日按 displayOrder 微偏移防重叠），
 *   未排期里程碑（含其达成统计）独立收纳在轴外泳区；
 * - 全部为纯函数（确定性渲染 RL-14，jsdom 测试直接断言坐标与标签）。
 *
 * 状态文案与主工作面时间线镜头同源（lenses-timeline-adapter）。
 */
import type { Milestone, MilestoneStatus } from '@/lib/api/milestones'
import type { Task } from '@/lib/api/tasks'
import { compareDateKeys, milestoneStatusLabel } from '@/lib/next/lenses-timeline-adapter'

// ---------------------------------------------------------------------------
// 日期键工具（本地日历字符串域；与 lenses-timeline-adapter 语义一致）
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 'YYYY-MM-DD' → Date（本地日历，规避 DST 边界）；非法返回 null。 */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 日期键偏移整天数 → 新日期键；非法输入返回 null。 */
export function shiftDateKey(key: string, days: number): string | null {
  const date = parseDateKey(key)
  if (!date) return null
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

/** 两日期键间隔整天数（to - from；非法输入返回 null）。 */
export function daySpan(fromKey: string, toKey: string): number | null {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  if (!from || !to) return null
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      86_400_000,
  )
}

/** 任务达成口径：已完成。 */
export function isTaskCompleted(task: Task): boolean {
  return task.status === 'completed'
}

/** 任务是否计入达成率分母（cancelled 不计入）。 */
export function isTaskCountable(task: Task): boolean {
  return task.status !== 'cancelled'
}

// ---------------------------------------------------------------------------
// 里程碑 × 任务 达成统计
// ---------------------------------------------------------------------------

export interface MilestoneProgress {
  total: number
  completed: number
  /** 达成率 0-100（整数，向下取整；无关联任务为 0）。 */
  percent: number
  /** 关联任务清单（未完成优先，其余按 id 升序）。 */
  tasks: Task[]
}

/** 任务列表 → milestoneId 分组达成统计（单遍构建）。 */
export function buildProgressByMilestone(tasks: Task[]): Map<number, MilestoneProgress> {
  const grouped = new Map<number, MilestoneProgress>()
  for (const task of tasks) {
    if (task.milestoneId === null || task.milestoneId === undefined) continue
    if (!isTaskCountable(task)) continue
    let entry = grouped.get(task.milestoneId)
    if (!entry) {
      entry = { total: 0, completed: 0, percent: 0, tasks: [] }
      grouped.set(task.milestoneId, entry)
    }
    entry.total += 1
    if (isTaskCompleted(task)) entry.completed += 1
    entry.tasks.push(task)
  }
  for (const entry of grouped.values()) {
    entry.tasks.sort((a, b) => {
      const aDone = isTaskCompleted(a)
      const bDone = isTaskCompleted(b)
      if (aDone !== bDone) return aDone ? 1 : -1
      return a.id - b.id
    })
    entry.percent = entry.total > 0 ? Math.floor((entry.completed / entry.total) * 100) : 0
  }
  return grouped
}

/** 无关联任务占位进度。 */
export function emptyProgress(): MilestoneProgress {
  return { total: 0, completed: 0, percent: 0, tasks: [] }
}

// ---------------------------------------------------------------------------
// 时间轴几何模型
// ---------------------------------------------------------------------------

/** 可用绘图宽度（容器缺测时兜底，jsdom 确定性来源）。 */
export const TIMELINE_FALLBACK_WIDTH = 1180
/** 目标绘图总宽：随窗口天数自适应（~1400px）。 */
export const TIMELINE_TARGET_PX = 1400
export const TIMELINE_MIN_PX_PER_DAY = 12
export const TIMELINE_MAX_PX_PER_DAY = 60

/** 窗口天数 → 每自然日像素宽（偶数整数，保证半日居中精度）。 */
export function pxPerDayOf(totalDays: number): number {
  if (totalDays <= 0) return TIMELINE_MAX_PX_PER_DAY
  const raw = Math.max(
    TIMELINE_MIN_PX_PER_DAY,
    Math.min(TIMELINE_MAX_PX_PER_DAY, Math.round(TIMELINE_TARGET_PX / totalDays)),
  )
  return raw % 2 === 1 ? raw + 1 : raw
}

export interface TimelineMonthBand {
  /** 'YYYY-MM'。 */
  monthKey: string
  /** '2026年 9月'（每年首段带年份）/ '9月'。 */
  label: string
  /** 该月段起始 dayIndex（相对窗口首日 0）。 */
  startDayIndex: number
  /** 该月段在窗口内的天数（首尾月可能截断）。 */
  days: number
  /** 该月段内「旬」刻度（1/11/21 日）的绝对 dayIndex。 */
  tickDayIndexes: number[]
}

export interface MilestoneTimelineNode {
  milestone: Milestone
  /** 相对窗口首日的自然日序号（≥0）。 */
  dayIndex: number
  /** 旗帜中心 x（px；线性定位 + 同日微偏移）。 */
  centerPx: number
  /** 关联任务达成统计（无关联任务为 0/0 占位）。 */
  progress: MilestoneProgress
}

/** 未排期里程碑（无 plannedDate，displayOrder 升序；同样携带达成统计）。 */
export interface UndatedMilestoneEntry {
  milestone: Milestone
  progress: MilestoneProgress
}

export interface MilestoneAxisModel {
  /** 窗口首/末日键（已含外扩边距）。 */
  startKey: string
  endKey: string
  /** 窗口自然日数（含首尾）。 */
  totalDays: number
  /** 每自然日像素宽。 */
  pxPerDay: number
  /** 标尺总宽（px，总天数 × pxPerDay）。 */
  innerWidth: number
  /** 年月旬日历标尺月段。 */
  months: TimelineMonthBand[]
  /** 有计划日期的节点（plannedDate 升序线性排布）。 */
  nodes: MilestoneTimelineNode[]
  /** 未排期里程碑（plannedDate 为空，displayOrder 升序）。 */
  undated: UndatedMilestoneEntry[]
}

/** 同日里程碑的水平微偏移（px/个，避免旗帜完全重叠）。 */
export const SAME_DAY_NUDGE_PX = 26

/** 构建月份段（含截断首尾月）与每段 1/11/21 旬刻度。 */
export function buildMonthBands(startKey: string, totalDays: number): TimelineMonthBand[] {
  const start = parseDateKey(startKey)
  if (!start || totalDays <= 0) return []
  const bands: TimelineMonthBand[] = []
  // dayIndex 从 0 起；首月从 start 当日计起，后续月从 1 日计起
  let dayIndex = 0
  let firstDayOfMonth = start.getDate()
  let cursorYear = start.getFullYear()
  let cursorMonth = start.getMonth()
  let previousYear: number | null = null

  while (dayIndex < totalDays) {
    const daysInMonth = new Date(cursorYear, cursorMonth + 1, 0).getDate()
    const available = totalDays - dayIndex
    const lastDayOfMonth = Math.min(daysInMonth, firstDayOfMonth + available - 1)
    const bandDays = lastDayOfMonth - firstDayOfMonth + 1
    if (bandDays <= 0) break

    const tickDayIndexes: number[] = []
    for (let dayOfMonth = firstDayOfMonth; dayOfMonth <= lastDayOfMonth; dayOfMonth += 1) {
      if (dayOfMonth === 1 || dayOfMonth === 11 || dayOfMonth === 21) {
        tickDayIndexes.push(dayIndex + (dayOfMonth - firstDayOfMonth))
      }
    }

    const showYear = previousYear === null || cursorYear !== previousYear
    bands.push({
      monthKey: `${cursorYear}-${pad2(cursorMonth + 1)}`,
      label: showYear ? `${cursorYear}年 ${cursorMonth + 1}月` : `${cursorMonth + 1}月`,
      startDayIndex: dayIndex,
      days: bandDays,
      tickDayIndexes,
    })

    dayIndex += bandDays
    previousYear = cursorYear
    // 推进到下一自然月
    cursorMonth += 1
    if (cursorMonth > 11) {
      cursorMonth = 0
      cursorYear += 1
    }
    firstDayOfMonth = 1
  }
  return bands
}

/**
 * 里程碑 → 时间轴几何模型。时间域由含计划日期的里程碑跨度决定：
 * 不足 14 天时以中点为心对称外扩至 ≥28 天；双侧各留 ~7% 边距避免旗帜贴边。
 * 没有任何里程碑时返回 null（组件渲染空态）；仅未排期里程碑时返回无节点空轴模型。
 */
export function computeMilestoneAxis(
  milestones: Milestone[],
  tasks: Task[],
): MilestoneAxisModel | null {
  const dated = milestones
    .filter((milestone) => milestone.plannedDate !== null)
    .sort((a, b) => compareDateKeys(a.plannedDate!, b.plannedDate!))
  const progressByMilestone = buildProgressByMilestone(tasks)
  const undated: UndatedMilestoneEntry[] = milestones
    .filter((milestone) => milestone.plannedDate === null)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((milestone) => ({
      milestone,
      progress: progressByMilestone.get(milestone.id) ?? emptyProgress(),
    }))

  if (milestones.length === 0) return null
  if (dated.length === 0) {
    return {
      startKey: '',
      endKey: '',
      totalDays: 0,
      pxPerDay: TIMELINE_MAX_PX_PER_DAY,
      innerWidth: TIMELINE_FALLBACK_WIDTH,
      months: [],
      nodes: [],
      undated,
    }
  }

  let startKey = dated[0]!.plannedDate!
  let endKey = dated[dated.length - 1]!.plannedDate!
  const rawSpan = daySpan(startKey, endKey) ?? 0
  const MIN_SPAN_DAYS = 13
  if (rawSpan < MIN_SPAN_DAYS) {
    const gap = MIN_SPAN_DAYS - rawSpan
    const halfLeft = Math.ceil(gap / 2)
    const halfRight = gap - halfLeft
    startKey = shiftDateKey(startKey, -halfLeft) ?? startKey
    endKey = shiftDateKey(endKey, halfRight) ?? endKey
  }

  // 双侧各 ~7% 边距（至少 3 天）
  const baseSpan = daySpan(startKey, endKey) ?? 0
  const margin = Math.max(3, Math.round(baseSpan * 0.07))
  const finalStartKey = shiftDateKey(startKey, -margin) ?? startKey
  const finalEndKey = shiftDateKey(endKey, margin) ?? endKey
  const totalDays = (daySpan(finalStartKey, finalEndKey) ?? 0) + 1
  const pxPerDay = pxPerDayOf(totalDays)
  const innerWidth = Math.max(TIMELINE_FALLBACK_WIDTH, totalDays * pxPerDay)

  const nodes: MilestoneTimelineNode[] = []
  const sameDayCounts = new Map<string, number>()
  dated.forEach((milestone) => {
    const dateKey = milestone.plannedDate!
    const fromStart = daySpan(finalStartKey, dateKey) ?? 0
    const sameDayIndex = sameDayCounts.get(dateKey) ?? 0
    sameDayCounts.set(dateKey, sameDayIndex + 1)
    const centerPx =
      Math.round((fromStart + 0.5) * pxPerDay * 10) / 10 + sameDayIndex * SAME_DAY_NUDGE_PX
    nodes.push({
      milestone,
      dayIndex: fromStart,
      centerPx,
      progress: progressByMilestone.get(milestone.id) ?? emptyProgress(),
    })
  })

  return {
    startKey: finalStartKey,
    endKey: finalEndKey,
    totalDays,
    pxPerDay,
    innerWidth,
    months: buildMonthBands(finalStartKey, totalDays),
    nodes,
    undated,
  }
}

// ---------------------------------------------------------------------------
// 状态语义（文案与主工作面同源；样式令牌由组件层消费）
// ---------------------------------------------------------------------------

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  not_started: milestoneStatusLabel('not_started'),
  planned: milestoneStatusLabel('planned'),
  at_risk: milestoneStatusLabel('at_risk'),
  achieved: milestoneStatusLabel('achieved'),
  missed: milestoneStatusLabel('missed'),
}

/** 状态 → 进度环发丝色令牌名（css 变量名，不含 var()）。 */
export const MILESTONE_RING_TONE: Record<MilestoneStatus, string> = {
  not_started: '--nx-text-muted',
  planned: '--nx-chart-1',
  at_risk: '--nx-status-warning',
  achieved: '--nx-status-success',
  missed: '--nx-status-danger',
}

export function milestoneRingTone(status: string): string {
  return MILESTONE_RING_TONE[status as MilestoneStatus] ?? '--nx-text-muted'
}
