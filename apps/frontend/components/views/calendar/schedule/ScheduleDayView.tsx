'use client'

import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarItem } from '@/lib/calendar-types'
import { itemsIntersectingWindow } from '@/lib/calendar-layout'
import { dayWorkingStatus, type WorkingCalendarInfo } from '@/lib/calendar-working'
import { useDayMeta } from '../CalendarDayMeta'
import { statusLabel } from './CalendarItemChip'

const PRIORITY_COLORS: Record<string, string> = {
  highest: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  lowest: 'bg-gray-400',
}

interface ScheduleDayViewProps {
  items: CalendarItem[]
  date: string
  workingCalendar?: WorkingCalendarInfo
  onOpenItem: (item: CalendarItem) => void
}

export function ScheduleDayView({
  items,
  date,
  workingCalendar,
  onOpenItem,
}: ScheduleDayViewProps) {
  const dayItems = useMemo(() => itemsIntersectingWindow(items, date, date), [items, date])
  const working = dayWorkingStatus(workingCalendar, date)
  const meta = useDayMeta(date)
  const workingLabel = working.isHoliday
    ? '节假日'
    : working.isExtraWorkday
      ? '调休上班'
      : working.isNonWorking
        ? '非工作日'
        : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{DateTime.fromISO(date).toFormat('yyyy年 M月 d日 (EEEE)')}</span>
        {workingLabel && (
          <span
            className={cn(
              'text-xs rounded px-1.5 py-0.5',
              working.isHoliday
                ? 'text-red-600 bg-red-100 dark:bg-red-900/30'
                : working.isExtraWorkday
                  ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/30'
                  : 'bg-muted',
            )}
          >
            {workingLabel}
          </span>
        )}
        <span className="text-xs">{meta.lunarText}</span>
        {meta.statutorySource === 'statutory' && meta.statutory && (
          <span className={meta.statutory === 'off' ? 'text-xs text-destructive' : 'text-xs'}>
            {meta.statutory === 'off'
              ? `${meta.statutoryName ?? '节假日'}放假`
              : `${meta.statutoryName ?? ''}调休上班`}
          </span>
        )}
        {meta.freeze && (
          <span className="text-xs text-warning">
            {meta.freeze.label}（{meta.freeze.start} ~ {meta.freeze.end}），期间不安排生产变更
          </span>
        )}
      </div>

      {dayItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          该日期没有排程任务或里程碑
        </div>
      ) : (
        dayItems.map((item) => {
          const isMilestone = item.kind === 'milestone'
          return (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenItem(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onOpenItem(item)
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`${isMilestone ? '里程碑' : '任务'}：${item.name}，状态：${statusLabel(item.status)}${item.isOverdue ? '，逾期' : ''}`}
            >
              {isMilestone ? (
                <Flag className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              ) : (
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    PRIORITY_COLORS[item.priority ?? ''] ?? 'bg-gray-400',
                  )}
                  aria-hidden
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.name}</div>
                <div className="text-xs text-muted-foreground">
                  {statusLabel(item.status)}
                  {item.dateRange.start && item.dateRange.end && item.dateRange.isSpan && (
                    <span>
                      {' '}
                      · {item.dateRange.start} → {item.dateRange.end}
                    </span>
                  )}
                  {item.assignee && ` · ${item.assignee.fullName ?? item.assignee.email}`}
                </div>
              </div>
              {item.isOverdue && (
                <span className="text-xs text-red-600 font-medium shrink-0">逾期</span>
              )}
              {isMilestone && (
                <span className="text-xs text-primary font-medium shrink-0">里程碑</span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
