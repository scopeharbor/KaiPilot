'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Minus, Plus, X } from 'lucide-react'
import { KANBAN_COLUMNS, type KanbanColumn } from '@/lib/api/kanban'
import { tasksApi, type Task, type TaskPriority } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import {
  buildPlacementCreateInput,
  inferTaskPlacementDraft,
  PLACEMENT_DEFAULT_PRIORITY,
  PLACEMENT_MARKER_REASON,
  type PlacementDraft,
} from '@/lib/next/task-placement-rule'

export const PLACEMENT_INPUT_PLACEHOLDER =
  '输入一句话任务，如：完成用户鉴权接口测试，按 Enter 智能补全'
export const PLACEMENT_DURATION_MIN = 1
export const PLACEMENT_DURATION_MAX = 365
export const PLACEMENT_PRIORITY_LABELS: Record<TaskPriority, string> = {
  lowest: '最低',
  low: '低',
  medium: '中',
  high: '高',
  highest: '最高',
}

export interface TaskPlacementCardProps {
  projectId: number
  /** 放置目标列（继承该列初始状态）。 */
  columnId: KanbanColumn
  /** 取消/关闭回调（Esc、取消按钮、创建成功销毁）。 */
  onClose: () => void
  /** 创建成功回调（W4 装配：插入列顶 / 通知）。 */
  onCreated?: (task: Task) => void
  /** 初始负责人（可选快捷指定当前用户，缺省未分配）。 */
  initialAssigneeId?: number | null
}

/**
 * 放置建任务卡片（v3-ui-next-project-space D5 / 任务 3.3，D7 第一方入口）。
 *
 * 生命周期：
 * - 意图输入态：单行输入 + autoFocus，Enter 触发规则式补全，Esc 取消（零网络请求）；
 * - 待确认预览态：呈现 AIMarker「待确认推断 (0.85)」琥珀色微标，可就地微调工期/优先级；
 * - 显式确认：点击「确认创建」或 Cmd/Ctrl+Enter 才调用 `tasksApi.create`（RL-01 红线），
 *   成功刷新看板缓存后销毁；失败保持编辑态并高亮错误。
 */
