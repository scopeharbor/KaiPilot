/**
 * 任务状态变化时的联动（2026-09-29）：看板拖动、详情改状态、列表改状态都走这里，
 * 保证「状态 / 执行步骤 / 进度 / 排期」在任何入口下都一致，甘特图与 WBS 读到的是同一份事实。
 *
 * 执行步骤（customFields.execution.steps / stepsDone，说明里的 `- [ ]` 同步）：
 * - 转「已完成」：步骤全部勾上；
 * - 退回「待处理」：勾选全部清掉；
 * - 「已完成」重新打开：步骤全勾着时取消最后一步（还有事没做完），进度按勾选比例。
 *
 * 排期（按项目工作日历）：
 * - 开工晚于计划开始：整条任务顺延到今天开工（工期不变），后续任务由调用方按依赖顺延；
 * - 完成：结束日改成今天——晚完成则延长（后续顺延），早完成则缩短（后续不自动提前）；
 * - 重新打开时已过计划结束日：结束日延到今天。
 */
import type { TaskStatus } from '#services/task_status_machine'
import {
  endFromStart,
  formatIsoDate,
  parseIsoDate,
  snapToWorkingDay,
  workingDayDuration,
  type WorkingCalendar,
} from '#services/gantt_working_calendar'

const CHECKBOX_LINE = /^(\s*[-*]\s*)\[( |x|X)\]\s*(.+?)\s*$/

type Execution = Record<string, unknown> & { steps?: unknown; stepsDone?: unknown }

export interface StepsSnapshot {
  customFields: Record<string, unknown> | null
  description: string | null
}

export interface StepsSyncResult {
  customFields: Record<string, unknown> | null
  description: string | null
  /** 按勾选比例算出的进度（有步骤时）。 */
  progressPercent: number | null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : []
}

function readSteps(task: StepsSnapshot): { steps: string[]; done: boolean[] } {
  const raw = task.customFields?.execution
  const execution = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Execution) : {}
  const structured = stringList(execution.steps)
  const textSteps: string[] = []
  const textDone: boolean[] = []
  for (const line of (task.description ?? '').split('\n')) {
    const match = CHECKBOX_LINE.exec(line)
    if (!match) continue
    textSteps.push(match[3]!)
    textDone.push(match[2]!.toLowerCase() === 'x')
  }
  const steps = structured.length > 0 ? structured : textSteps
  const stored = Array.isArray(execution.stepsDone) ? execution.stepsDone : null
  const done = steps.map((step, index) => {
    if (stored) return Boolean(stored[index])
    const textIndex = textSteps.indexOf(step)
    return textIndex >= 0 ? textDone[textIndex]! : false
  })
  return { steps, done }
}

function syncDescription(description: string | null, steps: string[], done: boolean[]) {
  if (!description) return description
  return description
    .split('\n')
    .map((line) => {
      const match = CHECKBOX_LINE.exec(line)
      if (!match) return line
      const index = steps.indexOf(match[3]!)
      return index < 0 ? line : `${match[1]}[${done[index] ? 'x' : ' '}] ${match[3]}`
    })
    .join('\n')
}

/** 状态变化后执行步骤应处的勾选状态；没有步骤或无需改动时返回 null。 */
export function syncStepsForStatus(
  task: StepsSnapshot,
  from: TaskStatus,
  to: TaskStatus,
): StepsSyncResult | null {
  const { steps, done } = readSteps(task)
  if (steps.length === 0 || from === to) return null
  let next: boolean[] | null = null
  if (to === 'completed') next = steps.map(() => true)
  else if (to === 'not_started') next = steps.map(() => false)
  else if (from === 'completed' && to === 'in_progress' && done.every(Boolean)) {
    next = done.map((value, index) => (index === done.length - 1 ? false : value))
  }
  if (!next) return null
  const count = next.filter(Boolean).length
  const raw = task.customFields?.execution
  const execution = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Execution) : {}
  return {
    customFields: {
      ...(task.customFields ?? {}),
      execution: { ...execution, steps, stepsDone: next },
    },
    description: syncDescription(task.description, steps, next),
    progressPercent: Math.round((count / steps.length) * 100),
  }
}

export interface ScheduleSnapshot {
  startDate: string | null
  endDate: string | null
  durationDays: number | null
  taskType: string | null
}

export interface ScheduleSyncResult {
  startDate: string
  endDate: string
  durationDays: number
  /** 结束日是否往后推了（需要沿依赖顺延后续任务）。 */
  pushedLater: boolean
  reason: 'late_start' | 'late_finish' | 'early_finish' | 'reopened_overdue'
}

