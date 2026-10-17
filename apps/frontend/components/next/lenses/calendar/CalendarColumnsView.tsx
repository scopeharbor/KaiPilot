'use client'

import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { CalendarSystemId, PrimaryCalendarSystem } from '@aiproj/types'
import { cn } from '@/lib/utils'
import type { CalendarItem } from '@/lib/calendar-types'
import { annotationsFor, primaryDayLabel, weekdayIndex } from '@/lib/calendar-systems'
import { placeItemsOnDays, type CalendarDayPlacement } from '@/lib/next/lenses-calendar-adapter'
import { useDayMeta } from '@/components/views/calendar/CalendarDayMeta'
import {
  CLICKABLE,
  FOCUS_RING,
  MILESTONE_DIAMOND_TONE,
  NxDayAnnotations,
  PRIORITY_LABELS,
  WEEKDAY_LABELS,
  statusLabelOf,
  taskItemProps,
  toneOf,
} from './calendar-item-ui'
import type { QuickCreateRequest } from './use-calendar-day-gestures'

/**
 * 周视图（7 列）/ 日视图（1 列）：每天一列、当天全部任务都列出来（不折叠），
 * 卡片带负责人与状态；空白处单击选中、双击或「+」新建、拖过几天建跨日任务。
 */
export interface CalendarColumnsViewProps {
  days: readonly string[]
  items: readonly CalendarItem[]
  today: string
  primarySystem: PrimaryCalendarSystem
  secondarySystems: readonly CalendarSystemId[]
  selectedDate: string | null
  onOpenTask?: (taskId: number) => void
  focusTaskId?: number | null
  dayProps: (date: string) => Record<string, unknown>
  inDragRange: (date: string) => boolean
  onCreate: (request: QuickCreateRequest) => void
  /** 我这天休假 / 不上班（「我的日历」）。 */
  offLabelOf?: (date: string) => string | null
}

function ColumnItem({
  placement,
  onOpenTask,
  focused,
  detailed,
}: {
  placement: CalendarDayPlacement
  onOpenTask?: (taskId: number) => void
  focused: boolean
  detailed: boolean
}) {
  const { item } = placement
  const tone = toneOf(item.status)
  const clickProps = taskItemProps(item, onOpenTask)
  const continues = !placement.isEnd
  const continued = !placement.isStart
  return (
    <div
      data-calendar-item
      data-kind={item.kind}
      data-focused={focused ? 'true' : undefined}
      {...clickProps}
      className={cn(
        'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-[13px]',
        item.kind === 'milestone'
          ? 'border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]'
          : tone.band,
        'role' in clickProps && CLICKABLE,
        focused && FOCUS_RING,
      )}
    >
      <span className="flex items-center gap-1.5">
        {item.kind === 'milestone' ? (
          <span
            aria-hidden
            className={cn(
              'h-2 w-2 shrink-0 rotate-45 border',
              MILESTONE_DIAMOND_TONE[item.status] ?? MILESTONE_DIAMOND_TONE.planned!,
            )}
          />
        ) : (
          <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--nx-text-primary)]">
          {continued ? '… ' : ''}
          {item.name}
          {continues ? ' →' : ''}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-[var(--nx-text-muted)]">
        <span>{statusLabelOf(item)}</span>
        {item.projectName ? <span className="truncate">· {item.projectName}</span> : null}
        {item.assignee ? (
          <span className="truncate">· {item.assignee.fullName ?? item.assignee.email}</span>
        ) : null}
        {item.priority && item.priority !== 'medium' ? (
          <span>· {PRIORITY_LABELS[item.priority] ?? ''}</span>
        ) : null}
        {detailed && item.dateRange.start !== item.dateRange.end ? (
          <span className="ml-auto font-mono">
            {item.dateRange.start?.slice(5)} ~ {item.dateRange.end?.slice(5)}
          </span>
        ) : null}
      </span>
    </div>
  )
}

