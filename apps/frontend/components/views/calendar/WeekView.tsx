'use client'

import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { useDroppable } from '@dnd-kit/core'
import type { Task } from '@/lib/api/tasks'
import { TaskChip } from './TaskChip'
import { DayMetaBadges, useDayMeta } from './CalendarDayMeta'
import { cn } from '@/lib/utils'

interface WeekViewProps {
  tasksByDate: Map<string, Task[]>
  anchorDate: string
  canUpdate: boolean
  currentUserId?: number
  onDateClick: (date: string) => void
  onTaskClick: (taskId: number) => void
}

function WeekDayColumn({
  day,
  tasks,
  canUpdate,
  currentUserId,
  onDateClick,
  onTaskClick,
}: {
  day: DateTime
  tasks: Task[]
  canUpdate: boolean
  currentUserId?: number
  onDateClick: (date: string) => void
  onTaskClick: (taskId: number) => void
}) {
  const dateKey = day.toISODate()!
  const today = new Date().toISOString().slice(0, 10)
  const isToday = dateKey === today
  const { setNodeRef, isOver } = useDroppable({
    id: `week-day-${dateKey}`,
    data: { date: dateKey },
  })
  const meta = useDayMeta(dateKey)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'bg-background min-h-[200px] p-2 transition-colors',
        meta.nonWorking && 'bg-muted/20',
        meta.freeze && 'bg-warning/5',
        isOver && 'bg-primary/10',
      )}
    >
      <div className="flex items-center justify-between gap-1 mb-2">
        <button
          className={cn(
            'text-xs font-medium px-1 rounded shrink-0',
            isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => onDateClick(dateKey)}
        >
          {day.toFormat('M/d (EEE)')}
        </button>
        <DayMetaBadges meta={meta} className="justify-end" />
      </div>
      <div className="space-y-1">
        {tasks.map((task) => (
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
      </div>
    </div>
  )
}

export function WeekView({
  tasksByDate,
  anchorDate,
  canUpdate,
  currentUserId,
  onDateClick,
  onTaskClick,
}: WeekViewProps) {
  const days = useMemo(() => {
    const anchor = DateTime.fromISO(anchorDate)
    const start = anchor.startOf('week')
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }))
  }, [anchorDate])

  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
      {days.map((day) => {
        const dateKey = day.toISODate()!
        const tasks = tasksByDate.get(dateKey) ?? []
        return (
          <WeekDayColumn
            key={dateKey}
            day={day}
            tasks={tasks}
            canUpdate={canUpdate}
            currentUserId={currentUserId}
            onDateClick={onDateClick}
            onTaskClick={onTaskClick}
          />
        )
      })}
    </div>
  )
}
