'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { useProjectCalendarSchedule } from '@/hooks/use-calendar'
import { tasksApi } from '@/lib/api/tasks'
import { milestonesApi } from '@/lib/api/milestones'
import { invalidateTaskQueries, invalidateMilestoneQueries } from '@/lib/task-query-invalidation'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import type { CalendarFilters } from '@/lib/api/calendar'
import type { CalendarItem } from '@/lib/calendar-types'
import { computeReschedulePatch } from '@/lib/calendar-reschedule'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { CalendarDayMetaProvider } from '../CalendarDayMeta'
import { Skeleton } from '@/components/ui/Skeleton'
import { TaskDetailDrawer } from '@/components/views/tasks/TaskDetailDrawer'
import { CalendarDays } from 'lucide-react'
import { ScheduleMonthView } from './ScheduleMonthView'
import { ScheduleWeekView } from './ScheduleWeekView'
import { ScheduleDayView } from './ScheduleDayView'
import { UnscheduledPanel } from '../UnscheduledPanel'
import { MilestoneDetailDialog } from './MilestoneDetailDialog'

interface ScheduleCalendarProps {
  projectId: number
  filters: CalendarFilters
  onFiltersChange: (patch: Partial<CalendarFilters>) => void
}

type OptimisticMap = Record<string, { start: string | null; end: string | null }>

const ITEM_TYPE_TABS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: '全部' },
  { value: 'task', label: '任务' },
  { value: 'milestone', label: '里程碑' },
]

/**
 * Calendar 完整（schedule）模式容器。
 * 消费派生日历项，渲染区间/里程碑，接入拖拽与键盘等价改期（乐观预览 + 失败回滚）。
 * 所有写入复用正式任务/里程碑更新链路与统一缓存失效。
 */
