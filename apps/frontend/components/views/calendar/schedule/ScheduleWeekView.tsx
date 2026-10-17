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

interface ScheduleWeekViewProps {
  items: CalendarItem[]
  anchorDate: string
  workingCalendar?: WorkingCalendarInfo
  canRescheduleItem: (item: CalendarItem) => boolean
  onDateClick: (date: string) => void
  onOpenItem: (item: CalendarItem) => void
}

export function ScheduleWeekView({
  items,
  anchorDate,
  workingCalendar,
  canRescheduleItem,
  onDateClick,
  onOpenItem,
}: ScheduleWeekViewProps) {
  const today = DateTime.now().toISODate()!

  const days = useMemo(() => {
    const start = DateTime.fromISO(anchorDate).startOf('week')
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }).toISODate()!)
  }, [anchorDate])

  const buckets = useMemo(() => buildDayBuckets(items, days), [items, days])

  return (
    <div
      className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden"
      role="grid"
      aria-label="排程周视图日历"
    >
      {days.map((dateKey) => (
        <ScheduleWeekColumn
          key={dateKey}
          date={dateKey}
          isToday={dateKey === today}
          placements={buckets.get(dateKey) ?? []}
          working={dayWorkingStatus(workingCalendar, dateKey)}
          canRescheduleItem={canRescheduleItem}
          onDateClick={onDateClick}
          onOpenItem={onOpenItem}
        />
      ))}
    </div>
  )
}

function ScheduleWeekColumn({
  date,
  isToday,
  placements,
  working,
  canRescheduleItem,
  onDateClick,
  onOpenItem,
}: {
  date: string
  isToday: boolean
  placements: DayPlacement[]
  working: ReturnType<typeof dayWorkingStatus>
  canRescheduleItem: (item: CalendarItem) => boolean
  onDateClick: (date: string) => void
  onOpenItem: (item: CalendarItem) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `sched-week-${date}`, data: { date } })
  const dt = DateTime.fromISO(date)
  const meta = useDayMeta(date)
  const workingLabel = working.isHoliday
    ? '节假日'
    : working.isExtraWorkday
      ? '调休'
      : working.isNonWorking && meta.statutorySource !== 'statutory'
        ? '休'
        : null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'bg-background min-h-[220px] p-2 transition-colors',
        working.isNonWorking && 'bg-muted/40',
        working.isHoliday && 'bg-red-50 dark:bg-red-950/20',
        meta.statutorySource === 'statutory' && meta.nonWorking && 'bg-muted/40',
        meta.freeze && 'bg-warning/5',
        isOver && 'bg-primary/10',
      )}
      role="gridcell"
    >
      <div className="flex items-center justify-between gap-1 mb-2">
        <button
          className={cn(
            'text-xs font-medium px-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
          onClick={() => onDateClick(date)}
          aria-label={`${date}${workingLabel ? `，${workingLabel === '休' ? '非工作日' : workingLabel}` : ''}，查看当日`}
        >
          {dt.toFormat('M/d (EEE)')}
        </button>
        {workingLabel && (
          <span className="text-[9px] text-muted-foreground rounded bg-muted px-1">
            {workingLabel}
          </span>
        )}
        <DayMetaBadges meta={meta} omitProjectStatus className="justify-end" />
      </div>
      <div className="space-y-0.5">
        {placements.length === 0 && <p className="text-[10px] text-muted-foreground/60">无</p>}
        {placements.map((placement) => (
          <CalendarItemChip
            key={placement.item.id}
            placement={placement}
            day={date}
            canReschedule={canRescheduleItem(placement.item)}
            onOpen={onOpenItem}
          />
        ))}
      </div>
    </div>
  )
}