/** 状态变化后排期应有的样子；不需要改时返回 null。today 为上海时区当天 0 点（UTC 毫秒）。 */
export function scheduleForStatus(
  task: ScheduleSnapshot,
  from: TaskStatus,
  to: TaskStatus,
  today: number,
  calendar: WorkingCalendar,
): ScheduleSyncResult | null {
  if (!task.startDate || !task.endDate || from === to) return null
  const start = parseIsoDate(task.startDate.slice(0, 10))
  const end = parseIsoDate(task.endDate.slice(0, 10))
  const milestone = task.taskType === 'milestone'
  const duration =
    task.durationDays && task.durationDays > 0
      ? Math.round(task.durationDays)
      : workingDayDuration(calendar, start, Math.max(start, end))
  const result = (
    nextStart: number,
    nextEnd: number,
    reason: ScheduleSyncResult['reason'],
  ): ScheduleSyncResult | null =>
    nextStart === start && nextEnd === end
      ? null
      : {
          startDate: formatIsoDate(nextStart),
          endDate: formatIsoDate(nextEnd),
          durationDays: milestone ? 1 : workingDayDuration(calendar, nextStart, nextEnd),
          pushedLater: nextEnd > end,
          reason,
        }

  if (from === 'not_started' && to === 'in_progress') {
    const workday = snapToWorkingDay(calendar, today, 1)
    if (workday <= start) return null
    return result(
      workday,
      milestone ? workday : endFromStart(calendar, workday, duration),
      'late_start',
    )
  }
  if (to === 'completed') {
    const workday = snapToWorkingDay(calendar, today, -1)
    if (workday === end) return null
    if (milestone || workday < start) {
      return result(workday, workday, workday > end ? 'late_finish' : 'early_finish')
    }
    return result(start, workday, workday > end ? 'late_finish' : 'early_finish')
  }
  if (from === 'completed' && to === 'in_progress') {
    const workday = snapToWorkingDay(calendar, today, 1)
    if (workday <= end) return null
    return milestone
      ? result(workday, workday, 'reopened_overdue')
      : result(start, workday, 'reopened_overdue')
  }
  return null
}

// ---------------------------------------------------------------------------
// 勾选 / 取消执行步骤（AI 同事「把第 2、3 步打勾」；与界面打勾同一规则）
// ---------------------------------------------------------------------------

/** 任务的执行步骤与勾选状态（结构化步骤优先，否则读说明里的 `- [ ]`）。 */
export function readTaskSteps(task: StepsSnapshot): { steps: string[]; done: boolean[] } {
  return readSteps(task)
}

export interface StepToggleResult extends StepsSyncResult {
  steps: string[]
  before: boolean[]
  after: boolean[]
  /**
   * 勾选带来的状态变化（与界面一致）：第一次打勾 待处理 → 进行中；全部勾上 → 已完成；
   * 已完成的任务取消任一步 → 退回进行中。不需要变化为 null。
   */
  targetStatus: TaskStatus | null
}

/**
 * 按 `changes`（步骤下标从 0 起）勾选 / 取消，返回新的步骤字段、说明、进度与应转的状态。
 * 下标越界的变更忽略；没有步骤或没有任何变化时返回 null。
 */
export function toggleTaskSteps(
  task: StepsSnapshot & { status: TaskStatus },
  changes: ReadonlyArray<{ index: number; done: boolean }>,
): StepToggleResult | null {
  const { steps, done } = readSteps(task)
  if (steps.length === 0) return null
  const after = [...done]
  for (const change of changes) {
    if (Number.isInteger(change.index) && change.index >= 0 && change.index < steps.length) {
      after[change.index] = change.done
    }
  }
  if (after.every((value, index) => value === done[index])) return null
  const count = after.filter(Boolean).length
  const allDone = count === steps.length
  let targetStatus: TaskStatus | null = null
  if (allDone && (task.status === 'not_started' || task.status === 'in_progress')) {
    targetStatus = 'completed'
  } else if (count > 0 && task.status === 'not_started') {
    targetStatus = 'in_progress'
  } else if (!allDone && task.status === 'completed') {
    targetStatus = 'in_progress'
  }
  const raw = task.customFields?.execution
  const execution = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Execution) : {}
  return {
    steps,
    before: done,
    after,
    targetStatus,
    customFields: {
      ...(task.customFields ?? {}),
      execution: { ...execution, steps, stepsDone: after },
    },
    description: syncDescription(task.description, steps, after),
    progressPercent: Math.round((count / steps.length) * 100),
  }
}
