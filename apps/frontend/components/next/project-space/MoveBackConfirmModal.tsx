'use client'

import { useEffect } from 'react'
import { Undo2 } from 'lucide-react'
import type { Task } from '@/lib/api/tasks'
import { readTaskSteps } from '@/lib/next/task-steps'

export interface MoveBackConfirmModalProps {
  /** 要退回待处理的任务；null 时不渲染。 */
  task: Task | null
  onConfirm: () => void
  /** 取消：卡片留在「进行中」，不发请求。 */
  onCancel: () => void
}

/**
 * 「进行中」退回「待处理」的确认（2026-09-29）。
 *
 * 退回待处理表示还没开工：进度归零、已勾的执行步骤清空、实际开始日清掉。
 * 0% 且没勾过步骤的卡直接退回，不弹这个框；有进度的才问一句，避免误拖把做了一半的记录抹掉。
 */
export function MoveBackConfirmModal({ task, onConfirm, onCancel }: MoveBackConfirmModalProps) {
  useEffect(() => {
    if (!task) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [task, onCancel])

  if (!task) return null
  const steps = readTaskSteps(task)
  const doneCount = steps.done.filter(Boolean).length

  return (
    <div
      data-move-back-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="退回待处理"
        className="w-[min(92vw,360px)] rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-[var(--nx-text-primary)]">
          <Undo2 className="h-4 w-4 text-[var(--nx-status-warning)]" aria-hidden />
          退回「待处理」？
        </h3>
        <p className="mt-1 truncate text-xs text-[var(--nx-text-muted)]">{task.name}</p>
        <p className="mt-3 text-xs leading-5 text-[var(--nx-text-secondary)]">
          退回表示还没开工：当前进度 {task.progressPercent}%
          {doneCount > 0 ? `、已勾的 ${doneCount}/${steps.steps.length} 步` : ''}
          会清零。只是暂时做不下去的话，可以拖到「其他」标成阻塞或暂停。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-text-primary)]"
          >
            留在进行中
          </button>
          <button
            type="button"
            data-move-back-confirm
            onClick={onConfirm}
            className="rounded-md border border-[var(--nx-status-warning)] px-3 py-1.5 text-xs font-medium text-[var(--nx-status-warning)] transition-colors hover:bg-[var(--nx-status-warning)]/10"
          >
            退回并清零
          </button>
        </div>
      </div>
    </div>
  )
}

export default MoveBackConfirmModal
