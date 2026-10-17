'use client'

import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import type { CalendarItem } from '@/lib/calendar-types'
import { buildDayBuckets, type DayPlacement } from '@/lib/calendar-layout'
import { dayWorkingStatus, type WorkingCalendarInfo } from '@/lib/calendar-working'
import { DayMetaBadges, useDayMeta } from '../CalendarDayMeta'
import { CalendarItemChip } from './CalendarItemChip'

const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日']
const MAX_VISIBLE = 3

interface ScheduleMonthViewProps {
  items: CalendarItem[]
  anchorDate: string
  workingCalendar?: WorkingCalendarInfo
  canRescheduleItem: (item: CalendarItem) => boolean
  onDateClick: (date: string) => void
  onOpenItem: (item: CalendarItem) => void
}

export function ScheduleMonthView({
  items,
  anchorDate,
  workingCalendar,
  canRescheduleItem,
  onDateClick,
  onOpenItem,
}: ScheduleMonthViewProps) {
  const today = DateTime.now().toISODate()!
  const anchorMonth = DateTime.fromISO(anchorDate).month

  const days = useMemo(() => {
    const anchor = DateTime.fromISO(anchorDate)
    const calStart = anchor.startOf('month').startOf('week')
    const calEnd = anchor.endOf('month').endOf('week')
    const result: string[] = []
    let current = calStart
    while (current <= calEnd) {
      result.push(current.toISODate()!)
      current = current.plus({ days: 1 })
    }
    return result
  }, [anchorDate])

  // 布局派生结果稳定缓存：仅在 items / 窗口变化时重算，hover/滚动不触发
  const buckets = useMemo(() => buildDayBuckets(items, days), [items, days])

  const weeks = useMemo(() => {
    const rows: string[][] = []
    for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7))
    return rows
  }, [days])

  return (
    <div className="border rounded-lg overflow-x-auto" role="grid" aria-label="排程月视图日历">
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
          {week.map((dateKey) => (
            <ScheduleDayCell
              key={dateKey}
              date={dateKey}
              dayNumber={DateTime.fromISO(dateKey).day}
              isToday={dateKey === today}
              isCurrentMonth={DateTime.fromISO(dateKey).month === anchorMonth}
              placements={buckets.get(dateKey) ?? []}
              working={dayWorkingStatus(workingCalendar, dateKey)}
              canRescheduleItem={canRescheduleItem}
              onDateClick={onDateClick}
              onOpenItem={onOpenItem}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function ScheduleDayCell({
  date,
  dayNumber,
  isToday,
  isCurrentMonth,
  placements,
  working,
  canRescheduleItem,
  onDateClick,
  onOpenItem,
}: {
  date: string
  dayNumber: number
  isToday: boolean
  isCurrentMonth: boolean
  placements: DayPlacement[]
  working: ReturnType<typeof dayWorkingStatus>
  canRescheduleItem: (item: CalendarItem) => boolean
  onDateClick: (date: string) => void
  onOpenItem: (item: CalendarItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `sched-day-${date}`, data: { date } })
  const visible = placements.slice(0, MAX_VISIBLE)
  const remaining = placements.length - MAX_VISIBLE

  const meta = useDayMeta(date)
  const workingLabel = working.isHoliday
    ? '节假日'
    : working.isExtraWorkday
      ? '调休上班'
      : working.isNonWorking && meta.statutorySource !== 'statutory'
        ? '非工作日'
        : null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-[var(--row-h,96px)] border-r last:border-r-0 p-[var(--card-pad,4px)] flex flex-col transition-colors',
        !isCurrentMonth && 'bg-muted/30',
        working.isNonWorking && 'bg-muted/40',
        working.isHoliday && 'bg-red-50 dark:bg-red-950/20',
        meta.statutorySource === 'statutory' && meta.nonWorking && 'bg-muted/40',
        meta.freeze && 'bg-warning/5',
        isOver && 'bg-primary/10',
      )}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <button
          className={cn(
            'w-6 h-6 rounded-full text-xs flex items-center justify-center',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isToday && 'bg-primary text-primary-foreground font-bold',
            !isToday && 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => onDateClick(date)}
          aria-label={`${date}${workingLabel ? `，${workingLabel}` : ''}，查看当日`}
        >
          {dayNumber}
        </button>
        {workingLabel && (
          <span
            className={cn(
              'text-[9px] leading-none rounded px-1 py-0.5',
              working.isHoliday
                ? 'text-red-600 bg-red-100 dark:bg-red-900/30'
                : working.isExtraWorkday
                  ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/30'
                  : 'text-muted-foreground bg-muted',
            )}
          >
            {workingLabel}
          </span>
        )}
        <DayMetaBadges meta={meta} omitProjectStatus className="justify-end" />
      </div>
      <div className="flex-1 space-y-0.5 overflow-hidden">
        {visible.map((placement) => (
          <CalendarItemChip
            key={placement.item.id}
            placement={placement}
            day={date}
            canReschedule={canRescheduleItem(placement.item)}
            onOpen={onOpenItem}
          />
        ))}
        {remaining > 0 && (
          <button
            className="w-full h-5 text-[10px] text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onDateClick(date)}
            aria-label={`还有 ${remaining} 项，点击查看当日完整列表`}
          >
            还有 {remaining} 项
          </button>
        )}
      </div>
    </div>
  )
}
