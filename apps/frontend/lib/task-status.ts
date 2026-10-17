import type { TaskStatus } from '@/lib/api/tasks'

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '阻塞',
  on_hold: '暂停',
  cancelled: '已取消',
}

export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  not_started: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'blocked', 'on_hold', 'not_started'],
  blocked: ['in_progress', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['not_started'],
}

export function canTransition(from: TaskStatus, to: TaskStatus) {
  return from === to || TASK_STATUS_TRANSITIONS[from].includes(to)
}
