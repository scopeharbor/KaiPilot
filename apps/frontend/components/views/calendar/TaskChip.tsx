'use client'

import { useDraggable } from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/api/tasks'

interface TaskChipProps {
  task: Task
  isOverdue: boolean
  canUpdate: boolean
  onClick: () => void
}

const PRIORITY_COLORS: Record<string, string> = {
  highest: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  lowest: 'bg-gray-400',
}

export function TaskChip({ task, isOverdue, canUpdate, onClick }: TaskChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `cal-task-${task.id}`,
    data: { task },
    disabled: !canUpdate,
  })

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canUpdate ? { ...attributes, ...listeners } : {})}
      className={cn(
        'group flex items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight cursor-pointer truncate',
        'hover:bg-accent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isDragging && 'opacity-50 ring-2 ring-primary z-50',
        canUpdate && 'cursor-grab active:cursor-grabbing',
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
      role="button"
      tabIndex={0}
      aria-label={`${task.name}${isOverdue ? '（逾期）' : ''}`}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full shrink-0',
          PRIORITY_COLORS[task.priority] ?? 'bg-gray-400',
        )}
      />
      <span className="truncate">{task.name}</span>
      {isOverdue && (
        <span className="text-[9px] text-red-600 font-medium shrink-0" aria-label="逾期">
          逾期
        </span>
      )}
    </div>
  )
}
