'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Task, TaskStatus } from '@/lib/api/tasks'
import { canTransition, TASK_STATUS_LABELS } from '@/lib/task-status'
import { cn } from '@/lib/utils'

/** 「其他」列三态歧义消解选项（blocked / on_hold / cancelled）。 */
export const OTHER_STATUS_OPTIONS: readonly TaskStatus[] = ['blocked', 'on_hold', 'cancelled']

export interface OtherStatusSelectModalProps {
  open: boolean
  /** 待消解任务；null 时模态不渲染。 */
  task: Task | null
  /** 选择真实状态后回调（由看板执行状态机校验 + 乐观移动）。 */
  onSelect: (status: TaskStatus, note?: string) => void
  /** 取消选择：卡片弹回原位，零网络请求（RL-01）。 */
  onCancel: () => void
}

/**
 * 「其他」列快捷状态选择弹层（v3-ui-next-project-space D4 / 任务 2.5）。
 *
 * 任务拖入「其他」列时，blocked / on_hold / cancelled 三态存在歧义，
 * 必须由用户显式指定真实状态。选项按六态状态机（`canTransition`）逐项
 * 启禁：源状态不可达的选项原位禁用（如 not_started 只能到 cancelled），
 * 用户取消则卡片弹回原列，不产生任何网络请求。
 */
export function OtherStatusSelectModal({
  open,
  task,
  onSelect,
  onCancel,
}: OtherStatusSelectModalProps) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) setNote('')
  }, [open])
  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open || !task) return null

  return (
    <div
      data-other-status-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择“其他”列中的真实状态"
        className="w-[min(92vw,340px)] rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-[var(--nx-text-primary)]">选择真实状态</h3>
            <p
              data-other-status-task-name
              className="mt-1 truncate text-xs text-[var(--nx-text-muted)]"
            >
              {task.name}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            className="rounded p-0.5 text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <label className="mt-3 block text-xs text-[var(--nx-text-secondary)]">
          原因（选填，会通知项目经理）
          <textarea
            data-other-status-note
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="如：等待 DBA 完成库表评审"
            className="mt-1 w-full resize-none rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 py-1.5 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
        </label>
        <p className="mt-3 text-xs text-[var(--nx-text-muted)]">请指定具体状态：</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {OTHER_STATUS_OPTIONS.map((status) => {
            const allowed = canTransition(task.status, status)
            return (
              <button
                key={status}
                type="button"
                data-status={status}
                disabled={!allowed}
                onClick={() => onSelect(status, note.trim() || undefined)}
                className={cn(
                  'rounded-md border border-[var(--nx-border-hairline)] px-2 py-2 text-xs text-[var(--nx-text-primary)] transition-colors',
                  allowed && 'hover:border-[var(--nx-border-focus)] hover:bg-[var(--nx-bg-1)]',
                  !allowed && 'cursor-not-allowed text-[var(--nx-text-muted)] opacity-40',
                )}
              >
                {TASK_STATUS_LABELS[status]}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

export default OtherStatusSelectModal
