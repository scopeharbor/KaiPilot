'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Minus, Plus, X } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { tasksApi, type CreateTaskInput, type Task, type TaskPriority } from '@/lib/api/tasks'
import {
  buildPlacementCreateInput,
  inferTaskPlacementDraft,
  type PlacementDraft,
} from '@/lib/next/task-placement-rule'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { cn } from '@/lib/utils'

export const IN_ROW_PLACEMENT_PLACEHOLDER =
  '输入任务一句话，Enter 自动推断（如：联调支付接口 3天 紧急）'
export const IN_ROW_PLACEMENT_BLOCKED_TIP = '你没有在该项目中创建任务的权限'

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

export interface InRowTaskPlacementSlotProps {
  projectId: number
  /** 位于哪一行之后（null 表示首行之前） */
  afterTaskId?: number | null
  /** 受控展开态 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 创建成功回调 */
  onCreated?: (task: Task) => void
  className?: string
}

/**
 * 列表行间放置建任务插槽组件（v3-ui-next-batch1-strategy-launch-tasks W3 / 任务 3.5）。
 *
 * 核心机制：
 * - 在表格行间鼠标悬停浮现发丝线与「+」插槽（快捷键 P 可唤出）；
 * - 原地展开 44px 单行卡片；
 * - 输入一句话按 Enter 触发本地规则推断，呈现琥珀色「待确认」微标，零网络请求（RL-01）；
 * - 按 Ctrl+Enter 或点击确认创建，调用 tasksApi.create 正式落库；
 * - 落库成功后调用 invalidateTaskQueries 集中失效网并收起插槽。
 */
