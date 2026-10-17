/**
 * 甘特渲染核 —— 真实 API 数据 → 运行时渲染模型的组装层（task 2.1）。
 *
 * 把后端 `Task[]`（ISO 日期、6 状态、taskType）与项目级 `TaskDependency[]` 组装成 `GanttModel`
 * （几何用整数天偏移 + 固定 epoch，design D5/D7）。纯函数、可单测（task 2.5）；组织隔离在服务端保证，
 * 前端只消费已隔离的数据。
 *
 * `is_critical`/`is_on_longest_path`/基线为可选：上游（T021/基线采集）未就绪时留空，渲染层留通道不阻塞（task 2.4）。
 */

import type { Task } from '@/lib/api/tasks'
import type { TaskDependency } from '@/lib/api/dependencies'
import type { Milestone, MilestoneStatus } from '@/lib/api/milestones'
import { CHART_EPOCH_MS } from './geometry'
import { backfillCriticalPath } from './critical-path'
import { createWorkingCalendar, type WorkingCalendarSettingsInput } from './working-calendar'
import type { GanttModel, GanttRenderDependency, GanttRenderTask, GanttRowKind } from './types'

const MS_PER_DAY = 86_400_000

/** 'YYYY-MM-DD' → UTC 午夜毫秒；null/非法 → null。 */
function parseDateMs(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(`${iso}T00:00:00Z`)
  return Number.isNaN(ms) ? null : ms
}

function taskKind(task: Task, hasChildren: boolean): GanttRowKind {
  if (task.taskType === 'milestone') return 'milestone'
  if (task.taskType === 'summary' || hasChildren) return 'summary'
  return 'task'
}

function fallbackMilestoneStatus(status: Task['status']): MilestoneStatus {
  if (status === 'completed') return 'achieved'
  if (status === 'blocked' || status === 'on_hold') return 'at_risk'
  if (status === 'cancelled') return 'missed'
  if (status === 'in_progress') return 'planned'
  return 'not_started'
}

/** 实际开工 / 完工的天偏移（仅开工过的任务有值）。 */
function actualDays(
  actualStart: string | null | undefined,
  actualEnd: string | null | undefined,
  dayOffset: (ms: number) => number,
): { actualStartDay?: number; actualEndDay?: number } {
  const startMs = parseDateMs(actualStart ?? null)
  if (startMs === null) return {}
  const endMs = parseDateMs(actualEnd ?? null)
  return {
    actualStartDay: dayOffset(startMs),
    ...(endMs !== null ? { actualEndDay: dayOffset(endMs) } : {}),
  }
}

/** 行序：按 startDay 升序（同日按 id），保持父子层级（子行紧跟父行）。纯函数。 */
export function orderRowsByStart(tasks: readonly GanttRenderTask[]): GanttRenderTask[] {
  const byStart = (a: GanttRenderTask, b: GanttRenderTask) => a.startDay - b.startDay || a.id - b.id
  const ids = new Set(tasks.map((t) => t.id))
  const children = new Map<number, GanttRenderTask[]>()
  const roots: GanttRenderTask[] = []
  for (const task of tasks) {
    if (task.parentId != null && ids.has(task.parentId)) {
      const list = children.get(task.parentId) ?? []
      list.push(task)
      children.set(task.parentId, list)
    } else {
      roots.push(task)
    }
  }
  const out: GanttRenderTask[] = []
  const seen = new Set<number>()
  const visit = (task: GanttRenderTask) => {
    if (seen.has(task.id)) return
    seen.add(task.id)
    out.push(task)
    for (const child of [...(children.get(task.id) ?? [])].sort(byStart)) visit(child)
  }
  for (const root of [...roots].sort(byStart)) visit(root)
  // 防御：父链成环时未被遍历到的行按原序补上
  for (const task of tasks) if (!seen.has(task.id)) out.push(task)
  return out
}

/**
 * 组装渲染模型。epoch＝最早任务起始日（无日期则退回固定 epoch），使天偏移从 0 附近起、时间轴标签为真实日期。
 * 组装后调用 CPM 回填 `isCritical`/`isOnLongestPath`/`totalFloat` 与依赖 `isCritical`（T021）。
 */
