import { ValidationException } from '#exceptions/api_exception'

/**
 * 任务 6 状态状态机（task-status-workflow）。
 *
 * 纯函数 + 常量表（design D1）：单一事实来源，PUT 编辑与 POST .../status 端点共用，
 * 易做覆盖全部合法/非法组合的单测。状态副作用（日期回填）在 task_service 事务内联动（D2）。
 *
 * 合法转换（sec07.1.3 / sec08.3.1）：
 *   not_started → in_progress / cancelled
 *   in_progress → completed / blocked / on_hold / not_started（回退）
 *   blocked     → in_progress / cancelled
 *   on_hold     → in_progress / cancelled
 *   completed   → in_progress（重新打开）
 *   cancelled   → not_started
 */

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_TYPES = ['task', 'milestone', 'summary', 'deliverable'] as const
export type TaskType = (typeof TASK_TYPES)[number]

export const STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  not_started: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'blocked', 'on_hold', 'not_started'],
  blocked: ['in_progress', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['not_started'],
}

export const MAX_TASK_DEPTH = 3

/** 任务状态中文名（AI 同事预览卡与提示文案用）。 */
export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '受阻',
  on_hold: '暂停',
  cancelled: '已取消',
}

/**
 * 状态机最短合法路径（BFS）。同状态返回 []；不可达返回 null。
 * 例：not_started → completed = [in_progress, completed]。
 */
export function findStatusPath(from: TaskStatus, to: TaskStatus): TaskStatus[] | null {
  if (from === to) return []
  const previous = new Map<TaskStatus, TaskStatus>()
  const queue: TaskStatus[] = [from]
  const visited = new Set<TaskStatus>([from])
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of STATUS_TRANSITIONS[current] ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      previous.set(next, current)
      if (next === to) {
        const path: TaskStatus[] = [to]
        let cursor = current
        while (cursor !== from) {
          path.unshift(cursor)
          cursor = previous.get(cursor)!
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}

/**
 * 判定转换是否合法。目标等于当前状态视为幂等无操作（合法，不写审计）。
 */
export function isTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * 断言转换合法；非法抛 422。幂等（同状态）由调用方判定是否跳过审计。
 */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!isTransitionAllowed(from, to)) {
    throw new ValidationException(`不能从 ${from} 切换到 ${to}`, {
      status: 422,
      code: '422',
      details: { from, to },
    } as never)
  }
}

/**
 * 规范化状态字符串；非法值返回 null（由调用方决定抛错或回退默认）。
 */
export function normalizeStatus(value: unknown): TaskStatus | null {
  if (typeof value !== 'string') return null
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : null
}

export function normalizePriority(value: unknown): TaskPriority | null {
  if (typeof value !== 'string') return null
  return (TASK_PRIORITIES as readonly string[]).includes(value) ? (value as TaskPriority) : null
}

export function normalizeTaskType(value: unknown): TaskType | null {
  if (typeof value !== 'string') return null
  return (TASK_TYPES as readonly string[]).includes(value) ? (value as TaskType) : null
}
