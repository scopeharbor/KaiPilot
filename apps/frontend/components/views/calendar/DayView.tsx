'use client'

import { cn } from '@/lib/utils'
import { useDayMeta } from './CalendarDayMeta'
import type { Task } from '@/lib/api/tasks'

interface DayViewProps {
  tasks: Task[]
  date: string
  canUpdate: boolean
  currentUserId?: number
  onTaskClick: (taskId: number) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  highest: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  lowest: 'bg-gray-400',
}

const STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已挂起',
  cancelled: '已取消',
}

/** 日视图顶部的日期信息：农历、节气 / 节日、法定放假或调休、封网窗口。 */
function DayInfoBar({ date }: { date: string }) {
  const meta = useDayMeta(date)
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground',
        meta.freeze && 'border-warning/40 bg-warning/5',
      )}
    >
      <span>{meta.lunarText}</span>
      {meta.statutory && (
        <span className={meta.statutory === 'off' ? 'text-destructive' : 'text-foreground'}>
          {meta.statutory === 'off'
            ? `${meta.statutoryName ?? '节假日'}放假`
            : `${meta.statutoryName ?? ''}调休上班`}
        </span>
      )}
      {meta.freeze && (
        <span className="text-warning">
          {meta.freeze.label}（{meta.freeze.start} ~ {meta.freeze.end}），期间不安排生产变更
        </span>
      )}
    </div>
  )
}

export function DayView({ tasks, date, onTaskClick }: DayViewProps) {
  if (tasks.length === 0) {
    return (
      <div className="space-y-2">
        <DayInfoBar date={date} />
        <div className="text-center py-12 text-muted-foreground text-sm">该日期没有截止日任务</div>
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-2">
      <DayInfoBar date={date} />
      {tasks.map((task) => {
        const isOverdue =
          task.status !== 'completed' &&
          task.status !== 'cancelled' &&
          task.endDate &&
          task.endDate < today
        return (
          <div
            key={task.id}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors cursor-pointer',
            )}
            onClick={() => onTaskClick(task.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onTaskClick(task.id)
            }}
            role="button"
            tabIndex={0}
            aria-label={`${task.name}，状态：${STATUS_LABELS[task.status] ?? task.status}${isOverdue ? '，逾期' : ''}`}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                PRIORITY_COLORS[task.priority] ?? 'bg-gray-400',
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{task.name}</div>
              <div className="text-xs text-muted-foreground">
                {STATUS_LABELS[task.status] ?? task.status}
                {task.assignee && ` · ${task.assignee.fullName ?? task.assignee.email}`}
              </div>
            </div>
            {isOverdue && <span className="text-xs text-red-600 font-medium">逾期</span>}
          </div>
        )
      })}
    </div>
  )
}
