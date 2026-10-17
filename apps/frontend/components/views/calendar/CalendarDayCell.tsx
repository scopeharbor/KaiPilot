'use client'

import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/api/tasks'
import { TaskChip } from './TaskChip'
import { Button } from '@/components/ui/Button'
import { DayMetaBadges, useDayMeta } from './CalendarDayMeta'

interface CalendarDayCellProps {
  date: string
  dayNumber: number
  isToday: boolean
  isCurrentMonth: boolean
  tasks: Task[]
  maxVisible: number
  canUpdate: boolean
  currentUserId?: number
  onDateClick: (date: string) => void
  onTaskClick: (taskId: number) => void
}

export function CalendarDayCell({
  date,
  dayNumber,
  isToday,
  isCurrentMonth,
  tasks,
  maxVisible,
  canUpdate,
  currentUserId,
  onDateClick,
  onTaskClick,
}: CalendarDayCellProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${date}`, data: { date } })
  const visibleTasks = tasks.slice(0, maxVisible)
  const remaining = tasks.length - maxVisible
  const today = new Date().toISOString().slice(0, 10)
  const meta = useDayMeta(date)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-[var(--row-h)] border-r last:border-r-0 p-[var(--card-pad)] flex flex-col transition-colors',
        !isCurrentMonth && 'bg-muted/30',
        isCurrentMonth && meta.nonWorking && 'bg-muted/20',
        meta.freeze && 'bg-warning/5',
        isOver && 'bg-primary/10',
      )}
      data-non-working={meta.nonWorking || undefined}
      data-freeze={meta.freeze ? true : undefined}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <button
          className={cn(
            'w-6 h-6 rounded-full text-xs flex items-center justify-center shrink-0',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isToday && 'bg-primary text-primary-foreground font-bold',
            !isToday && 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => onDateClick(date)}
          aria-label={`${date} 的任务`}
        >
          {dayNumber}
        </button>
        <DayMetaBadges meta={meta} className="pt-1 justify-end" />
      </div>
      <div className="flex-1 space-y-[calc(var(--density-gap)/4)] overflow-hidden">
        {visibleTasks.map((task) => (
          <TaskChip
            key={task.id}
            task={task}
            isOverdue={
              task.status !== 'completed' &&
              task.status !== 'cancelled' &&
              !!task.endDate &&
              task.endDate < today
            }
            canUpdate={canUpdate && (canUpdate || task.assigneeId === currentUserId)}
            onClick={() => onTaskClick(task.id)}
          />
        ))}
        {remaining > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-5 text-[10px] p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onDateClick(date)}
            aria-label={`还有 ${remaining} 项任务，点击查看`}
          >
            还有 {remaining} 项
          </Button>
        )}
      </div>
    </div>
  )
}
