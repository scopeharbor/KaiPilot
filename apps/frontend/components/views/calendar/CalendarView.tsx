'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import { useProjectCalendar } from '@/hooks/use-calendar'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { tasksApi } from '@/lib/api/tasks'
import { shiftCalendarAnchor } from '@/lib/calendar-state'
import type { CalendarFilters, CalendarView as CalendarViewType } from '@/lib/api/calendar'
import type { Task } from '@/lib/api/tasks'
import type { CalendarFullResponse } from '@/lib/calendar-types'
import { CalendarDayMetaProvider } from './CalendarDayMeta'
import { CalendarToolbar } from './CalendarToolbar'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
import { DayView } from './DayView'
import { ScheduleCalendar } from './schedule/ScheduleCalendar'
import { TaskDetailDrawer } from '@/components/views/tasks/TaskDetailDrawer'
import { Skeleton } from '@/components/ui/Skeleton'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { CalendarDays } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { usePermissions } from '@/hooks/use-permissions'
import { Switch } from '@/components/ui/Switch'
import { Label } from '@/components/ui/Label'

interface CalendarViewProps {
  projectId: number
  filters: CalendarFilters
  onFiltersChange: (patch: Partial<CalendarFilters>) => void
}

/**
 * 项目 Calendar 视图。
 *
 * 顶部工具栏（导航 + 视图切换 + 筛选）与模式开关对两种模式共享；
 * 主体按模式分流：截止日模式（V1 兼容）与完整排程模式（V2）。
 */
export function CalendarView({ projectId, filters, onFiltersChange }: CalendarViewProps) {
  const isScheduleMode = filters.mode === 'schedule'

  const handleViewChange = (view: CalendarViewType) => onFiltersChange({ view })
  const handleToday = () => onFiltersChange({ anchorDate: DateTime.now().toISODate()! })
  const handlePrev = () =>
    onFiltersChange({ anchorDate: shiftCalendarAnchor(filters.anchorDate, filters.view, -1) })
  const handleNext = () =>
    onFiltersChange({ anchorDate: shiftCalendarAnchor(filters.anchorDate, filters.view, 1) })
  const handleModeToggle = (schedule: boolean) =>
    onFiltersChange({ mode: schedule ? 'schedule' : undefined })

  return (
    <div className="space-y-4">
      {/* 模式切换 */}
      <div className="flex items-center gap-2">
        <Label htmlFor="cal-mode" className="text-sm text-muted-foreground">
          截止日
        </Label>
        <Switch
          id="cal-mode"
          checked={isScheduleMode}
          onCheckedChange={handleModeToggle}
          aria-label={isScheduleMode ? '切换到截止日模式' : '切换到完整排程模式'}
        />
        <Label htmlFor="cal-mode" className="text-sm text-muted-foreground">
          排程
        </Label>
      </div>

      <CalendarToolbar
        view={filters.view}
        anchorDate={filters.anchorDate}
        search={filters.search}
        status={filters.status}
        priority={filters.priority}
        assigneeId={filters.assigneeId}
        onViewChange={handleViewChange}
        onToday={handleToday}
        onPrev={handlePrev}
        onNext={handleNext}
        onSearchChange={(search) => onFiltersChange({ search: search || undefined })}
        onStatusChange={(status) => onFiltersChange({ status: status || undefined })}
        onPriorityChange={(priority) => onFiltersChange({ priority: priority || undefined })}
        onAssigneeChange={(assigneeId) => onFiltersChange({ assigneeId: assigneeId || undefined })}
      />

      {isScheduleMode ? (
        <ScheduleCalendar
          projectId={projectId}
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
      ) : (
        <DeadlineCalendarBody
          projectId={projectId}
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
      )}
    </div>
  )
}

/**
 * 截止日模式主体（V1 兼容）：按任务 end_date 落点显示，支持拖拽调整截止日。
 */