function DayColumn({
  date,
  placements,
  props,
}: {
  date: string
  placements: CalendarDayPlacement[]
  props: CalendarColumnsViewProps
}) {
  const meta = useDayMeta(date)
  const annotations = useMemo(
    () => annotationsFor(date, props.secondarySystems),
    [date, props.secondarySystems],
  )
  const isToday = date === props.today
  const offLabel = props.offLabelOf?.(date) ?? null
  const detailed = props.days.length === 1
  return (
    <div
      data-calendar-day
      data-calendar-column
      data-date={date}
      data-today={isToday ? 'true' : undefined}
      data-selected={props.selectedDate === date ? 'true' : undefined}
      data-in-drag={props.inDragRange(date) ? 'true' : undefined}
      data-non-working={meta.nonWorking ? 'true' : undefined}
      {...props.dayProps(date)}
      className={cn(
        'group relative flex min-h-[460px] flex-col border-r border-[var(--nx-border-hairline)] last:border-r-0',
        meta.nonWorking && 'bg-[var(--nx-bg-0)]',
        props.selectedDate === date && 'bg-[var(--nx-space-cyan)]/5',
        props.inDragRange(date) && 'bg-[var(--nx-space-cyan)]/10',
      )}
    >
      <div
        className={cn(
          'flex items-start justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-2 py-2',
          isToday && 'shadow-[inset_0_2px_0_var(--nx-space-cyan)]',
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-[var(--nx-text-muted)]">
            周{WEEKDAY_LABELS[weekdayIndex(date)]}
          </span>
          <NxDayAnnotations annotations={annotations} meta={meta} />
          {offLabel ? (
            <span
              data-calendar-personal-off
              className="w-fit rounded-sm bg-[var(--nx-status-warning)]/15 px-1 text-[11px] font-medium text-[var(--nx-status-warning)]"
            >
              {offLabel}
            </span>
          ) : null}
        </div>
        <span
          data-calendar-day-number
          className={cn(
            'text-xl font-semibold leading-none tabular-nums',
            isToday ? 'text-[var(--nx-space-cyan)]' : 'text-[var(--nx-text-secondary)]',
          )}
        >
          {primaryDayLabel(props.primarySystem, date)}
        </span>
      </div>
      <div className={cn('flex flex-1 flex-col gap-1.5 p-1.5', detailed && 'p-3')}>
        {placements.map((placement) => (
          <ColumnItem
            key={placement.item.id}
            placement={placement}
            onOpenTask={props.onOpenTask}
            focused={
              placement.item.kind === 'task' && placement.item.sourceId === props.focusTaskId
            }
            detailed={detailed}
          />
        ))}
      </div>
      <button
        type="button"
        data-calendar-add={date}
        aria-label={`在 ${date} 新建任务`}
        title="新建任务（也可以双击空白处，或拖过几天）"
        onClick={(event) =>
          props.onCreate({
            startDate: date,
            endDate: null,
            anchor: (
              event.currentTarget.parentElement ?? event.currentTarget
            ).getBoundingClientRect(),
          })
        }
        className="mx-1.5 mb-1.5 flex h-7 items-center justify-center rounded-md text-[var(--nx-text-muted)] opacity-0 transition-opacity hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-space-cyan)] focus-visible:opacity-100 group-hover:opacity-60"
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

export function CalendarColumnsView(props: CalendarColumnsViewProps) {
  const buckets = useMemo(
    () => placeItemsOnDays(props.days, props.items),
    [props.days, props.items],
  )
  return (
    <div
      data-calendar-columns={props.days.length === 1 ? 'day' : 'week'}
      aria-label={props.days.length === 1 ? '项目日历日视图' : '项目日历周视图'}
      className={cn(
        'grid overflow-hidden rounded-lg border border-[var(--nx-border-hairline)]',
        props.days.length === 1 ? 'grid-cols-1' : 'grid-cols-7',
      )}
    >
      {props.days.map((date) => (
        <DayColumn key={date} date={date} placements={buckets.get(date) ?? []} props={props} />
      ))}
    </div>
  )
}

export default CalendarColumnsView
