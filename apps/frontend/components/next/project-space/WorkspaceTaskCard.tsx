'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bot, CalendarDays, Loader2, Lock } from 'lucide-react'
import { columnForStatus } from '@/lib/api/kanban'
import type { Task, TaskPriority } from '@/lib/api/tasks'
import { TASK_STATUS_LABELS } from '@/lib/task-status'
import { isAgentAssignee } from '@/types/agent-assignee'
import { cn } from '@/lib/utils'
import { readTaskSteps } from '@/lib/next/task-steps'

/** D18 工作面 A 优先级双通道文案（色 + 中文标签，色弱无障碍）。 */
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

/** 优先级色板（design D4）：lowest/low 中性冷色、medium 中性、high 琥珀、highest 冷红。 */
const PRIORITY_TONE: Record<TaskPriority, string> = {
  lowest: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
  low: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)]',
  medium: 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
  high: 'border-[var(--nx-status-warning)]/60 text-[var(--nx-status-warning)]',
  highest: 'border-[var(--nx-status-danger)]/60 text-[var(--nx-status-danger)]',
}

/** 日期短标签（MM-DD，确定性输出，避免 locale/ICU 差异）。 */
function shortDay(date: string | null): string | null {
  return date ? date.slice(5) : null
}

export interface WorkspaceTaskCardContentProps {
  task: Task
  /** 无编辑权限锁定态（观察者/非本人 assignee，RL-06）。 */
  locked?: boolean
  /** 锁定原因（悬停提示）。 */
  lockReason?: string
  /** 嵌在可拖卡片里：外层已有边框与内边距，这里不再重复（此前卡片里套卡片，两层框）。 */
  bare?: boolean
}

/**
 * 工作面看板卡片纯展示层（D18 方案 A：冷黑曜石 + 发丝线）。
 *
 * 供 `WorkspaceTaskCard`（接入 useSortable）与 `DragOverlay` 悬浮副本共用，
 * 保证拖拽浮层与列内卡片视觉 100% 一致。
 */