function DeadlineCalendarBody({ projectId, filters, onFiltersChange }: CalendarViewProps) {
  const queryClient = useQueryClient()
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const currentUserId = useAuthStore((s) => s.user?.id)
  const { can } = usePermissions()
  const canUpdate = can('task:update') || can('task:update:self')

  const { data, isLoading, error, refetch, isPlaceholderData } = useProjectCalendar(
    projectId,
    filters,
  )

  const tasks = useMemo(() => (data as { data?: Task[] })?.data ?? [], [data])
  const workingCalendar = (data as CalendarFullResponse | undefined)?.workingCalendar
  const dayMetaContext = useMemo(
    () => ({
      workingCalendar,
      changeFreezeWindows: workingCalendar?.changeFreezeWindows ?? [],
    }),
    [workingCalendar],
  )

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) {
      if (!task.endDate) continue
      const dateKey = task.endDate.slice(0, 10)
      const list = map.get(dateKey) ?? []
      list.push(task)
      map.set(dateKey, list)
    }
    return map
  }, [tasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
  )

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveTask(null)
      if (!over) return

      const task = active.data.current?.task as Task | undefined
      if (!task) return

      const targetDate = over.data.current?.date as string | undefined
      if (!targetDate || targetDate === task.endDate?.slice(0, 10)) return

      setRescheduleError(null)
      try {
        await tasksApi.update(projectId, task.id, { endDate: targetDate })
        await invalidateTaskQueries(queryClient, projectId)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '改期失败，请重试'
        setRescheduleError(msg)
      }
    },
    [projectId, queryClient],
  )

  const handleDragStart = useCallback(
    (event: { active: { data: { current?: { task?: Task } } } }) => {
      setActiveTask(event.active.data.current?.task ?? null)
    },
    [],
  )

  const handleDateClick = (date: string) => onFiltersChange({ view: 'day', anchorDate: date })
  const handleTaskClick = (taskId: number) => setSelectedTaskId(taskId)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="danger" className="my-8">
        <div className="flex items-center justify-between">
          <span>加载日历数据失败：{(error as Error).message}</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            重试
          </Button>
        </div>
      </Alert>
    )
  }

  const hasAnyTask = tasks.length > 0

  return (
    <div className="space-y-4">
      {rescheduleError && <Alert variant="danger">{rescheduleError}</Alert>}

      {/* 切月时沿用的上个月占位数据为空，不代表本月为空 */}
      {!hasAnyTask && !isPlaceholderData && (
        <EmptyState
          icon={CalendarDays}
          title="项目暂无截止日任务"
          description="为任务设置截止日期后，将在此日历中显示。"
        />
      )}

      <CalendarDayMetaProvider value={dayMetaContext}>
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          {filters.view === 'month' && (
            <MonthView
              tasksByDate={tasksByDate}
              anchorDate={filters.anchorDate}
              canUpdate={canUpdate}
              currentUserId={currentUserId}
              onDateClick={handleDateClick}
              onTaskClick={(id) => handleTaskClick(Number(id))}
            />
          )}
          {filters.view === 'week' && (
            <WeekView
              tasksByDate={tasksByDate}
              anchorDate={filters.anchorDate}
              canUpdate={canUpdate}
              currentUserId={currentUserId}
              onDateClick={handleDateClick}
              onTaskClick={(id) => handleTaskClick(Number(id))}
            />
          )}
          {filters.view === 'day' && (
            <DayView
              tasks={tasksByDate.get(filters.anchorDate) ?? []}
              date={filters.anchorDate}
              canUpdate={canUpdate}
              currentUserId={currentUserId}
              onTaskClick={(id) => handleTaskClick(Number(id))}
            />
          )}

          <DragOverlay>
            {activeTask && (
              <div className="rounded px-2 py-1 text-xs bg-primary text-primary-foreground shadow-lg">
                {activeTask.name}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </CalendarDayMetaProvider>

      <TaskDetailDrawer
        projectId={projectId}
        taskId={selectedTaskId}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
      />
    </div>
  )
}
