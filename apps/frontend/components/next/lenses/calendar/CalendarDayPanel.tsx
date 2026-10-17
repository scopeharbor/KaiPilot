'use client'

import { useMemo } from 'react'
import { Plus, X } from 'lucide-react'
import type { CalendarSystemId, PrimaryCalendarSystem } from '@aiproj/types'
import { cn } from '@/lib/utils'
import type { CalendarItem } from '@/lib/calendar-types'
import { annotationsFor, primaryDayLabel, weekdayIndex } from '@/lib/calendar-systems'
import { normalizeItemSpan } from '@/lib/next/lenses-calendar-adapter'
import { useDayMeta } from '@/components/views/calendar/CalendarDayMeta'
import {
  MILESTONE_DIAMOND_TONE,
  WEEKDAY_LABELS,
  dateSpanText,
  statusLabelOf,
  taskItemProps,
  toneOf,
} from './calendar-item-ui'

/**
 * 当日侧栏（月 / 周视图点某天、或点「+N 项」打开）：这天的曆法标注、全部任务与里程碑、在这天新建。
 * 不遮住日历（非模态），点任务打开详情时侧栏保留，方便连续查看。
 */
export interface CalendarDayPanelProps {
  date: string
  items: readonly CalendarItem[]
  primarySystem: PrimaryCalendarSystem
  calendarSystems: readonly CalendarSystemId[]
  onClose: () => void
  onOpenTask?: (taskId: number) => void
  onCreate: (anchor: DOMRect | null) => void
  /** 我这天休假 / 不上班（「我的日历」）。 */
  offLabel?: string | null
}

/** 覆盖某天的日历项（起止含这天）。 */
export function itemsOnDate(items: readonly CalendarItem[], date: string): CalendarItem[] {
  return items.filter((item) => {
    const span = normalizeItemSpan(item)
    return span !== null && span.start <= date && span.end >= date
  })
}

export function CalendarDayPanel({
  date,
  items,
  primarySystem,
  calendarSystems,
  onClose,
  onOpenTask,
  onCreate,
  offLabel = null,
}: CalendarDayPanelProps) {
  const meta = useDayMeta(date)
  const annotations = useMemo(
    () => annotationsFor(date, calendarSystems).filter((item) => item.system !== primarySystem),
    [date, calendarSystems, primarySystem],
  )
  const dayItems = useMemo(() => itemsOnDate(items, date), [items, date])
  const [year, month, day] = date.split('-').map(Number)

  return (
    <aside
      data-calendar-day-panel
      data-date={date}
      aria-label={`${date} 当日任务`}
      className="flex w-full shrink-0 flex-col border-t border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] lg:w-80 lg:border-l lg:border-t-0"
    >
      <header className="flex items-start justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--nx-text-primary)]">
            {year}年{month}月{day}日 · 周{WEEKDAY_LABELS[weekdayIndex(date)]}
            {primarySystem !== 'solar' ? (
              <span className="ml-1.5 font-normal text-[var(--nx-space-cyan)]">
                {primaryDayLabel(primarySystem, date)}
              </span>
            ) : null}
          </p>
          {annotations.length > 0 || meta.freeze ? (
            <p
              data-calendar-day-panel-annotations
              className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]"
            >
              {annotations.map((item) => item.full).join(' · ')}
              {meta.freeze
                ? `${annotations.length > 0 ? ' · ' : ''}${meta.freeze.label}（封网）`
                : ''}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          data-calendar-day-panel-close
          aria-label="关闭当日面板"
          onClick={onClose}
          className="rounded p-1 text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {offLabel ? (
        <p
          data-calendar-day-panel-off
          className="border-b border-[var(--nx-border-hairline)] bg-[var(--nx-status-warning)]/10 px-4 py-2 text-xs text-[var(--nx-status-warning)]"
        >
          你这天{offLabel === '不上班' ? '不上班（个人工作日）' : offLabel}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto p-2">
        {dayItems.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--nx-text-muted)]">这天没有任务</p>
        ) : (
          <ul data-calendar-day-panel-list className="space-y-1">
            {dayItems.map((item) => {
              const tone = toneOf(item.status)
              const clickProps = taskItemProps(item, onOpenTask)
              return (
                <li key={item.id}>
                  <div
                    data-calendar-day-panel-item
                    data-kind={item.kind}
                    {...clickProps}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-[var(--nx-bg-1)]',
                      'role' in clickProps && 'cursor-pointer',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {item.kind === 'milestone' ? (
                        <span
                          aria-hidden
                          className={cn(
                            'h-2 w-2 shrink-0 rotate-45 border',
                            MILESTONE_DIAMOND_TONE[item.status] ?? MILESTONE_DIAMOND_TONE.planned!,
                          )}
                        />
                      ) : (
                        <span
                          aria-hidden
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--nx-text-primary)]">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--nx-text-secondary)]">
                        {statusLabelOf(item)}
                      </span>
                    </span>
                    <span className="flex gap-2 pl-3.5 text-[11px] text-[var(--nx-text-muted)]">
                      <span className="font-mono">{dateSpanText(item)}</span>
                      {item.assignee ? (
                        <span className="truncate">
                          {item.assignee.fullName ?? item.assignee.email}
                        </span>
                      ) : null}
                      {item.projectName ? (
                        <span data-calendar-item-project className="truncate">
                          {item.projectName}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-[var(--nx-border-hairline)] p-2">
        <button
          type="button"
          data-calendar-day-panel-create
          onClick={(event) => onCreate(event.currentTarget.getBoundingClientRect())}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--nx-border-hairline)] py-1.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)] hover:text-[var(--nx-space-cyan)]"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          在这天新建任务
        </button>
      </footer>
    </aside>
  )
}

export default CalendarDayPanel
