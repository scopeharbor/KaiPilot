'use client'

import type React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarItem } from '@/lib/calendar-types'
import type { DayPlacement } from '@/lib/calendar-layout'

const PRIORITY_COLORS: Record<string, string> = {
  highest: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  lowest: 'bg-gray-400',
}

const STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  planned: '计划中',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  on_hold: '已挂起',
  cancelled: '已取消',
  achieved: '已达成',
  missed: '已错过',
  at_risk: '有风险',
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

interface CalendarItemChipProps {
  placement: DayPlacement
  /** 该 chip 所在的日期格（拖拽抓取日） */
  day: string
  /** 是否允许对该项改期（已按 kind + 权限判定） */
  canReschedule: boolean
  onOpen: (item: CalendarItem) => void
}

/**
 * schedule 模式统一日历项 chip：任务区间段或里程碑标记。
 * 跨日区间在续接日显示左侧续接标识；逾期用文字标签（非仅颜色）。
 */
export function CalendarItemChip({ placement, day, canReschedule, onOpen }: CalendarItemChipProps) {
  const { item, isStart, isEnd, isContinuation } = placement
  const isMilestone = item.kind === 'milestone'

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `sched-${item.id}-${day}`,
    data: { item, grabbedDate: day },
    disabled: !canReschedule,
  })

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined

  // 组合键盘处理：Enter 打开详情；其余（Space 起拖、方向键移动）交回 dnd-kit KeyboardSensor。
  const { onKeyDown: dndKeyDown, ...pointerListeners } = listeners ?? {}
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onOpen(item)
      return
    }
    if (canReschedule) (dndKeyDown as ((ev: React.KeyboardEvent) => void) | undefined)?.(e)
  }

  const overdueSuffix = item.isOverdue ? '，逾期' : ''
  const kindLabel = isMilestone ? '里程碑' : '任务'
  const ariaLabel = `${kindLabel}：${item.name}，状态：${statusLabel(item.status)}${overdueSuffix}${canReschedule ? '，可拖拽或按空格键改期，回车打开详情' : '，按回车打开详情'}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canReschedule ? { ...attributes, ...pointerListeners } : {})}
      className={cn(
        'group flex items-center gap-1 px-1 py-0.5 text-[11px] leading-tight cursor-pointer truncate',
        'hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isMilestone ? 'rounded-sm bg-primary/10' : 'rounded',
        // 跨日区间：非起点左直角、非终点右直角，视觉上连成一条
        !isMilestone && !isStart && 'rounded-l-none',
        !isMilestone && !isEnd && 'rounded-r-none',
        item.isOverdue && 'ring-1 ring-red-300',
        isDragging && 'opacity-50 ring-2 ring-primary z-50',
        canReschedule && 'cursor-grab active:cursor-grabbing',
      )}
      onClick={() => onOpen(item)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
    >
      {isContinuation && (
        <span className="text-muted-foreground shrink-0" aria-hidden>
          ◀
        </span>
      )}
      {isMilestone ? (
        <Flag className="h-3 w-3 shrink-0 text-primary" aria-hidden />
      ) : (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full shrink-0',
            PRIORITY_COLORS[item.priority ?? ''] ?? 'bg-gray-400',
          )}
          aria-hidden
        />
      )}
      <span className="truncate">{item.name}</span>
      {item.isOverdue && <span className="text-[9px] text-red-600 font-medium shrink-0">逾期</span>}
    </div>
  )
}
