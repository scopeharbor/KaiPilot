'use client'

import * as React from 'react'
import { memberOptionLabel, sortMembersForAssign } from '@/lib/next/member-options'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, AlertTriangle, Check, Loader2, Trash2, X } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import type { ProjectMember } from '@/lib/api/projects'
import { tasksApi, type TaskBatchInput, type TaskPriority, type TaskStatus } from '@/lib/api/tasks'
import { invalidateTaskQueries } from '@/lib/task-query-invalidation'
import { cn } from '@/lib/utils'

export const BATCH_STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'not_started', label: '未开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'blocked', label: '已阻塞' },
  { value: 'on_hold', label: '已暂停' },
  { value: 'cancelled', label: '已取消' },
]

export const BATCH_PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'lowest', label: '最低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'highest', label: '最高' },
]

export interface TaskBatchActionBarProps {
  projectId: number
  selectedIds: number[]
  members?: ProjectMember[]
  pending?: boolean
  onClear: () => void
  onSuccess?: () => void
  onExecute?: (input: TaskBatchInput) => Promise<void> | void
  className?: string
}

/**
 * 浮动暗黑仪器感批量操作栏组件（v3-ui-next-batch1-strategy-launch-tasks W3 / 任务 3.3）。
 *
 * 核心行为：
 * - 当勾选任务 ≥ 1 时，在表格底部居中滑出悬浮栏；
 * - 批量修改状态（6 态）、批量调整优先级（5 档）、批量指派成员；
 * - 批量移入回收站二次确认弹窗；
 * - 权限防护：无 task:update 或 task:delete 时控件置灰禁用；
 * - 操作成功后统一清空已选集合，并 await invalidateTaskQueries(queryClient, projectId)。
 */