export function WorkspaceTaskCardContent({
  task,
  locked = false,
  lockReason = '你没有编辑此任务的权限',
  bare = false,
}: WorkspaceTaskCardContentProps) {
  const isAgent = isAgentAssignee(task.assigneeType)
  const assigneeName = isAgent
    ? task.agentAssignee?.name || 'AI'
    : task.assignee?.fullName || task.assignee?.email || '未分配'
  const assigneeInitials = isAgent
    ? task.agentAssignee?.initials || 'AI'
    : task.assignee?.initials ||
      (task.assignee?.fullName ? task.assignee.fullName.slice(0, 1) : '—')

  const startDay = shortDay(task.startDate)
  const endDay = shortDay(task.endDate)
  const dateLabel =
    startDay && endDay ? `${startDay} – ${endDay}` : (startDay ?? endDay ?? '未设定日期')
  const durationLabel =
    task.durationDays !== null
      ? `${task.durationDays} 天`
      : task.estimatedHours !== null
        ? `${task.estimatedHours} 小时`
        : null

  const inOtherColumn = columnForStatus(task.status) === 'other'
  const steps = readTaskSteps(task)

  return (
    <article
      data-workspace-task-card
      data-task-id={task.id}
      data-task-status={task.status}
      className={
        bare
          ? undefined
          : 'rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3'
      }
    >
      <div className="flex items-start gap-2">
        <h3
          data-card-name
          className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-5 text-[var(--nx-text-primary)]"
        >
          {task.name}
        </h3>
        {locked ? (
          <span
            data-card-lock
            className="shrink-0 text-[var(--nx-text-muted)]"
            aria-hidden
            title={lockReason}
          >
            <Lock className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          data-card-priority
          className={cn(
            'rounded-sm border px-1.5 py-0.5 text-[10px] leading-none',
            PRIORITY_TONE[task.priority],
          )}
        >
          {TASK_PRIORITY_LABELS[task.priority]}
        </span>
        {inOtherColumn ? (
          <span
            data-card-status
            className="rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--nx-text-secondary)]"
          >
            {TASK_STATUS_LABELS[task.status]}
          </span>
        ) : null}
      </div>

      {inOtherColumn &&
      typeof task.customFields?.blockedReason === 'string' &&
      task.customFields.blockedReason ? (
        <p
          data-card-blocked-reason
          title={task.customFields.blockedReason}
          className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--nx-status-danger)]"
        >
          {task.customFields.blockedReason}
        </p>
      ) : null}

      {/* 列变窄时整行换行（负责人一行、日期工期一行），负责人名字不被挤成一个字 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--nx-text-muted)]">
        <span data-card-assignee className="flex min-w-[5rem] max-w-full items-center gap-1.5">
          {isAgent ? (
            <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--nx-accent)]" aria-hidden />
          ) : (
            <span
              data-card-initials
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[9px] text-[var(--nx-text-secondary)]"
            >
              {assigneeInitials}
            </span>
          )}
          <span className="truncate" title={assigneeName}>
            {assigneeName}
          </span>
        </span>
        <span data-card-date className="inline-flex shrink-0 items-center gap-1">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {dateLabel}
        </span>
        {durationLabel ? (
          <span data-card-duration className="shrink-0">
            {durationLabel}
          </span>
        ) : null}
        {steps.steps.length > 0 ? (
          <span data-card-steps className="shrink-0" title="执行步骤完成数">
            ✓ {steps.done.filter(Boolean).length}/{steps.steps.length} 步
          </span>
        ) : null}
      </div>

      <div
        data-card-progress
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={task.progressPercent}
        aria-label={`任务进度 ${task.progressPercent}%`}
        className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--nx-border-hairline)]"
      >
        <div
          className="h-full rounded-full bg-[var(--nx-workspace-blue)]"
          style={{ width: `${Math.max(0, Math.min(100, task.progressPercent))}%` }}
        />
      </div>
    </article>
  )
}

export interface WorkspaceTaskCardProps extends WorkspaceTaskCardContentProps {
  /** 禁用拖拽（无 task:update / 非本人 task:update:self 时由看板置 true，RL-06）。 */
  dragDisabled?: boolean
  disabled?: boolean
  /** 这张卡的移动正在保存：显示「保存中…」，仍可继续拖（移动按顺序排队保存）。 */
  saving?: boolean
  /** 不能拖的原因（悬停提示），缺省为无编辑权限。 */
  lockReason?: string
  /** 点击卡片回调（W4 装配任务详情抽屉）。 */
  onOpen?: (taskId: number) => void
}

/**
 * 工作面看板卡片（D18 方案 A 仪器感卡片）。
 *
 * 整卡即拖拽手柄（Trello 式，2026-09-29 去掉了拖动点图标）：按住卡片任意位置移动 6px 以上即拖，
 * 无位移的点击走 `onOpen`；能拖的卡悬停时微微浮起、光标变抓手。无编辑权限时禁用拖拽、
 * 显示锁头并挂原因 Tooltip（RL-06 原位禁用，零 API 探测）。
 */
export function WorkspaceTaskCard({
  task,
  disabled = false,
  dragDisabled = false,
  saving = false,
  lockReason = '你没有编辑此任务的权限',
  onOpen,
}: WorkspaceTaskCardProps) {
  const sortable = useSortable({
    id: `task-${task.id}`,
    disabled: disabled || dragDisabled,
    data: { type: 'task', task, column: columnForStatus(task.status) },
  })

  return (
    <article
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      data-workspace-task-card
      data-task-id={task.id}
      data-task-status={task.status}
      aria-label={`任务：${task.name}`}
      title={
        disabled
          ? lockReason
          : saving
            ? '正在保存这次移动…'
            : dragDisabled
              ? '点击查看详情'
              : '按住拖动，点击查看详情'
      }
      onClick={onOpen ? () => onOpen(task.id) : undefined}
      className={cn(
        'rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-3',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]',
        'transition-[box-shadow,border-color,opacity,translate] duration-150 motion-reduce:transition-none',
        'group',
        dragDisabled
          ? 'cursor-pointer touch-pan-y rounded-none border-0 bg-transparent p-0'
          : disabled
            ? 'cursor-not-allowed opacity-75'
            : 'cursor-grab touch-auto hover:-translate-y-px hover:border-[var(--nx-border-focus)]/60 hover:shadow-md active:cursor-grabbing motion-reduce:hover:translate-y-0',
        // 拖起后原位置留一个虚线占位，卡片本体由 DragOverlay 跟手
        sortable.isDragging &&
          'border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/5 opacity-40',
        saving && 'animate-pulse border-[var(--nx-border-focus)] motion-reduce:animate-none',
      )}
      {...(disabled || dragDisabled ? {} : sortable.attributes)}
      {...(disabled || dragDisabled ? {} : sortable.listeners)}
      role={onOpen || !disabled ? 'button' : undefined}
      tabIndex={onOpen || !disabled ? 0 : undefined}
      {...(onOpen && dragDisabled
        ? {
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(task.id)
              }
            },
          }
        : {})}
      aria-disabled={(disabled && !dragDisabled) || undefined}
      aria-busy={saving || undefined}
    >
      <WorkspaceTaskCardContent task={task} locked={disabled} lockReason={lockReason} bare />
      {saving ? (
        <p
          data-card-saving
          className="mt-2 flex items-center gap-1 text-[10px] text-[var(--nx-accent)]"
        >
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
          保存中…
        </p>
      ) : null}
    </article>
  )
}

export default WorkspaceTaskCard
