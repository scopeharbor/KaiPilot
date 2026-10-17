'use client'

import { memo } from 'react'
import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { statusVar } from '@/lib/gantt/palette'
import { isAgentAssignee } from '@/types/agent-assignee'
import type { GanttRenderTask } from '@/lib/gantt/types'

interface GanttLeftColumnProps {
  tasks: GanttRenderTask[]
  visibleRows: { index: number; start: number }[]
  rowHeight: number
  totalHeight: number
  showWbsCode: boolean
  showAssigneeAvatar: boolean
  hoveredTaskId: number | null
  selectedTaskId: number | null
  onHover: (id: number | null) => void
  onSelect: (id: number) => void
}

/**
 * 冻结左栏（task 3.2）：按层级缩进的任务名 + 可选 WBS 编号 + 可选负责人首字母。
 * 与图表体共享虚拟化窗口，横向滚动时由父容器冻结（不随图表平移），纵向由父容器按 -scrollTop 平移。
 */
export const GanttLeftColumn = memo(function GanttLeftColumn({
  tasks,
  visibleRows,
  rowHeight,
  totalHeight,
  showWbsCode,
  showAssigneeAvatar,
  hoveredTaskId,
  selectedTaskId,
  onHover,
  onSelect,
}: GanttLeftColumnProps) {
  return (
    <div className="relative" role="tree" aria-label="任务列表" style={{ height: totalHeight }}>
      {visibleRows.map(({ index, start }) => {
        const task = tasks[index]
        if (!task) return null
        const active = task.id === hoveredTaskId || task.id === selectedTaskId
        const isAgent = isAgentAssignee(task.assignee?.assigneeType)
        const ariaLabel = `${task.name}，${TASK_STATUS_LABELS[task.status]}${
          showWbsCode && task.wbsCode ? `，编号 ${task.wbsCode}` : ''
        }${isAgent ? '，AI 负责人：待确认方案' : ''}`
        return (
          <div
            key={task.id}
            role="treeitem"
            tabIndex={0}
            aria-level={task.depth + 1}
            aria-selected={task.id === selectedTaskId}
            aria-label={ariaLabel}
            className={cn(
              'absolute inset-x-0 flex items-center gap-2 border-b border-border px-3 text-sm',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
              active ? 'bg-primary-50' : 'bg-transparent',
            )}
            style={{ top: start, height: rowHeight, paddingLeft: 12 + task.depth * 12 }}
            onMouseEnter={() => onHover(task.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(task.id)}
            onClick={() => onSelect(task.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(task.id)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                const next = tasks[index + 1]
                if (next) onSelect(next.id)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                const prev = tasks[index - 1]
                if (prev) onSelect(prev.id)
              }
            }}
          >
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: statusVar(task.status) }}
            />
            {showWbsCode ? (
              <span className="shrink-0 font-mono text-[11px] text-muted">{task.wbsCode}</span>
            ) : null}
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                task.kind === 'summary' ? 'font-semibold text-heading' : 'text-foreground',
              )}
              title={task.name}
            >
              {task.name}
            </span>
            {showAssigneeAvatar && task.assignee ? (
              isAgent ? (
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ai-bg text-ai"
                  title={`AI 负责人：${task.assignee.name}`}
                  aria-label={`AI 负责人：${task.assignee.name}`}
                >
                  <Bot className="h-3 w-3" aria-hidden />
                </span>
              ) : (
                <span
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-100 text-[10px] font-medium text-primary-700"
                  title={task.assignee.name}
                >
                  {task.assignee.initials}
                </span>
              )
            ) : null}
          </div>
        )
      })}
    </div>
  )
})
