import type { TaskStatus } from '@/lib/api/tasks'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { cn } from '@/lib/utils'

/**
 * 任务状态色（v3-classic-ui-openproject-views，OpenProject 式状态标示）：
 * 圆点 + 文字双通道（不只靠颜色），底色为语义色浅底。
 */
export const TASK_STATUS_TONES: Record<TaskStatus, { dot: string; pill: string }> = {
  not_started: { dot: 'bg-gray-400', pill: 'bg-gray-100 text-gray-700' },
  in_progress: { dot: 'bg-info', pill: 'bg-info-bg text-info' },
  completed: { dot: 'bg-success', pill: 'bg-success-bg text-success' },
  blocked: { dot: 'bg-danger', pill: 'bg-danger-bg text-danger' },
  on_hold: { dot: 'bg-warning', pill: 'bg-warning-bg text-warning' },
  cancelled: { dot: 'bg-gray-300', pill: 'bg-gray-100 text-gray-500 line-through' },
}

export function TaskStatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  const tone = TASK_STATUS_TONES[status]
  return (
    <span
      data-task-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        tone.pill,
        className,
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
      {TASK_STATUS_LABELS[status]}
    </span>
  )
}