export function TaskPlacementCard({
  projectId,
  columnId,
  onClose,
  onCreated,
  initialAssigneeId = null,
}: TaskPlacementCardProps) {
  const queryClient = useQueryClient()
  const columnLabel = KANBAN_COLUMNS.find((column) => column.id === columnId)?.label ?? '待处理'

  const [input, setInput] = React.useState('')
  const [draft, setDraft] = React.useState<PlacementDraft | null>(null)
  const [durationDays, setDurationDays] = React.useState(PLACEMENT_DURATION_MIN)
  const [priority, setPriority] = React.useState<TaskPriority>(PLACEMENT_DEFAULT_PRIORITY)
  const [assigneeId, setAssigneeId] = React.useState<number | null>(initialAssigneeId)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const ready = draft !== null && !submitting

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      // Esc：取消销毁，清空草稿，零网络请求（RL-01）。
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Enter') return
    if (event.metaKey || event.ctrlKey) {
      // Cmd/Ctrl+Enter：快捷键显式确认落库（RL-01：仅此路径发出写请求，
      // 输入态与预览态均生效）。
      event.preventDefault()
      void confirmCreate()
      return
    }
    // 裸 Enter：意图输入态触发规则式补全，预览态不重复推断。
    if (draft === null) {
      event.preventDefault()
      const next = inferTaskPlacementDraft(input, columnId)
      if (next) {
        setDraft(next)
        setDurationDays(next.durationDays)
        setPriority(next.priority)
        setAssigneeId(next.assigneeId ?? initialAssigneeId)
      }
    }
  }

  const confirmCreate = async () => {
    if (!draft || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const task = await tasksApi.create(
        projectId,
        buildPlacementCreateInput(draft, { durationDays, priority, assigneeId }),
      )
      await invalidateTaskQueries(queryClient, projectId)
      onCreated?.(task)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建任务失败，请稍后重试')
      setSubmitting(false)
    }
  }

  const adjustDuration = (delta: number) => {
    setDurationDays((current) =>
      Math.min(PLACEMENT_DURATION_MAX, Math.max(PLACEMENT_DURATION_MIN, current + delta)),
    )
  }

  return (
    <div
      data-task-placement-card
      data-placement-phase={draft === null ? 'input' : 'preview'}
      data-testid="placement-phase"
      onKeyDown={handleKeyDown}
      className={`rounded-md border bg-[var(--nx-workspace-surface)] ${
        draft === null ? 'border-[var(--nx-border-hairline)]' : 'border-[var(--nx-status-warning)]'
      }`}
    >
      {draft === null ? (
        // ------------------------------------------------------------ 意图输入态
        <input
          data-placement-input
          autoFocus
          value={input}
          maxLength={255}
          placeholder={PLACEMENT_INPUT_PLACEHOLDER}
          onChange={(event) => setInput(event.target.value)}
          aria-label="一句话任务描述"
          className="h-10 w-full rounded-md border border-transparent bg-transparent px-3 text-sm text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
      ) : (
        // -------------------------------------------------------- 待确认预览态
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p data-placement-name className="min-w-0 flex-1 text-sm text-[var(--nx-text-primary)]">
              {draft.name}
            </p>
            <button
              type="button"
              data-placement-cancel
              aria-label="取消放置"
              onClick={onClose}
              className="shrink-0 rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]">
            <span
              data-placement-status
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5"
            >
              {columnLabel} · {draft.status}
            </span>
            <span
              data-placement-start-date
              className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono"
            >
              起 {draft.startDate}
            </span>
            <span
              data-placement-marker
              data-confidence={draft.marker.confidence}
              title={PLACEMENT_MARKER_REASON}
              className="rounded-sm border border-[var(--nx-status-warning)]/50 bg-[var(--nx-status-warning)]/10 px-1.5 py-0.5 font-mono text-[var(--nx-status-warning)]"
            >
              待确认推断 ({draft.marker.confidence})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* 工期就地微调 */}
            <div
              data-placement-duration
              className="flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1 text-xs text-[var(--nx-text-secondary)]"
            >
              <button
                type="button"
                data-placement-duration-minus
                aria-label="减少工期"
                disabled={submitting || durationDays <= PLACEMENT_DURATION_MIN}
                onClick={() => adjustDuration(-1)}
                className="rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                <Minus className="h-3 w-3" aria-hidden />
              </button>
              <span data-placement-duration-value className="min-w-9 text-center font-mono">
                {durationDays} 天
              </span>
              <button
                type="button"
                data-placement-duration-plus
                aria-label="增加工期"
                disabled={submitting || durationDays >= PLACEMENT_DURATION_MAX}
                onClick={() => adjustDuration(1)}
                className="rounded p-0.5 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                <Plus className="h-3 w-3" aria-hidden />
              </button>
            </div>

            {/* 优先级就地微调 */}
            <label className="flex items-center gap-1.5 text-xs text-[var(--nx-text-secondary)]">
              <span className="shrink-0">优先级</span>
              <select
                data-placement-priority
                data-testid="placement-priority-select"
                value={priority}
                disabled={submitting}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="h-7 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
              >
                {Object.entries(PLACEMENT_PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error !== null && (
            <p data-placement-error role="alert" className="text-xs text-[var(--nx-status-danger)]">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              data-placement-cancel
              onClick={onClose}
              disabled={submitting}
              className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              data-placement-confirm
              onClick={() => void confirmCreate()}
              disabled={!ready}
              className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-warning)] bg-[var(--nx-status-warning)]/10 px-3 text-xs font-medium text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-status-warning)]/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden />
              )}
              确认创建
            </button>
          </div>
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            <kbd className="rounded border border-[var(--nx-border-hairline)] px-1">⌘/Ctrl</kbd>+
            <kbd className="rounded border border-[var(--nx-border-hairline)] px-1">Enter</kbd> 确认
            · <kbd className="rounded border border-[var(--nx-border-hairline)] px-1">Esc</kbd> 取消
          </p>
        </div>
      )}
    </div>
  )
}

export default TaskPlacementCard