export function TaskBatchActionBar({
  projectId,
  selectedIds,
  members = [],
  pending = false,
  onClear,
  onSuccess,
  onExecute,
  className,
}: TaskBatchActionBarProps) {
  const queryClient = useQueryClient()
  const { can, canAny } = usePermissions()

  const canUpdate = canAny(['task:update', 'task:update:self'])
  const canAssign = can('task:assign') || canUpdate
  const canDelete = can('task:delete')

  const [selectedStatus, setSelectedStatus] = React.useState<TaskStatus>('in_progress')
  const [selectedPriority, setSelectedPriority] = React.useState<TaskPriority>('high')
  const [selectedAssignee, setSelectedAssignee] = React.useState<string>('')
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)
  const [internalSubmitting, setInternalSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const isSubmitting = pending || internalSubmitting

  if (selectedIds.length === 0) return null

  const executeBatch = async (input: TaskBatchInput) => {
    setInternalSubmitting(true)
    setError(null)
    try {
      await tasksApi.batch(projectId, input)
      await invalidateTaskQueries(queryClient, projectId)
      await onExecute?.(input)
      onSuccess?.()
      onClear()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量操作失败，请稍后重试')
    } finally {
      setInternalSubmitting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleApplyStatus = () => {
    if (!canUpdate || isSubmitting) return
    void executeBatch({
      action: 'change_status',
      taskIds: selectedIds,
      data: { status: selectedStatus },
    })
  }

  const handleApplyPriority = () => {
    if (!canUpdate || isSubmitting) return
    void executeBatch({
      action: 'update',
      taskIds: selectedIds,
      data: { priority: selectedPriority },
    })
  }

  const handleApplyAssignee = () => {
    if (!canAssign || isSubmitting) return
    void executeBatch({
      action: 'reassign',
      taskIds: selectedIds,
      data: { assigneeId: selectedAssignee ? Number(selectedAssignee) : null },
    })
  }

  const handleConfirmDelete = () => {
    if (!canDelete || isSubmitting) return
    void executeBatch({
      action: 'delete',
      taskIds: selectedIds,
    })
  }

  return (
    <>
      <div
        data-task-batch-action-bar
        data-testid="task-batch-action-bar"
        role="toolbar"
        aria-label="批量任务操作栏"
        className={cn(
          'fixed bottom-6 left-1/2 z-20 max-h-[50dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 overflow-y-auto sm:w-max',
          'flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--nx-border-hairline)]',
          'bg-[var(--nx-workspace-surface)] px-4 py-2 text-xs',
          'shadow-2xl shadow-black/80 backdrop-blur-md',
          'transition-all duration-200 ease-out',
          className,
        )}
      >
        {/* 已选计数 */}
        <div className="flex items-center gap-1.5 pr-2 font-mono border-r border-[var(--nx-border-hairline)]">
          <span data-batch-count className="font-medium text-[var(--nx-text-primary)]">
            已选择 {selectedIds.length} 项任务
          </span>
        </div>

        {/* 批量变更状态 */}
        <div className="flex items-center gap-1.5">
          <select
            data-batch-status-select
            aria-label="选择批量目标状态"
            value={selectedStatus}
            disabled={!canUpdate || isSubmitting}
            onChange={(e) => setSelectedStatus(e.target.value as TaskStatus)}
            className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            {BATCH_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-batch-apply-status
            aria-label="应用状态变更"
            disabled={!canUpdate || isSubmitting}
            onClick={handleApplyStatus}
            className="inline-flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-bg-2)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            变更状态
          </button>
        </div>

        {/* 批量调整优先级 */}
        <div className="flex items-center gap-1.5 border-l border-[var(--nx-border-hairline)] pl-2">
          <select
            data-batch-priority-select
            aria-label="选择批量目标优先级"
            value={selectedPriority}
            disabled={!canUpdate || isSubmitting}
            onChange={(e) => setSelectedPriority(e.target.value as TaskPriority)}
            className="h-7 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            {BATCH_PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-batch-apply-priority
            aria-label="应用优先级调整"
            disabled={!canUpdate || isSubmitting}
            onClick={handleApplyPriority}
            className="inline-flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-bg-2)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            调整优先级
          </button>
        </div>

        {/* 批量指派成员 */}
        {members.length > 0 ? (
          <div className="flex items-center gap-1.5 border-l border-[var(--nx-border-hairline)] pl-2">
            <select
              data-batch-assignee-select
              aria-label="选择批量指派成员"
              value={selectedAssignee}
              disabled={!canAssign || isSubmitting}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="h-7 max-w-[240px] rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              <option value="">未指派</option>
              {sortMembersForAssign(members).map((m) => (
                <option key={m.userId} value={String(m.userId)}>
                  {memberOptionLabel(m)}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-batch-apply-assignee
              aria-label="应用指派成员"
              disabled={!canAssign || isSubmitting}
              onClick={handleApplyAssignee}
              className="inline-flex h-7 items-center gap-1 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-bg-2)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              指派
            </button>
          </div>
        ) : null}

        {/* 批量移入回收站 */}
        <div className="flex items-center gap-1.5 border-l border-[var(--nx-border-hairline)] pl-2">
          <button
            type="button"
            data-batch-delete
            aria-label="批量移入回收站"
            disabled={!canDelete || isSubmitting}
            title={!canDelete ? '无删除权限' : undefined}
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex h-7 items-center gap-1 rounded border border-[var(--nx-status-danger)]/50 bg-[var(--nx-status-danger)]/10 px-2.5 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[var(--nx-status-danger)]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            移入回收站
          </button>
        </div>

        {/* 取消多选 */}
        <div className="border-l border-[var(--nx-border-hairline)] pl-2">
          <button
            type="button"
            data-batch-clear
            aria-label="取消选择"
            disabled={isSubmitting}
            onClick={onClear}
            className="inline-flex h-7 items-center gap-1 rounded p-1 text-[var(--nx-text-muted)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            取消
          </button>
        </div>
      </div>

      {/* 错误提示浮层 */}
      {error ? (
        <div
          data-batch-error
          role="alert"
          className="fixed bottom-20 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-workspace-surface)] px-3 py-1.5 text-xs text-[var(--nx-status-danger)] shadow-lg"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      {/* 移入回收站二次确认弹窗 */}
      {showDeleteConfirm ? (
        <div
          data-batch-delete-dialog
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="batch-delete-title"
          aria-describedby="batch-delete-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-5 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[var(--nx-status-danger)]">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h3
                id="batch-delete-title"
                className="text-sm font-semibold text-[var(--nx-text-primary)]"
              >
                移入回收站确认
              </h3>
            </div>
            <p
              id="batch-delete-desc"
              className="mt-2.5 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
            >
              确定要将选中的 {selectedIds.length} 项任务移入回收站吗？移入后可在回收站查看或恢复。
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                data-batch-cancel-delete
                data-testid="batch-cancel-delete"
                disabled={isSubmitting}
                onClick={() => setShowDeleteConfirm(false)}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                data-batch-confirm-delete
                data-testid="batch-confirm-delete"
                disabled={isSubmitting}
                onClick={handleConfirmDelete}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[var(--nx-status-danger)] px-3 text-xs font-medium text-white hover:bg-[var(--nx-status-danger)]/90 disabled:opacity-40"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                确认移入
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default TaskBatchActionBar
