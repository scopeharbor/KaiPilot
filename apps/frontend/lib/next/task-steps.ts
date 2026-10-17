import type { Task, TaskStatus, UpdateTaskInput } from '@/lib/api/tasks'

/**
 * 任务执行步骤清单（2026-09-29）。
 *
 * AI 生成 / AI 补全的任务把执行步骤存在 `customFields.execution.steps`，说明里也写成 `- [ ] 步骤`。
 * 这里把它变成能直接打勾的清单：勾选状态存 `execution.stepsDone`，同时把说明里的勾选框同步成 [x]，
 * 进度按勾选比例自动算。状态跟着勾选走（2026-09-29 用户要求）：
 * - 第一次打勾：待处理 → 进行中；
 * - 最后一步勾上：进行中 → 已完成（每一步都是本人亲手勾的，等于本人确认做完）；
 * - 已完成的任务取消任何一步：退回进行中。
 * 看板拖动引起的状态变化，步骤勾选由后端同步（task_status_sync），这里的 applyStatusToSteps 只做界面即时反馈。
 */
export interface TaskStepsState {
  steps: string[]
  done: boolean[]
  doneCriteria: string[]
  purpose: string | null
}

type Execution = {
  steps?: unknown
  stepsDone?: unknown
  doneCriteria?: unknown
  purpose?: unknown
  [key: string]: unknown
}

const CHECKBOX_LINE = /^(\s*[-*]\s*)\[( |x|X)\]\s*(.+?)\s*$/

function executionOf(task: Pick<Task, 'customFields'>): Execution | null {
  const value = task.customFields?.execution
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Execution) : null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : []
}

/** 从说明里读 `- [ ] 步骤` / `- [x] 步骤`（没有结构化步骤的老任务）。 */
function stepsFromDescription(description: string | null): { steps: string[]; done: boolean[] } {
  const steps: string[] = []
  const done: boolean[] = []
  for (const line of (description ?? '').split('\n')) {
    const match = CHECKBOX_LINE.exec(line)
    if (!match) continue
    steps.push(match[3]!)
    done.push(match[2]!.toLowerCase() === 'x')
  }
  return { steps, done }
}

export function readTaskSteps(task: Pick<Task, 'customFields' | 'description'>): TaskStepsState {
  const execution = executionOf(task)
  const structured = stringList(execution?.steps)
  const fromText = stepsFromDescription(task.description)
  const steps = structured.length > 0 ? structured : fromText.steps
  const storedDone = Array.isArray(execution?.stepsDone) ? execution!.stepsDone : null
  const done = steps.map((step, index) => {
    if (storedDone) return Boolean(storedDone[index])
    const textIndex = fromText.steps.indexOf(step)
    return textIndex >= 0 ? fromText.done[textIndex]! : false
  })
  return {
    steps,
    done,
    doneCriteria: stringList(execution?.doneCriteria),
    purpose:
      typeof execution?.purpose === 'string' && execution.purpose.trim()
        ? execution.purpose.trim()
        : null,
  }
}

/** 说明里的勾选框按新的勾选状态同步（找不到对应行就不动）。 */
export function syncDescriptionCheckboxes(
  description: string | null,
  steps: readonly string[],
  done: readonly boolean[],
): string | null {
  if (!description) return description
  return description
    .split('\n')
    .map((line) => {
      const match = CHECKBOX_LINE.exec(line)
      if (!match) return line
      const index = steps.indexOf(match[3]!)
      if (index < 0) return line
      return `${match[1]}[${done[index] ? 'x' : ' '}] ${match[3]}`
    })
    .join('\n')
}

/** 勾选 / 取消某一步后要提交的更新。 */
export function stepToggleUpdate(
  task: Pick<Task, 'customFields' | 'description' | 'status'>,
  index: number,
): { input: UpdateTaskInput; done: boolean[]; progress: number; allDone: boolean } {
  const state = readTaskSteps(task)
  const done = state.done.map((value, i) => (i === index ? !value : value))
  const doneCount = done.filter(Boolean).length
  const progress = state.steps.length > 0 ? Math.round((doneCount / state.steps.length) * 100) : 0
  const execution = { ...(executionOf(task) ?? {}), steps: state.steps, stepsDone: done }
  const input: UpdateTaskInput = {
    customFields: { ...(task.customFields ?? {}), execution },
    progressPercent: progress,
  }
  const description = syncDescriptionCheckboxes(task.description, state.steps, done)
  if (description !== task.description && description && description.length <= 5000) {
    input.description = description
  }
  const allDone = state.steps.length > 0 && doneCount === state.steps.length
  if (allDone && (task.status === 'not_started' || task.status === 'in_progress')) {
    // 状态机不允许待处理直接到已完成：这一次先转进行中，调用方再补一次「已完成」
    input.status = task.status === 'not_started' ? 'in_progress' : 'completed'
  } else if (doneCount > 0 && task.status === 'not_started') {
    input.status = 'in_progress'
  } else if (!allDone && task.status === 'completed') {
    input.status = 'in_progress'
  }
  return { input, done, progress, allDone }
}

/** 看板乐观更新：状态变了，卡片上的步骤数 / 进度先按后端的规则变（真实数据随后刷新）。 */
export function applyStatusToSteps(task: Task, status: TaskStatus): Task {
  if (status === task.status) return task
  const state = readTaskSteps(task)
  let done: boolean[] | null = null
  if (status === 'completed') done = state.steps.map(() => true)
  else if (status === 'not_started') done = state.steps.map(() => false)
  const progressPercent =
    status === 'completed' ? 100 : status === 'not_started' ? 0 : task.progressPercent
  if (!done || state.steps.length === 0) return { ...task, status, progressPercent }
  return {
    ...task,
    status,
    progressPercent,
    customFields: {
      ...(task.customFields ?? {}),
      execution: { ...(executionOf(task) ?? {}), steps: state.steps, stepsDone: done },
    },
  }
}
