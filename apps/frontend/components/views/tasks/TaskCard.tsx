'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bot, CalendarDays, CircleUserRound, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { CopilotInlineTrigger } from '@/components/copilot/CopilotInlineTrigger'
import { useCopilotStore } from '@/stores/copilot-store'
import type { KanbanColumn } from '@/lib/api/kanban'
import type { Task, TaskPriority, TaskStatus } from '@/lib/api/tasks'
import { canTransition, TASK_STATUS_LABELS } from '@/lib/task-status'
import { isAgentAssignee, AGENT_ACTION_LABEL } from '@/types/agent-assignee'
import { cn } from '@/lib/utils'

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

const PRIORITY_VARIANTS: Record<TaskPriority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  lowest: 'neutral',
  low: 'info',
  medium: 'neutral',
  high: 'warning',
  highest: 'danger',
}

export interface TaskCardProps {
  task: Task
  variant?: 'kanban' | 'compact'
  disabled?: boolean
  onOpen?: (taskId: number) => void
  onMove?: (task: Task, column: KanbanColumn, targetStatus?: TaskStatus) => void
}

export function TaskCard({ task, variant = 'kanban', disabled, onOpen, onMove }: TaskCardProps) {
  const sortable = useSortable({
    id: `task-${task.id}`,
    disabled,
    data: { type: 'task', task, column: columnForTask(task) },
  })

  const isAgent = isAgentAssignee(task.assigneeType)

  return (
    <article
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(
        'group rounded-[var(--radius-md)] border border-border bg-gray-0 shadow-[var(--shadow-xs)]',
        'transition-[border-color,box-shadow,opacity] hover:border-primary-200 hover:shadow-[var(--shadow-sm)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        'motion-reduce:transition-none',
        // 整卡即拖动手柄（Trello 式）：无位移=点击打开、位移≥6px=拖动（PointerSensor 激活阈值）。
        !disabled && 'cursor-grab touch-none active:cursor-grabbing',
        sortable.isDragging && 'z-10 cursor-grabbing opacity-60 shadow-[var(--shadow-lg)]',
        variant === 'compact' ? 'p-3' : 'p-4',
        // v3-copilot-agent-as-assignee：agent 负责任务的虚线边框 + 浅 AI 底纹
        isAgent && 'border-dashed border-ai/40 bg-ai-bg/30',
      )}
      data-task-id={task.id}
      aria-label={`任务：${task.name}${isAgent ? '（AI 负责人）' : ''}`}
      onClick={() => onOpen?.(task.id)}
      {...(disabled ? {} : sortable.attributes)}
      {...(disabled ? {} : sortable.listeners)}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-5 text-gray-800">{task.name}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* v3-copilot-inline-triggers：内联触发入口（六视图共享，改一处覆盖全部）
              窄屏下收进既有溢出菜单（D5），不新增触摸目标 */}
          <span
            className="hidden sm:inline-flex"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <CopilotInlineTrigger
              entity={{
                entityType: 'task',
                entityId: task.id,
                label: task.name,
                projectId: task.projectId,
              }}
              size="icon"
              variant="ghost"
            />
          </span>
          {onMove ? (
            // 阻止冒泡：点「更多」菜单不触发整卡的打开/拖动。
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label={`移动任务：${task.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* v3-copilot-inline-triggers：窄屏下内联入口收进溢出菜单 */}
                <DropdownMenuItem
                  className="sm:hidden"
                  onClick={(e) => {
                    e.stopPropagation()
                    // 触发内联事件
                    const triggerEvent = new CustomEvent('copilot:inline-trigger', {
                      detail: {
                        mention: {
                          entityType: 'task',
                          entityId: task.id,
                          label: task.name,
                          organizationId: 0,
                          projectId: task.projectId,
                        },
                        currentRoute: window.location.pathname,
                      },
                    })
                    window.dispatchEvent(triggerEvent)
                    useCopilotStore.getState().setOpen(true)
                  }}
                >
                  向 Copilot 询问
                </DropdownMenuItem>
                <DropdownMenuLabel>移动到</DropdownMenuLabel>
                <MoveItem
                  task={task}
                  label="待处理"
                  status="not_started"
                  column="pending"
                  onMove={onMove}
                />
                <MoveItem
                  task={task}
                  label="进行中"
                  status="in_progress"
                  column="in_progress"
                  onMove={onMove}
                />
                <MoveItem
                  task={task}
                  label="已完成"
                  status="completed"
                  column="completed"
                  onMove={onMove}
                />
                <DropdownMenuSeparator />
                <MoveItem
                  task={task}
                  label="阻塞"
                  status="blocked"
                  column="other"
                  onMove={onMove}
                />
                <MoveItem
                  task={task}
                  label="暂停"
                  status="on_hold"
                  column="other"
                  onMove={onMove}
                />
                <MoveItem
                  task={task}
                  label="已取消"
                  status="cancelled"
                  column="other"
                  onMove={onMove}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* v3-copilot-agent-as-assignee：agent 负责人用 AI 标签（图标+文字，不只靠颜色） */}
        {isAgent ? (
          <Badge variant="ai">
            <Bot className="h-3 w-3" aria-hidden />
            {AGENT_ACTION_LABEL}
          </Badge>
        ) : null}
        <Badge variant={PRIORITY_VARIANTS[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
        {columnForTask(task) === 'other' ? (
          <Badge variant="outline">{TASK_STATUS_LABELS[task.status]}</Badge>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
        <span className="inline-flex min-w-0 items-center gap-1">
          {isAgent ? (
            <Bot className="h-3.5 w-3.5 text-ai" aria-hidden />
          ) : (
            <CircleUserRound className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="truncate">
            {isAgent
              ? task.agentAssignee?.name || 'AI'
              : task.assignee?.fullName || task.assignee?.email || '未分配'}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {task.endDate
            ? new Date(`${task.endDate}T00:00:00`).toLocaleDateString('zh-CN')
            : '无期限'}
        </span>
      </div>
    </article>
  )
}

function MoveItem({
  task,
  label,
  status,
  column,
  onMove,
}: {
  task: Task
  label: string
  status: TaskStatus
  column: KanbanColumn
  onMove: NonNullable<TaskCardProps['onMove']>
}) {
  return (
    <DropdownMenuItem
      disabled={!canTransition(task.status, status)}
      onSelect={() => onMove(task, column, status)}
    >
      {label}
    </DropdownMenuItem>
  )
}

function columnForTask(task: Task): KanbanColumn {
  if (task.status === 'not_started') return 'pending'
  if (task.status === 'in_progress') return 'in_progress'
  if (task.status === 'completed') return 'completed'
  return 'other'
}
