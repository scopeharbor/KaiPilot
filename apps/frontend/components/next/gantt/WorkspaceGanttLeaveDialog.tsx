'use client'

import { cn } from '@/lib/utils'

/**
 * 未保存离开阻断模态框（v3-ui-next-gantt-lens design D8 / spec「应用内路由离开守卫」）。
 *
 * - 暗黑仪器感视觉：深空遮罩 + 冷黑曜石工作面面板 + 发丝线描边，消费 `--nx-*` 令牌；
 * - 根节点 `data-what-if-leave-dialog` 供测试与自动化定位；
 * - 文案与两选项固定：留在当前页面（stay，保留沙盒）/ 放弃并离开（discard，销毁 session 后放行）。
 */

export interface WorkspaceGanttLeaveDialogProps {
  open: boolean
  /** 用户试图前往的目标描述（如「看板」「/next/projects/101」「上一页」）。 */
  navigationLabel?: string | null
  onStay: () => void
  onDiscardAndLeave: () => void
}

export function WorkspaceGanttLeaveDialog({
  open,
  navigationLabel,
  onStay,
  onDiscardAndLeave,
}: WorkspaceGanttLeaveDialogProps) {
  if (!open) return null

  return (
    <div
      data-what-if-leave-dialog
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="what-if-leave-dialog-title"
      aria-describedby="what-if-leave-dialog-desc"
      className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-center justify-center p-4"
    >
      {/* 深空遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
      <div
        role="document"
        className="relative w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-5 shadow-[var(--shadow-lg)]"
      >
        <h2
          id="what-if-leave-dialog-title"
          className="text-base font-semibold text-[var(--nx-text-primary)]"
        >
          离开前请确认
        </h2>
        <p
          id="what-if-leave-dialog-desc"
          className="mt-2 text-sm leading-relaxed text-[var(--nx-text-secondary)]"
        >
          你正在进行 What-if 排程试算，存在未应用的变更。若此时离开，所有试算内容将被丢弃。
        </p>
        {navigationLabel ? (
          <p className="mt-3 rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-muted)]">
            目标：{navigationLabel}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            data-leave-dialog-stay
            onClick={onStay}
            className={cn(
              'h-8 rounded-[var(--radius-md)] border border-[var(--nx-border-hairline)] px-4 text-xs',
              'text-[var(--nx-text-secondary)] transition-colors hover:bg-[var(--nx-bg-1)] hover:text-[var(--nx-text-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
            )}
          >
            留在当前页面
          </button>
          <button
            type="button"
            data-leave-dialog-discard
            onClick={onDiscardAndLeave}
            className={cn(
              'h-8 rounded-[var(--radius-md)] border border-transparent px-4 text-xs font-medium',
              'bg-[var(--nx-status-danger)] text-white transition-colors hover:opacity-90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
            )}
          >
            放弃并离开
          </button>
        </div>
      </div>
    </div>
  )
}

export default WorkspaceGanttLeaveDialog
