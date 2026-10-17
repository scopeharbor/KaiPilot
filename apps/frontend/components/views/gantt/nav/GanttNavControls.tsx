'use client'

import { useMemo } from 'react'
import { CalendarClock, ChevronFirst, ChevronLast, Crosshair, Flag, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GanttModel } from '@/lib/gantt/types'

interface GanttNavControlsProps {
  model: GanttModel
  todayDay: number
  selectedTaskId: number | null
  onScrollToDay: (day: number) => void
  onScrollToTask: (taskId: number) => void
}

const BTN =
  'inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-gray-0 px-2 py-1 text-xs text-foreground transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * 甘特大型项目导航（task 4.2 / design D5）：跳转到今天、项目起止、选中任务、关键路径首尾。
 * **只改视口**，绝不修改任何排程数据。关键路径端点由模型的 `isCritical` / `isOnLongestPath` 派生。
 */
export function GanttNavControls({
  model,
  todayDay,
  selectedTaskId,
  onScrollToDay,
  onScrollToTask,
}: GanttNavControlsProps) {
  const critical = useMemo(() => {
    const tasks = model.tasks.filter((t) => t.isCritical || t.isOnLongestPath)
    const first = tasks[0]
    if (!first) return null
    let start = first
    let end = first
    for (const t of tasks) {
      if (t.startDay < start.startDay) start = t
      if (t.startDay + Math.max(0, t.durationDays) > end.startDay + Math.max(0, end.durationDays))
        end = t
    }
    return { startId: start.id, endId: end.id }
  }, [model.tasks])

  return (
    <div className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="甘特导航">
      <button
        type="button"
        className={BTN}
        onClick={() => onScrollToDay(todayDay)}
        aria-label="定位到今天"
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        今天
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => onScrollToDay(model.timeRange.startDay)}
        aria-label="定位到项目开始"
      >
        <ChevronFirst className="h-3.5 w-3.5" aria-hidden />
        项目开始
      </button>
      <button
        type="button"
        className={BTN}
        onClick={() => onScrollToDay(model.timeRange.endDay)}
        aria-label="定位到项目结束"
      >
        <ChevronLast className="h-3.5 w-3.5" aria-hidden />
        项目结束
      </button>
      <button
        type="button"
        className={cn(BTN)}
        disabled={selectedTaskId === null}
        onClick={() => selectedTaskId !== null && onScrollToTask(selectedTaskId)}
        aria-label="定位到选中任务"
        title={selectedTaskId === null ? '先选中一个任务' : undefined}
      >
        <Crosshair className="h-3.5 w-3.5" aria-hidden />
        选中任务
      </button>
      <button
        type="button"
        className={BTN}
        disabled={!critical}
        onClick={() => critical && onScrollToTask(critical.startId)}
        aria-label="定位到关键路径起点"
        title={critical ? undefined : '当前无关键路径'}
      >
        <Flag className="h-3.5 w-3.5" aria-hidden />
        关键路径起点
      </button>
      <button
        type="button"
        className={BTN}
        disabled={!critical}
        onClick={() => critical && onScrollToTask(critical.endId)}
        aria-label="定位到关键路径终点"
        title={critical ? undefined : '当前无关键路径'}
      >
        <Target className="h-3.5 w-3.5" aria-hidden />
        关键路径终点
      </button>
    </div>
  )
}

export default GanttNavControls
