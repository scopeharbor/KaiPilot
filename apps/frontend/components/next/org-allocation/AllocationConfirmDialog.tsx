'use client'

import * as React from 'react'
import { Loader2, ShieldCheck, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 跨项目调配写动作统一二次确认弹窗（v3-ui-next-org-portfolio-domains W7 ·
 * tasks 7.3，design Decision 6「预览 → 确认 → 应用」RL-06 写路径闭环）。
 *
 * - preview / confirm / apply / cancel 全部经本弹窗显式二次确认后才发出写请求；
 * - 提交中禁用（防抖）：`running` 状态在 pending 期间拒绝再次点击，杜绝双击双写；
 * - 失败以行内错误回显并保持弹窗打开（可重试），成功由调用方 onConfirm 决议关闭；
 * - 危险动作（取消草案 / 应用失败重试）使用 danger 主按钮双通道呈现；
 * - body 插槽允许调用方注入动作专属说明（如预览影响摘要、幂等语义提示）。
 */

export interface AllocationConfirmDialogProps {
  open: boolean
  /** 动作专属 aria-label（如「确认应用调配草案」）。 */
  title: string
  /** 弹窗体顶部说明文案。 */
  description?: React.ReactNode
  /** 确认按钮文案（如「生成预览」「确认并应用」）。 */
  confirmLabel: string
  /** 提交中文案（如「正在生成预览…」）。 */
  pendingLabel?: string
  /** danger 档位：用于取消草案等破坏性动作。 */
  danger?: boolean
  /** 由调用方执行真实写请求；失败时抛错或返回 false，成功后返回 true 自动关闭。 */
  onConfirm: () => Promise<boolean>
  onClose: () => void
  children?: React.ReactNode
}

/** 统一错误提取：ApiError（非 Error 实例）与 Error 均可读。 */
export function resolveActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

export function AllocationConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = '处理中…',
  danger = false,
  onConfirm,
  onClose,
  children,
}: AllocationConfirmDialogProps) {
  const [running, setRunning] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // 每次打开重置会话状态（防上次失败文案串场）。
  React.useEffect(() => {
    if (open) {
      setRunning(false)
      setActionError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !running) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, running, onClose])

  if (!open) return null

  async function handleConfirm() {
    if (running) return
    setRunning(true)
    setActionError(null)
    try {
      const shouldClose = await onConfirm()
      if (shouldClose) onClose()
    } catch (error) {
      setActionError(resolveActionErrorMessage(error, '操作失败，请重试'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div data-allocation-confirm-dialog className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-allocation-confirm-scrim
        aria-label="关闭确认弹窗"
        tabIndex={-1}
        onClick={running ? undefined : onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        data-allocation-confirm-panel
        className="absolute left-1/2 top-1/2 flex max-h-[80vh] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-[0_0_64px_rgba(0,0,0,0.6)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md border',
                danger
                  ? 'border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)]'
                  : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]',
              )}
            >
              {danger ? (
                <ShieldCheck className="h-4 w-4 text-[var(--nx-status-danger)]" aria-hidden />
              ) : (
                <ShieldCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
              )}
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">{title}</h3>
              {description ? (
                <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">{description}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            data-allocation-confirm-close
            aria-label="关闭确认弹窗"
            disabled={running}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {actionError ? (
            <p
              role="alert"
              aria-label="操作失败"
              data-allocation-confirm-error
              className="rounded-sm border border-[var(--nx-status-danger)]/50 bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              {actionError}
            </p>
          ) : null}
          <p
            data-allocation-confirm-hint
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-[11px] leading-relaxed text-[var(--nx-text-muted)]"
          >
            该操作将真实写入服务端记录，请核对影响预览后再继续。
          </p>
          {children ? <div data-allocation-confirm-body>{children}</div> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3.5">
          <button
            type="button"
            data-allocation-confirm-cancel
            disabled={running}
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            返回核对
          </button>
          <button
            type="button"
            data-allocation-confirm-submit
            disabled={running}
            onClick={() => void handleConfirm()}
            className={cn(
              'inline-flex h-8 min-w-24 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              danger
                ? 'border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.14)] text-[var(--nx-status-danger)] hover:border-[var(--nx-status-danger)]'
                : 'border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] text-[var(--nx-accent)] hover:border-[var(--nx-accent)]',
            )}
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AllocationConfirmDialog