export function InRowTaskPlacementSlot({
  projectId,
  afterTaskId = null,
  open,
  onOpenChange,
  onCreated,
  className,
}: InRowTaskPlacementSlotProps) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canCreate = can('task:create')

  const [internalOpen, setInternalOpen] = React.useState(false)
  const isExpanded = (open ?? internalOpen) && canCreate

  const setExpanded = React.useCallback(
    (next: boolean) => {
      if (next && !canCreate) return
      setInternalOpen(next)
      onOpenChange?.(next)
    },
    [canCreate, onOpenChange],
  )

  const [input, setInput] = React.useState('')
  const [draft, setDraft] = React.useState<PlacementDraft | null>(null)
  const [durationDays, setDurationDays] = React.useState(1)
  const [priority, setPriority] = React.useState<TaskPriority>('medium')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const resetState = () => {
    setInput('')
    setDraft(null)
    setDurationDays(1)
    setPriority('medium')
    setError(null)
    setSubmitting(false)
  }

  const handleClose = () => {
    resetState()
    setExpanded(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      return
    }

    if (event.key === 'Enter') {
      if (event.ctrlKey || event.metaKey) {
        // Ctrl+Enter / Cmd+Enter: 人工确认落库
        event.preventDefault()
        if (draft) {
          void handleConfirmCreate()
        } else if (input.trim()) {
          const nextDraft = inferTaskPlacementDraft(input, 'pending')
          if (nextDraft) {
            setDraft(nextDraft)
            setDurationDays(nextDraft.durationDays)
            setPriority(nextDraft.priority)
            void handleConfirmCreate(nextDraft)
          }
        }
        return
      }

      // 裸 Enter: 输入态触发本地规则推断
      if (draft === null && input.trim()) {
        event.preventDefault()
        const nextDraft = inferTaskPlacementDraft(input, 'pending')
        if (nextDraft) {
          setDraft(nextDraft)
          setDurationDays(nextDraft.durationDays)
          setPriority(nextDraft.priority)
        }
      }
    }
  }

  const handleConfirmCreate = async (currentDraft: PlacementDraft | null = draft) => {
    if (!currentDraft || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const createInput: CreateTaskInput = buildPlacementCreateInput(currentDraft, {
        durationDays,
        priority,
      })
      const task = await tasksApi.create(projectId, createInput)
      await invalidateTaskQueries(queryClient, projectId)
      onCreated?.(task)
      handleClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建任务失败，请稍后重试')
      setSubmitting(false)
    }
  }

  if (isExpanded) {
    return (
      <div
        data-in-row-placement-slot
        data-slot-active="true"
        data-placement-phase={draft === null ? 'input' : 'preview'}
        data-testid="in-row-placement-slot"
        onKeyDown={handleKeyDown}
        className={cn(
          'relative z-10 flex min-h-[44px] items-center border-y border-[var(--nx-border-hairline)]',
          'bg-[var(--nx-workspace-surface)] px-3 text-xs',
          draft !== null && 'border-[var(--nx-status-warning)]/60 bg-[var(--nx-workspace-surface)]',
          className,
        )}
      >
        {draft === null ? (
          // ---- 1. 意图输入态（单行卡片，回车触发推断，RL-01 零写请求）----
          <div className="flex w-full items-center gap-2">
            <Plus className="h-3.5 w-3.5 shrink-0 text-[var(--nx-space-cyan)]" />
            <input
              data-placement-input
              autoFocus
              value={input}
              placeholder={IN_ROW_PLACEMENT_PLACEHOLDER}
              aria-label="一句话任务描述"
              onChange={(e) => setInput(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none"
            />
            <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-[var(--nx-text-muted)]">
              <span className="hidden sm:inline">按</span>
              <kbd className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 py-0.5 font-mono">
                Enter
              </kbd>
              <span className="hidden sm:inline">智能推断</span>
            </div>
            <button
              type="button"
              data-placement-cancel
              aria-label="取消放置"
              onClick={handleClose}
              className="rounded p-1 text-[var(--nx-text-muted)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          // ---- 2. 待确认预览态（呈现琥珀色待确认微标，Ctrl+Enter 显式落库）----
          <div className="flex w-full flex-wrap items-center justify-between gap-2 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                data-placement-name
                className="max-w-[260px] truncate text-xs font-medium text-[var(--nx-text-primary)]"
                title={draft.name}
              >
                {draft.name}
              </p>

              {/* 琥珀色待确认推断微标 */}
              <span
                data-placement-marker
                data-confidence={draft.marker.confidence}
                className="inline-flex items-center gap-1 rounded border border-[var(--nx-status-warning)]/60 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-status-warning)]"
              >
                ⚡ 待确认推断 ({draft.marker.confidence})
              </span>

              {/* 开始日期 */}
              <span
                data-placement-start-date
                className="rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
              >
                起 {draft.startDate}
              </span>

              {/* 工期微调 */}
              <div
                data-placement-duration
                className="flex items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]"
              >
                <button
                  type="button"
                  data-placement-duration-minus
                  aria-label="减少工期"
                  disabled={submitting || durationDays <= 1}
                  onClick={() => setDurationDays((d) => Math.max(1, d - 1))}
                  className="p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] disabled:opacity-30"
                >
                  <Minus className="h-2.5 w-2.5" />
                </button>
                <span data-placement-duration-value className="min-w-6 text-center font-mono">
                  {durationDays} 天
                </span>
                <button
                  type="button"
                  data-placement-duration-plus
                  aria-label="增加工期"
                  disabled={submitting || durationDays >= 365}
                  onClick={() => setDurationDays((d) => Math.min(365, d + 1))}
                  className="p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] disabled:opacity-30"
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
              </div>

              {/* 优先级微调 */}
              <select
                data-placement-priority
                data-testid="placement-priority-select"
                value={priority}
                disabled={submitting}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="h-6 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1 text-[10px] text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              >
                {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {error ? (
              <span
                data-placement-error
                role="alert"
                className="text-[10px] text-[var(--nx-status-danger)]"
              >
                {error}
              </span>
            ) : null}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-placement-cancel
                aria-label="取消放置"
                disabled={submitting}
                onClick={handleClose}
                className="h-6 rounded border border-[var(--nx-border-hairline)] px-2 text-[10px] text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
              >
                取消
              </button>
              <button
                type="button"
                data-placement-confirm
                disabled={submitting}
                onClick={() => void handleConfirmCreate()}
                className="inline-flex h-6 items-center gap-1 rounded border border-[var(--nx-status-warning)] bg-[var(--nx-status-warning)]/20 px-2 text-[10px] font-medium text-[var(--nx-text-primary)] hover:bg-[var(--nx-status-warning)]/30 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3 text-[var(--nx-status-warning)]" />
                )}
                <span>确认创建</span>
                <span className="hidden sm:inline font-mono text-[9px] text-[var(--nx-text-muted)]">
                  (Ctrl+Enter)
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- 常态：悬停发丝线与「+」放置插槽 ----
  return (
    <div
      data-in-row-placement-slot
      data-slot-active="false"
      data-after-task-id={afterTaskId ?? undefined}
      className={cn('group relative h-2 -my-1 z-10 flex items-center justify-center', className)}
    >
      {/* 悬停发丝线 */}
      <div className="absolute inset-x-0 h-px bg-transparent transition-colors group-hover:bg-[var(--nx-space-cyan)]/40" />

      {/* 居中浮现的天青色「+」放置插槽按钮 */}
      <button
        type="button"
        data-placement-slot-btn
        aria-label="在行间放置新任务"
        disabled={!canCreate}
        title={!canCreate ? IN_ROW_PLACEMENT_BLOCKED_TIP : '放置新任务（快捷键 P）'}
        onClick={() => setExpanded(true)}
        className={cn(
          'relative z-10 flex h-4 w-4 items-center justify-center rounded-full',
          'border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]',
          'text-[var(--nx-space-cyan)] opacity-0 shadow-sm transition-all',
          'group-hover:opacity-100 hover:scale-110 hover:border-[var(--nx-space-cyan)]',
          'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-space-cyan)]',
          !canCreate && 'cursor-not-allowed opacity-0 group-hover:opacity-30',
        )}
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

export default InRowTaskPlacementSlot