export function buildGanttModelFromApi(
  tasks: Task[],
  dependencies: TaskDependency[],
  calendarSettings?: WorkingCalendarSettingsInput | null,
  realMilestones: Milestone[] = [],
): GanttModel {
  let calendar
  try {
    calendar = createWorkingCalendar(calendarSettings)
  } catch {
    calendar = createWorkingCalendar()
  }
  // 1) epoch = 最早起始日（UTC 午夜）。
  let epochMs = CHART_EPOCH_MS
  let minStart: number | null = null
  for (const t of tasks) {
    const ms = parseDateMs(t.startDate)
    if (ms !== null && (minStart === null || ms < minStart)) minStart = ms
    // 提前开工的实际日期也要落在时间轴内，否则「实际执行」细条画在可视范围之外
    const actualMs = parseDateMs(t.actualStartDate ?? null)
    if (actualMs !== null && (minStart === null || actualMs < minStart)) minStart = actualMs
  }
  for (const milestone of realMilestones) {
    const ms = parseDateMs(milestone.plannedDate)
    if (ms !== null && (minStart === null || ms < minStart)) minStart = ms
  }
  if (minStart !== null) epochMs = minStart

  const dayOffset = (ms: number): number => Math.floor((ms - epochMs) / MS_PER_DAY)

  // 2) 层级：由 parentTaskId 派生 depth（防环）+ 标记有子节点者为 summary。
  const parentById = new Map<number, number | null>(tasks.map((t) => [t.id, t.parentTaskId]))
  const hasChildren = new Set<number>()
  for (const t of tasks) if (t.parentTaskId != null) hasChildren.add(t.parentTaskId)
  const depthOf = (id: number): number => {
    let depth = 0
    let parent = parentById.get(id) ?? null
    const seen = new Set<number>([id])
    while (parent != null && !seen.has(parent)) {
      seen.add(parent)
      depth++
      parent = parentById.get(parent) ?? null
    }
    return depth
  }

  const taskIds = new Set(tasks.map((t) => t.id))
  let maxEndDay = 0

  const useRealMilestones = realMilestones.length > 0
  const renderTasks: GanttRenderTask[] = tasks
    .filter((task) => !useRealMilestones || task.taskType !== 'milestone')
    .map((t) => {
      const startMs = parseDateMs(t.startDate)
      const endMs = parseDateMs(t.endDate)
      const startDay = startMs !== null ? dayOffset(startMs) : 0
      const kind = taskKind(t, hasChildren.has(t.id))

      let durationDays: number
      if (kind === 'milestone') {
        durationDays = 0
      } else if (t.durationDays != null && t.durationDays > 0) {
        durationDays = t.durationDays
      } else if (startMs !== null && endMs !== null) {
        durationDays = Math.max(1, dayOffset(endMs) - startDay + 1)
      } else {
        durationDays = 1
      }

      maxEndDay = Math.max(maxEndDay, startDay + durationDays)

      return {
        id: t.id,
        name: t.name,
        // WBS outline 编号需 join WBS 树（wbsNodeId），初版留空（标准入口暂不显示编号）——后续增强。
        wbsCode: '',
        depth: depthOf(t.id),
        parentId: t.parentTaskId,
        kind,
        startDay,
        durationDays,
        progress: Math.max(0, Math.min(1, t.progressPercent / 100)),
        status: t.status,
        priority: t.priority,
        ...actualDays(t.actualStartDate, t.actualEndDate, dayOffset),
        assignee: t.assignee
          ? {
              id: t.assignee.id,
              initials: t.assignee.initials,
              name: t.assignee.fullName || t.assignee.email,
            }
          : undefined,
      }
    })

  if (useRealMilestones) {
    for (const milestone of realMilestones) {
      const plannedMs = parseDateMs(milestone.plannedDate)
      const startDay = plannedMs === null ? 0 : dayOffset(plannedMs)
      maxEndDay = Math.max(maxEndDay, startDay)
      renderTasks.push({
        id: -(milestone.id + 1),
        milestoneId: milestone.id,
        name: milestone.name,
        wbsCode: '',
        depth: 0,
        parentId: null,
        kind: 'milestone',
        startDay,
        durationDays: 0,
        progress: milestone.status === 'achieved' ? 1 : 0,
        status: milestone.status === 'achieved' ? 'completed' : 'not_started',
      })
    }
  }

  // 行序：按计划开始日期排（同日按 id），子任务紧跟父任务。任务接口默认按创建时间倒序，
  // 原样作为行序时最早的任务排在最底部、首屏一片空白。
  const orderedTasks = orderRowsByStart(renderTasks)
  renderTasks.length = 0
  renderTasks.push(...orderedTasks)

  // 3) 依赖：只保留两端都在当前任务集内的（防御脏数据）。
  const renderDeps: GanttRenderDependency[] = dependencies
    .filter((d) => taskIds.has(d.predecessorId) && taskIds.has(d.successorId))
    .map((d) => ({
      id: d.id,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lagDays: d.lagDays,
    }))

  // 4) 里程碑：有真实实体时整体使用真实源；否则由 milestone 类任务派生。
  const milestones = useRealMilestones
    ? realMilestones.map((milestone) => {
        const taskId = -(milestone.id + 1)
        const row = renderTasks.find((task) => task.id === taskId)
        return {
          id: milestone.id,
          taskId,
          day: row?.startDay ?? 0,
          name: milestone.name,
          status: milestone.status,
        }
      })
    : renderTasks
        .filter((task) => task.kind === 'milestone')
        .map((task) => ({
          id: task.id,
          taskId: task.id,
          day: task.startDay,
          name: task.name,
          status: fallbackMilestoneStatus(task.status),
        }))

  return backfillCriticalPath(
    {
      tasks: renderTasks,
      dependencies: renderDeps,
      milestones,
      timeRange: { startDay: 0, endDay: Math.max(1, maxEndDay) },
      epochMs,
    },
    calendar,
  )
}

