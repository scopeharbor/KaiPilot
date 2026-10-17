'use client'

import { useMemo } from 'react'
import { DateTime } from 'luxon'
import type { Task } from '@/lib/api/tasks'
import { CalendarDayCell } from './CalendarDayCell'

interface MonthViewProps {
  tasksByDate: Map<string, Task[]>
  anchorDate: string
  canUpdate: boolean
  currentUserId?: number
  onDateClick: (date: string) => void
  onTaskClick: (taskId: number) => void
}

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日']

export function MonthView({
  tasksByDate,
  anchorDate,
  canUpdate,
  currentUserId,
  onDateClick,
  onTaskClick,
}: MonthViewProps) {
  const today = DateTime.now().toISODate()!

  const weeks = useMemo(() => {
    const anchor = DateTime.fromISO(anchorDate)
    const monthStart = anchor.startOf('month')
    const monthEnd = anchor.endOf('month')
    const calStart = monthStart.startOf('week')
    const calEnd = monthEnd.endOf('week')

    const result: DateTime[][] = []
    let current = calStart
    while (current <= calEnd) {
      const week: DateTime[] = []
      for (let i = 0; i < 7; i++) {
        week.push(current)
        current = current.plus({ days: 1 })
      }
      result.push(week)
    }
    return result
  }, [anchorDate])

  return (
    <div className="border rounded-lg overflow-x-auto" role="grid" aria-label="月视图日历">
      <div className="grid grid-cols-7 border-b min-w-[560px]">
        {WEEKDAY_HEADERS.map((day) => (
          <div
            key={day}
            className="p-2 text-center text-xs font-medium text-muted-foreground border-r last:border-r-0"
            role="columnheader"
          >
            {day}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b last:border-b-0 min-w-[560px]">
          {week.map((day) => {
            const dateKey = day.toISODate()!
            const isCurrentMonth = day.month === DateTime.fromISO(anchorDate).month
            const tasks = tasksByDate.get(dateKey) ?? []
            return (
              <CalendarDayCell
                key={dateKey}
                date={dateKey}
                dayNumber={day.day}
                isToday={dateKey === today}
                isCurrentMonth={isCurrentMonth}
                tasks={tasks}
                maxVisible={3}
                canUpdate={canUpdate}
                currentUserId={currentUserId}
                onDateClick={onDateClick}
                onTaskClick={onTaskClick}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