export function ScheduleCalendar({ projectId, filters, onFiltersChange }: ScheduleCalendarProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const currentUserId = useAuthStore((s) => s.user?.id)

  const canUpdateTask = can('task:update')
  const canUpdateTaskSelf = can('task:update:self')
  const canUpdateMilestone = can('milestone:update')

  const [optimistic, setOptimistic] = useState<OptimisticMap>({})
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [activeItem, setActiveItem] = useState<CalendarItem | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedMilestone, setSelectedMilestone] = useState<CalendarItem | null>(null)

  const { data, isLoading, error, refetch, isPlaceholderData } = useProjectCalendarSchedule(
    projectId,
    filters,
  )

  const rawItems = useMemo<CalendarItem[]>(() => data?.data ?? [], [data])
  const meta = data?.meta
  const workingCalendar = data?.workingCalendar
  const dayMetaContext = useMemo(
    () => ({
      workingCalendar,
      changeFreezeWindows: workingCalendar?.changeFreezeWindows ?? [],
    }),
    [workingCalendar],
  )

  // 合并乐观改期预览
  const items = useMemo(() => {
    if (Object.keys(optimistic).length === 0) return rawItems
    return rawItems.map((it) => {
      const o = optimistic[it.id]
      if (!o) return it
      const start = o.start
      const end = o.end
      return {
        ...it,
        dateRange: {
          ...it.dateRange,
          start,
          end,
          isSpan: !!(start && end && start !== end),
          missingStart: !start && !!end,
          missingEnd: !!start && !end,
        },
      }
    })
  }, [rawItems, optimistic])

  const canRescheduleItem = useCallback(
    (item: CalendarItem): boolean => {
      if (item.kind === 'milestone') return canUpdateMilestone
      if (canUpdateTask) return true
      if (canUpdateTaskSelf && item.assignee?.id === currentUserId) return true
      return false
    },
    [canUpdateTask, canUpdateTaskSelf, canUpdateMilestone, currentUserId],
  )

  const anyWriteAllowed = canUpdateTask || canUpdateTaskSelf || canUpdateMilestone

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
    // Space 起拖、方向键移动、Space 落下（Enter 保留给打开详情）
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  const handleDragStart = useCallback(
    (event: { active: { data: { current?: { item?: CalendarItem } } } }) => {
      setActiveItem(event.active.data.current?.item ?? null)
    },
    [],
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveItem(null)
      if (!over) return

      const item = active.data.current?.item as CalendarItem | undefined
      const grabbedDate = active.data.current?.grabbedDate as string | undefined
      const targetDate = over.data.current?.date as string | undefined
      if (!item || !grabbedDate || !targetDate) return
      if (!canRescheduleItem(item)) return

      const patch = computeReschedulePatch(item, grabbedDate, targetDate)
      if (!patch) return

      setRescheduleError(null)
      // 乐观预览
      setOptimistic((prev) => ({ ...prev, [item.id]: patch.optimistic }))

      try {
        if (patch.kind === 'task') {
          await tasksApi.update(projectId, patch.taskId, patch.patch)
          await invalidateTaskQueries(queryClient, projectId)
        } else {
          await milestonesApi.update(patch.milestoneId, patch.patch)
          await invalidateMilestoneQueries(queryClient, projectId)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '改期失败，请重试'
        setRescheduleError(msg)
      } finally {
        // 无论成功失败都清除本地预览：成功时以刷新后的真实数据为准，失败时回滚到原区间
        setOptimistic((prev) => {
          const next = { ...prev }
          delete next[item.id]
          return next
        })
      }
    },
    [projectId, queryClient, canRescheduleItem],
  )

  const handleOpenItem = useCallback((item: CalendarItem) => {
    if (item.kind === 'milestone') setSelectedMilestone(item)
    else setSelectedTaskId(item.sourceId)
  }, [])

  const handleDateClick = (date: string) => onFiltersChange({ view: 'day', anchorDate: date })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="danger" className="my-8">
        <div className="flex items-center justify-between gap-4">
          <span>加载排程日历失败：{(error as Error).message}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            aria-label="重试加载排程日历"
          >
            重试
          </Button>
        </div>
      </Alert>
    )
  }

  // 切月时沿用的上个月占位数据为空，不代表本月为空
  const isEmpty = !isPlaceholderData && items.length === 0 && (meta?.unscheduledCount ?? 0) === 0

  return (
    <CalendarDayMetaProvider value={dayMetaContext}>
      <div className="space-y-3">
        {rescheduleError && (
          <Alert variant="danger" role="alert">
            {rescheduleError}
          </Alert>
        )}

        {!anyWriteAllowed && (
          <p className="text-xs text-muted-foreground" role="note">
            你没有改期权限，可查看排程与详情，但不能拖拽调整日期。
          </p>
        )}

        {/* item 类型筛选 */}
        <div className="flex items-center gap-1" role="group" aria-label="按日历项类型筛选">
          {ITEM_TYPE_TABS.map((tab) => {
            const active = (filters.itemTypes ?? undefined) === tab.value
            return (
              <Button
                key={tab.label}
                variant={active ? 'primary' : 'outline'}
                size="sm"
                onClick={() => onFiltersChange({ itemTypes: tab.value })}
                aria-pressed={active}
              >
                {tab.label}
              </Button>
            )
          })}
        </div>

        {meta?.truncated && (
          <Alert role="status">
            结果较多，仅显示当前页。请缩小日期窗口或使用筛选查看更多排程项。
          </Alert>
        )}

        <UnscheduledPanel count={meta?.unscheduledCount ?? 0} projectId={projectId} />

        {isEmpty && (
          <EmptyState
            icon={CalendarDays}
            title="当前窗口没有排程项"
            description="为任务设置开始/结束日期或为里程碑设置目标日期后，将在此显示。"
          />
        )}

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {filters.view === 'month' && (
            <ScheduleMonthView
              items={items}
              anchorDate={filters.anchorDate}
              workingCalendar={workingCalendar}
              canRescheduleItem={canRescheduleItem}
              onDateClick={handleDateClick}
              onOpenItem={handleOpenItem}
            />
          )}
          {filters.view === 'week' && (
            <ScheduleWeekView
              items={items}
              anchorDate={filters.anchorDate}
              workingCalendar={workingCalendar}
              canRescheduleItem={canRescheduleItem}
              onDateClick={handleDateClick}
              onOpenItem={handleOpenItem}
            />
          )}
          {filters.view === 'day' && (
            <ScheduleDayView
              items={items}
              date={filters.anchorDate}
              workingCalendar={workingCalendar}
              onOpenItem={handleOpenItem}
            />
          )}

          <DragOverlay>
            {activeItem && (
              <div className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground shadow-lg">
                {activeItem.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <TaskDetailDrawer
          projectId={projectId}
          taskId={selectedTaskId}
          onOpenChange={(open) => !open && setSelectedTaskId(null)}
        />
        <MilestoneDetailDialog
          milestone={selectedMilestone}
          onOpenChange={(open) => !open && setSelectedMilestone(null)}
        />
      </div>
    </CalendarDayMetaProvider>
  )
}