/**
 * 把排程 preview 的变更应用到一个已组装的 `GanttModel` 上，产出带真实 CPM 的预览模型
 * （T021 task 5.1）。仅改变受影响任务的 `startDay`/`durationDays`（由 ISO 日期重算天偏移），
 * 再调用 `backfillCriticalPath` 重算关键路径——拖拽期间关键路径高亮随 preview 实时变化。
 *
 * 纯函数：返回新 model，不修改入参。calendar 取自 preview 响应（与 commit 同源）。
 */
export function applySchedulePreviewToModel(
  base: GanttModel,
  changes: { taskId: number; after: { startDate: string; endDate: string } }[],
  calendarSettings?: WorkingCalendarSettingsInput | null,
): GanttModel {
  let calendar
  try {
    calendar = createWorkingCalendar(calendarSettings)
  } catch {
    calendar = createWorkingCalendar()
  }
  const changeByTask = new Map(changes.map((c) => [c.taskId, c.after]))
  const tasks = base.tasks.map((t) => {
    const after = changeByTask.get(t.id)
    if (!after) return { ...t }
    const startMs = parseDateMs(after.startDate) ?? base.epochMs + t.startDay * MS_PER_DAY
    const endMs = parseDateMs(after.endDate) ?? startMs
    const startDay = Math.floor((startMs - base.epochMs) / MS_PER_DAY)
    const endDay = Math.floor((endMs - base.epochMs) / MS_PER_DAY)
    const durationDays = t.kind === 'milestone' ? 0 : Math.max(1, endDay - startDay + 1)
    return { ...t, startDay, durationDays }
  })
  const dependencies = base.dependencies.map((d) => ({ ...d }))
  return backfillCriticalPath(
    {
      tasks,
      dependencies,
      milestones: base.milestones.map((m) => ({ ...m })),
      timeRange: { ...base.timeRange },
      epochMs: base.epochMs,
    },
    calendar,
  )
}
