/**
 * 新轨日历时间切面镜头（v3-ui-next-remaining-lenses W3 tasks 3.3 / spec「日历时间切面镜头月历网格与任务落位」）。
 *
 * 架构职责：
 * 1. 取数：消费 `useProjectCalendarSchedule(projectId, { view: 'month', anchorDate })`，
 *    月份切换仅更新 anchorDate —— 查询键随之变化自动重拉（零网络写请求，RL-06）；
 * 2. 落位：所有月矩阵/跨日落位/溢出折叠计算收敛于 `lib/next/lenses-calendar-adapter.ts`
 *    纯函数（`computeMonthGrid`），本组件只消费只读 ViewModel；
 * 3. 视觉（D18 方案 A）：周一至周日 7 列月历网格 + 发丝线（--nx-border-hairline）；
 *    今天单元格电光天青（--nx-space-cyan）发丝边框与高亮数字；跨日任务呈连续条带
 *    （起点圆角左缘 / 终点圆角右缘 / 中间平直通透）；单日超 3 项折叠为「+N 项」，
 *    点击在右侧当日面板列出全部（日历第 2 批）；
 * 4. 状态反馈：7 列发丝脉冲骨架屏 / 当月无排程空态 / 错误重试卡片；
 *    精确档（precise）或系统减弱动画下停用脉冲与光晕，退化为纯 1px 实线网格。
 * 5. 日历第 2 批：月 / 周 / 日三种视图；单击空白选中某天（右侧当日面板）；
 *    双击空白、悬停「+」或拖过几天 → 原地快速新建（AI 补全，Enter 建立，5 秒内可撤销）。
 */

'use client'

import { useMobileWorkspace } from '@/hooks/use-mobile-workspace'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { useProjectCalendarSchedule } from '@/hooks/use-calendar'
import { taskKeys, tasksApi } from '@/lib/api/tasks'
import type { CalendarFilters } from '@/lib/api/calendar'
import type { CalendarFullResponse, CalendarItem } from '@/lib/calendar-types'
import {
  DEFAULT_CALENDAR_SYSTEMS,
  isPersonallyOff,
  personalLeaveOn,
  primaryCalendarOf,
  secondaryCalendarsOf,
  type CalendarSystemId,
} from '@aiproj/types'
import {
  annotationsFor,
  primaryDayLabel,
  primaryMonthAt,
  solarSpanLabel,
  weekdayIndex,
} from '@/lib/calendar-systems'
import {
  MAX_VISIBLE_ITEMS_PER_CELL,
  computeMonthGrid,
  monthGridDays,
  rangeGridDays,
  shiftAnchorDays,
  shiftAnchorMonth,
  toDateString,
  weekDaysOf,
  type CalendarDayCellData,
  type CalendarDayPlacement,
} from '@/lib/next/lenses-calendar-adapter'
import { CalendarDayMetaProvider, useDayMeta } from '@/components/views/calendar/CalendarDayMeta'
import {
  CLICKABLE,
  FOCUS_RING,
  MILESTONE_DIAMOND_TONE,
  NxDayAnnotations,
  PRIORITY_LABELS,
  WEEKDAY_LABELS,
  taskItemProps,
  toneOf,
} from './calendar/calendar-item-ui'
import { CalendarColumnsView } from './calendar/CalendarColumnsView'
import { CalendarDayPanel } from './calendar/CalendarDayPanel'
import { CalendarQuickCreate } from './calendar/CalendarQuickCreate'
import { CalendarUndoBar, type CreatedTaskRef } from './calendar/CalendarUndoBar'
import {
  useCalendarDayGestures,
  type QuickCreateRequest,
} from './calendar/use-calendar-day-gestures'

/** 日历视图：月格 / 周（7 列）/ 日（1 列）。 */
export type CalendarViewMode = 'month' | 'week' | 'day'

const VIEW_LABELS: Record<CalendarViewMode, { title: string; prev: string; next: string }> = {
  month: { title: '月', prev: '上个月', next: '下个月' },
  week: { title: '周', prev: '上一周', next: '下一周' },
  day: { title: '日', prev: '前一天', next: '后一天' },
}

/** 日历取数 hook（项目日历 / 「我的日历」可换用）。 */
export type CalendarScheduleHook = (
  projectId: number | null,
  filters: CalendarFilters,
) => {
  data: CalendarFullResponse | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
  isPlaceholderData: boolean
}

function useProjectSchedule(projectId: number | null, filters: CalendarFilters) {
  return useProjectCalendarSchedule(projectId ?? 0, filters)
}

export interface WorkspaceCalendarLensProps {
  /** 项目日历的项目；null = 「我的日历」（跨项目，配合 useSchedule）。 */
  projectId: number | null
  className?: string
  /** 首屏渲染完成度量（性能预算测试消费，可选）。 */
  onRenderComplete?: (metric: { durationMs: number; activeElements: number }) => void
  /** 测试注入：固定「今天」（YYYY-MM-DD）；缺省取系统当前日期。 */
  today?: string
  /** 测试注入：初始锚定月内任意日期；缺省为今天。 */
  initialAnchorDate?: string
  /** 点任务：打开任务详情（容器同步 ?focusTask=）。里程碑不响应。 */
  onOpenTask?: (taskId: number) => void
  /** 当前聚焦的任务（?focusTask=）：日历自动翻到它的开始月份并高亮。 */
  focusTaskId?: number | null
  /** 生效的曆法设定（有序；第一个可当主曆的决定月格）。缺省为系统默认。 */
  calendarSystems?: readonly CalendarSystemId[]
  /** 初始视图（缺省月）。 */
  initialView?: CalendarViewMode
  /** 取数 hook（缺省项目日历；「我的日历」传 useMyCalendarSchedule）。同一实例内不可更换。 */
  useSchedule?: CalendarScheduleHook
  /** 点任务（带整条日历项，跨项目时用它拿项目）；给了就优先于 onOpenTask。 */
  onOpenItem?: (item: CalendarItem) => void
}

// ---------------------------------------------------------------------------
// 7 列月历网格骨架（发丝脉冲；精确档静态化）
// ---------------------------------------------------------------------------

function CalendarGridSkeleton({ flat }: { flat: boolean }) {
  const pulse = flat ? '' : 'animate-pulse'
  return (
    <div
      data-calendar-skeleton
      role="status"
      aria-label="正在加载日历排程"
      aria-busy="true"
      className="overflow-hidden rounded-lg border border-[var(--nx-border-hairline)]"
    >
      <div className="grid grid-cols-7 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-r py-1.5 text-center text-[10px] text-[var(--nx-text-muted)] last:border-r-0"
          >
            {label}
          </div>
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className="grid grid-cols-7 border-b border-[var(--nx-border-hairline)] last:border-b-0"
        >
          {[0, 1, 2, 3, 4, 5, 6].map((col) => (
            <div
              key={col}
              className={cn(
                'flex h-[104px] flex-col gap-2 border-r border-[var(--nx-border-hairline)] p-1.5 last:border-r-0',
              )}
            >
              <div className={cn('h-3 w-6 rounded bg-[var(--nx-bg-1)]', pulse)} />
              <div className={cn('h-4 rounded bg-[var(--nx-workspace-surface)]', pulse)} />
              <div className={cn('h-4 rounded bg-[var(--nx-workspace-surface)]', pulse)} />
              <div className={cn('h-4 rounded bg-[var(--nx-workspace-surface)]', pulse)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单日单元格
// ---------------------------------------------------------------------------

interface DayCellViewProps {
  cell: CalendarDayCellData
  isLastCol: boolean
  isLastRow: boolean
  flat: boolean
  onOpenDay: (dateString: string) => void
  onOpenTask?: (taskId: number) => void
  focusTaskId?: number | null
  secondarySystems: readonly CalendarSystemId[]
  isFirstCol?: boolean
  /** 手势（单击选中 / 双击新建 / 拖选）。 */
  dayProps?: Record<string, unknown>
  selected?: boolean
  inDrag?: boolean
  onCreate?: (request: QuickCreateRequest) => void
  /** 我这天休假 / 不上班（「我的日历」）。 */
  offLabel?: string | null
}

function DayCellView({
  cell,
  isLastCol,
  isLastRow,
  flat,
  onOpenDay,
  onOpenTask,
  focusTaskId,
  secondarySystems,
  isFirstCol = false,
  dayProps,
  selected = false,
  inDrag = false,
  onCreate,
  offLabel = null,
}: DayCellViewProps) {
  const visible = cell.placements.slice(0, MAX_VISIBLE_ITEMS_PER_CELL)
  const meta = useDayMeta(cell.dateString)
  const annotations = useMemo(
    () => annotationsFor(cell.dateString, secondarySystems),
    [cell.dateString, secondarySystems],
  )
  return (
    <div
      data-calendar-day
      data-date={cell.dateString}
      data-current-month={cell.isCurrentMonth ? 'true' : 'false'}
      data-today={cell.isToday ? 'true' : undefined}
      data-weekend={cell.isWeekend ? 'true' : undefined}
      data-non-working={meta.nonWorking ? 'true' : undefined}
      data-freeze={meta.freeze ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-in-drag={inDrag ? 'true' : undefined}
      {...dayProps}
      className={cn(
        'group relative flex min-h-[128px] flex-col gap-[3px] border-b border-[var(--nx-border-hairline)]',
        !isLastCol && 'border-r',
        isLastRow && 'border-b-0',
        !cell.isCurrentMonth && 'bg-[var(--nx-bg-0)]',
        cell.isCurrentMonth && meta.freeze && 'bg-[var(--nx-status-warning)]/5',
        cell.isToday && 'ring-1 ring-inset ring-[var(--nx-space-cyan)]',
        selected && 'bg-[var(--nx-space-cyan)]/5',
        inDrag && 'bg-[var(--nx-space-cyan)]/10',
      )}
    >
      <div className="flex items-start justify-between gap-1 px-1.5 pt-1">
        <span className="flex min-w-0 items-center gap-1">
          {offLabel ? (
            <span
              data-calendar-personal-off
              title={offLabel}
              className="shrink-0 rounded-sm bg-[var(--nx-status-warning)]/15 px-0.5 text-[11px] font-medium leading-none text-[var(--nx-status-warning)]"
            >
              {offLabel === '不上班' ? '不上班' : '休假'}
            </span>
          ) : null}
          <NxDayAnnotations annotations={annotations} meta={meta} />
        </span>
        <span
          data-calendar-day-number
          className={cn(
            'shrink-0 text-base font-semibold leading-none tabular-nums',
            cell.isToday
              ? cn(
                  'font-semibold text-[var(--nx-space-cyan)]',
                  !flat && '[text-shadow:0_0_8px_var(--nx-space-cyan)]',
                )
              : cell.isCurrentMonth
                ? 'text-[var(--nx-text-secondary)]'
                : 'text-[var(--nx-text-muted)]',
          )}
        >
          {cell.dayLabel}
        </span>
      </div>

      {visible.map((placement) => (
        <PlacementRow
          key={placement.item.id}
          placement={placement}
          onOpenTask={onOpenTask}
          focused={placement.item.kind === 'task' && placement.item.sourceId === focusTaskId}
          weekStart={isFirstCol}
        />
      ))}

      {cell.overflowCount > 0 ? (
        <button
          type="button"
          data-calendar-overflow
          data-date={cell.dateString}
          onClick={() => onOpenDay(cell.dateString)}
          className="mx-1 w-fit rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-px text-[11px] leading-4 text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)] hover:text-[var(--nx-space-cyan)]"
        >
          +{cell.overflowCount} 项
        </button>
      ) : null}

      {onCreate ? (
        <button
          type="button"
          data-calendar-add={cell.dateString}
          aria-label={`在 ${cell.dateString} 新建任务`}
          title="新建任务（也可以双击空白处，或拖过几天）"
          onClick={(event) =>
            onCreate({
              startDate: cell.dateString,
              endDate: null,
              anchor: (
                event.currentTarget.parentElement ?? event.currentTarget
              ).getBoundingClientRect(),
            })
          }
          className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded text-[var(--nx-text-muted)] opacity-0 transition-opacity hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-space-cyan)] focus-visible:opacity-100 group-hover:opacity-60 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:opacity-100"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/** 单条排程微卡：跨日条带段（start/middle/end）或单日微卡（single）。 */
function PlacementRow({
  placement,
  onOpenTask,
  focused,
  weekStart,
}: {
  placement: CalendarDayPlacement
  onOpenTask?: (taskId: number) => void
  focused?: boolean
  /** 该格是一周的第一列：跨周延续的条带在这里重复显示名称。 */
  weekStart?: boolean
}) {
  const { item } = placement
  const tone = toneOf(item.status)
  const clickProps = taskItemProps(item, onOpenTask)
  const clickable = 'role' in clickProps

  // 单日项 → 状态圆点微卡（任务）或 45° 棱形微卡（里程碑）；左右留 4px 与条带区分
  if (placement.isStart && placement.isEnd) {
    return (
      <div className="px-1">
        {item.kind === 'milestone' ? (
          <div
            data-calendar-item
            data-kind="milestone"
            data-span-edge="single"
            data-calendar-milestone
            className="flex h-5 w-full items-center gap-1 rounded-[3px] border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-1"
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 shrink-0 rotate-45 border',
                MILESTONE_DIAMOND_TONE[item.status] ?? MILESTONE_DIAMOND_TONE.planned!,
              )}
            />
            <span className="truncate text-[12px] leading-none text-[var(--nx-text-primary)]">
              {item.name}
            </span>
          </div>
        ) : (
          <div
            data-calendar-item
            data-kind="task"
            data-span-edge="single"
            data-focused={focused ? 'true' : undefined}
            {...clickProps}
            className={cn(
              'flex h-5 w-full items-center gap-1 rounded-[3px] border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-1',
              clickable && CLICKABLE,
              focused && FOCUS_RING,
            )}
          >
            <span aria-hidden className={cn('h-1 w-1 shrink-0 rounded-full', tone.dot)} />
            {item.priority && item.priority !== 'medium' ? (
              <span className="shrink-0 text-[9px] leading-none text-[var(--nx-text-muted)]">
                {PRIORITY_LABELS[item.priority] ?? ''}
              </span>
            ) : null}
            <span className="truncate text-[12px] leading-none text-[var(--nx-text-primary)]">
              {item.name}
            </span>
          </div>
        )}
      </div>
    )
  }

  // 跨日条带段：起点圆角左缘 + 名称；终点圆角右缘 + 名称；中间平直通透发丝连线
  const isMiddle = placement.isMiddle
  return (
    <div
      data-calendar-item
      data-kind={item.kind}
      data-span-edge={isMiddle ? 'middle' : placement.isStart ? 'start' : 'end'}
      data-focused={focused ? 'true' : undefined}
      {...clickProps}
      className={cn(
        'flex h-5 w-full items-center overflow-hidden border-y text-[12px] leading-none',
        tone.band,
        clickable && 'cursor-pointer hover:brightness-125 focus-visible:outline-none',
        focused && 'brightness-125',
        isMiddle
          ? 'border-x-0'
          : placement.isStart
            ? 'rounded-l-[3px] border-l px-1'
            : 'rounded-r-[3px] border-r px-1',
      )}
    >
      {!isMiddle || weekStart ? (
        <span className={cn('truncate text-[var(--nx-text-primary)]', isMiddle && 'px-1')}>
          {item.name}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 聚焦任务（AI「带我去」或分享链接 ?focusTask=）：取它的开始日（没有则截止日）交给日历翻月。
 * 与详情抽屉共用同一查询缓存，不额外请求；只在有聚焦任务时挂载。
 */
function FocusTaskNavigator({
  projectId,
  taskId,
  onTaskDate,
}: {
  projectId: number
  taskId: number
  onTaskDate: (taskId: number, date: string) => void
}) {
  const { data: task } = useQuery({
    queryKey: taskKeys.detail(projectId, taskId),
    queryFn: () => tasksApi.get(projectId, taskId),
  })
  useEffect(() => {
    if (!task || task.id !== taskId) return
    const date = (task.startDate ?? task.endDate)?.slice(0, 10)
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) onTaskDate(taskId, date)
  }, [task, taskId, onTaskDate])
  return null
}

// ---------------------------------------------------------------------------
// 镜头主组件
// ---------------------------------------------------------------------------

export function WorkspaceCalendarLens({
  projectId,
  className,
  onRenderComplete,
  today,
  initialAnchorDate,
  onOpenTask,
  focusTaskId = null,
  calendarSystems = DEFAULT_CALENDAR_SYSTEMS,
  initialView = 'month',
  useSchedule = useProjectSchedule,
  onOpenItem,
}: WorkspaceCalendarLensProps) {
  const tier = useImmersionTier()
  // 主曆决定月格；副曆按设定顺序给每天加标注
  const primarySystem = primaryCalendarOf(calendarSystems)
  const secondarySystems = useMemo(() => secondaryCalendarsOf(calendarSystems), [calendarSystems])
  // 精确档或系统减弱动画偏好：骨架脉冲与今天光晕一律停用（spec「减弱动画」）
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(media.matches)
    const listener = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  const flat = tier === 'precise' || prefersReducedMotion

  const resolvedToday = today ?? toDateString(new Date())
  const mobile = useMobileWorkspace()
  const [view, setView] = useState<CalendarViewMode>(initialView)
  useEffect(() => {
    if (mobile) setView('day')
  }, [mobile])
  const [anchorDate, setAnchorDate] = useState<string>(initialAnchorDate ?? resolvedToday)
  /** 右侧当日面板显示的日期（null = 关闭）。 */
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [quickCreate, setQuickCreate] = useState<QuickCreateRequest | null>(null)
  /** 刚建好的任务（显示 5 秒撤销条）。 */
  const [created, setCreated] = useState<CreatedTaskRef[] | null>(null)

  const navigatedFocusRef = useRef<number | null>(null)
  const handleFocusTaskDate = useCallback((taskId: number, date: string) => {
    if (navigatedFocusRef.current === taskId) return
    navigatedFocusRef.current = taskId
    setAnchorDate(date)
  }, [])

  // 非公历主曆：当前主曆月份（农历 / 藏历 / 回历月与公历月不对齐）
  const primaryMonth = useMemo(
    () => (primarySystem === 'solar' ? null : primaryMonthAt(primarySystem, anchorDate)),
    [primarySystem, anchorDate],
  )
  const primaryRange = useMemo(
    () =>
      primaryMonth
        ? {
            title: primaryMonth.title,
            startISO: primaryMonth.startISO,
            endISO: primaryMonth.endISO,
            // 整个网格（含前后补齐格）都按主曆显示日
            dayLabels: new Map(
              rangeGridDays(primaryMonth.startISO, primaryMonth.endISO).map((dateISO) => [
                dateISO,
                primaryDayLabel(primaryMonth.system, dateISO),
              ]),
            ),
          }
        : undefined,
    [primaryMonth],
  )
  // 查询窗口：月 = 整个网格（含首尾补齐周）；周 = 这 7 天；日 = 这一天
  const gridDays = useMemo(() => {
    if (view === 'week') return weekDaysOf(anchorDate)
    if (view === 'day') return [anchorDate]
    return primaryMonth
      ? rangeGridDays(primaryMonth.startISO, primaryMonth.endISO)
      : monthGridDays(anchorDate).days
  }, [view, primaryMonth, anchorDate])

  // 切换月份 / 周 / 日：anchorDate 或窗口变化 → 查询键变化 → TanStack Query 自动重拉
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useSchedule(projectId, {
    view: 'month',
    anchorDate,
    dateFrom: gridDays[0],
    dateTo: gridDays.at(-1),
  })

  const scheduleItems = useMemo(() => data?.data ?? [], [data])
  // 跨项目（「我的日历」）点任务：交给 onOpenItem 带上项目
  const openTask = useMemo(() => {
    if (!onOpenItem) return onOpenTask
    return (taskId: number) => {
      const item = scheduleItems.find((entry) => entry.kind === 'task' && entry.sourceId === taskId)
      if (item) onOpenItem(item)
    }
  }, [onOpenItem, onOpenTask, scheduleItems])
  // 我的个人工作日历（「我的日历」带回）：休假 / 不上班的日子
  const personalCalendar = data?.personalCalendar
  const offLabelOf = useCallback(
    (date: string): string | null => {
      if (!personalCalendar) return null
      const leave = personalLeaveOn(personalCalendar, date)
      if (leave) return leave.note ? `休假：${leave.note}` : '休假'
      return isPersonallyOff(personalCalendar, date) ? '不上班' : null
    },
    [personalCalendar],
  )
  const grid = useMemo(
    () => computeMonthGrid(anchorDate, scheduleItems, resolvedToday, primaryRange),
    [anchorDate, scheduleItems, resolvedToday, primaryRange],
  )

  // 首屏渲染完成度量（一次性）
  const mountAtRef = useRef<number | null>(null)
  const metricFiredRef = useRef(false)
  useEffect(() => {
    if (mountAtRef.current === null) mountAtRef.current = performance.now()
    if (onRenderComplete && !metricFiredRef.current && !isPending && !isError && data) {
      metricFiredRef.current = true
      const cells = grid.weeks.flat()
      const activeElements =
        cells.length + cells.reduce((count, cell) => count + cell.placements.length, 0)
      onRenderComplete({
        durationMs: Math.max(0, Math.round(performance.now() - (mountAtRef.current ?? 0))),
        activeElements,
      })
    }
  }, [onRenderComplete, isPending, isError, data, grid])

  const shift = (delta: number) => {
    setAnchorDate((prev) => {
      if (view === 'week') return shiftAnchorDays(prev, delta * 7)
      if (view === 'day') return shiftAnchorDays(prev, delta)
      return primarySystem === 'solar'
        ? shiftAnchorMonth(prev, delta)
        : primaryMonthAt(primarySystem, prev, delta).startISO
    })
  }
  const handleToday = () => setAnchorDate(resolvedToday)
  const switchView = (next: CalendarViewMode) => {
    // 切到周 / 日：以选中的那天（没有则锚点）为准
    if (next !== 'month' && selectedDate) setAnchorDate(selectedDate)
    setView(next)
  }

  const gestures = useCalendarDayGestures({
    onSelectDay: setSelectedDate,
    onCreate: setQuickCreate,
  })

  const handleCreated = useCallback((tasks: CreatedTaskRef[]) => {
    setQuickCreate(null)
    setCreated(tasks)
  }, [])

  // 本窗口没有排期：照常显示格子，只给一行提示与跳转
  // （切换时 placeholderData 沿用上个窗口数据，占位数据为空不代表本窗口为空）
  const isEmpty =
    !isPending && !isError && !isPlaceholderData && data !== undefined && scheduleItems.length === 0
  const unscheduledCount = data?.meta.unscheduledCount ?? 0
  const nearestScheduled = data?.meta.nearestScheduled
  const jumpTarget = nearestScheduled?.after ?? nearestScheduled?.before ?? null
  const workingCalendar = data?.workingCalendar
  const dayMetaContext = useMemo(
    () => ({
      workingCalendar,
      changeFreezeWindows: workingCalendar?.changeFreezeWindows ?? [],
    }),
    [workingCalendar],
  )

  const title = useMemo(() => {
    if (view === 'month') return grid.monthTitle
    const [y, m, d] = gridDays[0]!.split('-').map(Number)
    if (view === 'day')
      return `${y}年${m}月${d}日 · 周${WEEKDAY_LABELS[weekdayIndex(gridDays[0]!)]}`
    const [y2, m2, d2] = gridDays.at(-1)!.split('-').map(Number)
    return y === y2
      ? `${y}年${m}月${d}日 – ${m2 === m ? '' : `${m2}月`}${d2}日`
      : `${y}年${m}月${d}日 – ${y2}年${m2}月${d2}日`
  }, [view, grid.monthTitle, gridDays])
  const labels = VIEW_LABELS[view]
  const emptyLabel = view === 'month' ? '本月' : view === 'week' ? '这周' : '这天'
  // 日视图本身就是「一天」，不再开侧栏
  const panelDate = view === 'day' ? null : selectedDate

  return (
    <CalendarDayMetaProvider value={dayMetaContext}>
      <div
        data-calendar-lens
        data-immersion={tier}
        data-calendar-view={view}
        className={cn(
          'relative flex h-full min-h-[600px] flex-col rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)]',
          className,
        )}
      >
        {/* 导航工具栏 */}
        <div
          data-calendar-toolbar
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2"
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              data-calendar-prev
              aria-label={labels.prev}
              onClick={() => shift(-1)}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)]"
            >
              ‹ {labels.prev}
            </button>
            <button
              type="button"
              data-calendar-today-btn
              aria-label="返回今天"
              onClick={handleToday}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)]"
            >
              今天
            </button>
          </div>
          <div className="flex min-w-0 flex-col items-center">
            <h2
              data-calendar-month-title
              className="truncate text-base font-semibold text-[var(--nx-text-primary)]"
            >
              {title}
            </h2>
            {primaryMonth && view === 'month' ? (
              <span
                data-calendar-solar-span
                className="truncate text-[11px] text-[var(--nx-text-muted)]"
              >
                {solarSpanLabel(primaryMonth)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <div
              role="radiogroup"
              aria-label="日历视图"
              data-calendar-view-switch
              className="flex overflow-hidden rounded-md border border-[var(--nx-border-hairline)]"
            >
              {(['month', 'week', 'day'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={view === mode}
                  data-calendar-view-option={mode}
                  onClick={() => switchView(mode)}
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    view === mode
                      ? 'bg-[var(--nx-space-cyan)]/15 text-[var(--nx-space-cyan)]'
                      : 'bg-[var(--nx-workspace-surface)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]',
                  )}
                >
                  {VIEW_LABELS[mode].title}
                </button>
              ))}
            </div>
            <button
              type="button"
              data-calendar-next
              aria-label={labels.next}
              onClick={() => shift(1)}
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-2 py-1 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-space-cyan)]"
            >
              {labels.next} ›
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="min-w-0 flex-1 overflow-auto p-3">
            {isPending || data === undefined ? (
              <CalendarGridSkeleton flat={flat} />
            ) : isError ? (
              <div
                data-calendar-error
                role="alert"
                className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-6 text-center"
              >
                <p className="text-sm font-medium text-[var(--nx-status-danger)]">
                  日历排程加载失败
                </p>
                <p className="max-w-md text-xs text-[var(--nx-text-muted)]">
                  {error instanceof Error ? error.message : '请检查网络连接后重试'}
                </p>
                <button
                  type="button"
                  data-calendar-retry
                  onClick={() => {
                    void refetch()
                  }}
                  className="mt-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-1.5 text-xs text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-space-cyan)] hover:text-[var(--nx-space-cyan)]"
                >
                  重新载入
                </button>
              </div>
            ) : (
              <>
                {isEmpty ? (
                  <div
                    data-calendar-empty
                    role="status"
                    className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2 text-xs text-[var(--nx-text-secondary)]"
                  >
                    <span className="flex items-center gap-1.5">
                      <CalendarDays
                        className="h-3.5 w-3.5 text-[var(--nx-text-muted)]"
                        aria-hidden
                      />
                      {emptyLabel}没有任务排期
                      {unscheduledCount > 0 ? (
                        <span className="text-[var(--nx-text-muted)]">
                          （另有 {unscheduledCount} 项任务未排定起止日期）
                        </span>
                      ) : null}
                      <span className="text-[var(--nx-text-muted)]">· 双击格子就能新建</span>
                    </span>
                    {jumpTarget ? (
                      <button
                        type="button"
                        data-calendar-jump-nearest
                        data-target-date={jumpTarget}
                        onClick={() => setAnchorDate(jumpTarget)}
                        className="rounded-md border border-[var(--nx-border-hairline)] px-2 py-0.5 text-xs text-[var(--nx-space-cyan)] transition-colors hover:border-[var(--nx-space-cyan)]"
                      >
                        跳到最近有任务的{view === 'month' ? '月份' : '日期'}（{jumpTarget}）
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {view === 'month' ? (
                  <div
                    data-calendar-month-grid
                    aria-label="项目日历月视图"
                    className={cn(
                      'min-w-[560px] overflow-hidden rounded-lg border border-[var(--nx-border-hairline)]',
                      gestures.dragging && 'select-none',
                    )}
                  >
                    {/* 周一至周日表头 */}
                    <div className="grid grid-cols-7 border-b border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]">
                      {WEEKDAY_LABELS.map((label) => (
                        <div
                          key={label}
                          data-calendar-weekday
                          aria-label={`周${label}`}
                          className="border-r py-1.5 text-center text-xs text-[var(--nx-text-muted)] last:border-r-0"
                        >
                          {label}
                        </div>
                      ))}
                    </div>
                    {grid.weeks.map((week, weekIndex) => (
                      <div
                        key={week[0]?.dateString ?? weekIndex}
                        data-calendar-week
                        className="grid grid-cols-7"
                      >
                        {week.map((cell, colIndex) => (
                          <DayCellView
                            key={cell.dateString}
                            cell={cell}
                            isFirstCol={colIndex === 0}
                            isLastCol={colIndex === 6}
                            isLastRow={weekIndex === grid.weeks.length - 1}
                            flat={flat}
                            onOpenDay={setSelectedDate}
                            onOpenTask={openTask}
                            focusTaskId={focusTaskId}
                            secondarySystems={secondarySystems}
                            dayProps={gestures.dayProps(cell.dateString)}
                            selected={selectedDate === cell.dateString}
                            inDrag={gestures.inDragRange(cell.dateString)}
                            onCreate={setQuickCreate}
                            offLabel={offLabelOf(cell.dateString)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <CalendarColumnsView
                    days={gridDays}
                    items={scheduleItems}
                    today={resolvedToday}
                    primarySystem={primarySystem}
                    secondarySystems={secondarySystems}
                    selectedDate={selectedDate}
                    onOpenTask={openTask}
                    focusTaskId={focusTaskId}
                    dayProps={gestures.dayProps}
                    inDragRange={gestures.inDragRange}
                    onCreate={setQuickCreate}
                    offLabelOf={offLabelOf}
                  />
                )}
                {unscheduledCount > 0 && !isEmpty ? (
                  <p
                    data-calendar-unscheduled-hint
                    className="mt-2 text-center text-[10px] text-[var(--nx-text-muted)]"
                  >
                    另有 {unscheduledCount} 项任务未排定起止日期，未纳入日历
                  </p>
                ) : null}
              </>
            )}
          </div>

          {panelDate ? (
            <CalendarDayPanel
              date={panelDate}
              items={scheduleItems}
              primarySystem={primarySystem}
              calendarSystems={calendarSystems}
              onClose={() => setSelectedDate(null)}
              onOpenTask={openTask}
              onCreate={(anchor) => setQuickCreate({ startDate: panelDate, endDate: null, anchor })}
              offLabel={offLabelOf(panelDate)}
            />
          ) : null}
        </div>

        {created ? (
          <CalendarUndoBar
            key={created.map((task) => task.id).join(',')}
            tasks={created}
            onDone={() => setCreated(null)}
          />
        ) : null}

        {quickCreate ? (
          <CalendarQuickCreate
            key={`${quickCreate.startDate}:${quickCreate.endDate ?? ''}`}
            projectId={projectId}
            projectChoices={data?.projects}
            startDate={quickCreate.startDate}
            endDate={quickCreate.endDate}
            anchor={quickCreate.anchor}
            onClose={() => setQuickCreate(null)}
            onCreated={handleCreated}
          />
        ) : null}

        {projectId !== null && focusTaskId && focusTaskId > 0 ? (
          <FocusTaskNavigator
            projectId={projectId}
            taskId={focusTaskId}
            onTaskDate={handleFocusTaskDate}
          />
        ) : null}
      </div>
    </CalendarDayMetaProvider>
  )
}

/** 日历时间切面镜头别名（design「亦可别名 CalendarLens」）。 */
export const CalendarLens = WorkspaceCalendarLens

export default WorkspaceCalendarLens
