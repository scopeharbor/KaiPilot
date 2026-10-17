'use client'

import { ArrowRight, CheckCircle2, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import { RuleMatchBadge } from './RuleMatchBadge'

/**
 * 任务状态变更预览与人工确认卡（写工具 `update_task_status`）。
 *
 * 与排程预览卡同一 RL-01 契约：受控纯展示，只有用户点「确认应用」才由上层发起
 * confirm；「放弃」只在本地销毁令牌。状态机不允许直达时（如 未开始 → 已完成）
 * 列出会经过的中间状态，让用户看清实际会发生什么。
 */
export interface TaskStatusPreviewDiff {
  taskId?: number
  /** 任务编号 `PROJ-5#128`（有则代替 #ID 显示）。 */
  taskCode?: string
  taskName?: string
  fromLabel?: string
  toLabel?: string
  pathLabels?: string[]
  noop?: boolean
}

export type TaskStatusPreviewPhase =
  'preview' | 'committing' | 'committed' | 'cancelled' | 'conflict'

export interface TaskStatusPreviewCardProps {
  toolName: string
  diff: TaskStatusPreviewDiff
  phase: TaskStatusPreviewPhase
  cancelNote?: string | null
  /** 文案（改负责人等复用本卡时覆盖）。 */
  noopText?: string
  committedText?: string
  /** 标题行（改设置等非任务场景复用本卡时覆盖「编号 · 任务名」）。 */
  title?: string
  /** 409 冲突提示（非任务场景覆盖）。 */
  conflictText?: string
  /** 额外的影响说明（如删除任务时：依赖会失效、30 天内可在回收站恢复）。 */
  note?: string | null
  /** 逐条明细（新建任务的执行步骤、勾选前后的步骤等）。 */
  details?: string[]
  onConfirm?: () => void
  onCancel?: () => void
  onRetry?: () => void
}

const buttonBase =
  'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50'

export function TaskStatusPreviewCard({
  toolName,
  diff,
  phase,
  cancelNote,
  noopText,
  committedText,
  title,
  conflictText,
  note,
  details,
  onConfirm,
  onCancel,
  onRetry,
}: TaskStatusPreviewCardProps) {
  const pathLabels = Array.isArray(diff.pathLabels)
    ? diff.pathLabels.filter((label): label is string => typeof label === 'string')
    : []
  const via = pathLabels.length > 1 ? pathLabels.slice(0, -1) : []
  const busy = phase === 'committing'

  return (
    <article
      data-card="task-status-preview"
      data-status={phase}
      className="overflow-hidden rounded-md border border-[var(--nx-border-focus)]/70 bg-[var(--nx-workspace-surface)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2">
        <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-status-warning)]/60 px-1.5 py-0.5 text-[10px] leading-none font-medium text-[var(--nx-status-warning)]">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          写操作待确认 · 人工审查
        </span>
        <RuleMatchBadge toolName={toolName} />
      </div>

      <div className="space-y-1.5 px-3 py-3">
        <p className="text-xs font-medium text-[var(--nx-text-primary)]">
          {title ??
            `${diff.taskCode ?? `#${diff.taskId ?? '?'}`} · ${diff.taskName || '未命名任务'}`}
        </p>
        <div className="flex items-center gap-2 text-[12px]">
          <span data-status-before className="text-[var(--nx-text-muted)] line-through">
            {diff.fromLabel ?? '—'}
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--nx-text-muted)]" aria-hidden />
          <span data-status-after className="font-medium text-[var(--nx-accent)]">
            {diff.toLabel ?? '—'}
          </span>
        </div>
        {diff.noop ? (
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            {noopText ?? '任务已经是这个状态，确认后不会有变化。'}
          </p>
        ) : via.length > 0 ? (
          <p data-status-path className="text-[11px] text-[var(--nx-text-muted)]">
            按状态流转规则会先经过：{via.join(' → ')}
          </p>
        ) : null}
        {note ? (
          <p data-preview-note className="text-[11px] text-[var(--nx-text-secondary)]">
            {note}
          </p>
        ) : null}
        {details && details.length > 0 ? (
          <ul
            data-preview-details
            className="space-y-0.5 text-[11px] text-[var(--nx-text-secondary)]"
          >
            {details.map((line, index) => (
              <li key={index} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
        {phase === 'conflict' ? (
          <p className="text-[11px] text-[var(--nx-status-danger)]">
            {conflictText ?? '任务在预览后已被修改（版本冲突 409），本次没有写入。请重新预览。'}
          </p>
        ) : null}
      </div>

      <div className="border-t border-[var(--nx-border-hairline)] px-3 py-2.5">
        {phase === 'committed' ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-success)]">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {committedText ?? `已改为「${diff.toLabel ?? '目标状态'}」`}
          </p>
        ) : phase === 'cancelled' ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-muted)]">
            <XCircle className="h-4 w-4 shrink-0" aria-hidden />
            {cancelNote ?? '已放弃 · 未发起任何写请求'}
          </p>
        ) : phase === 'conflict' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-preview-retry
              onClick={onRetry}
              className={`${buttonBase} border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] font-medium text-[var(--nx-accent)]`}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新预览
            </button>
            <button
              type="button"
              data-preview-cancel
              onClick={onCancel}
              className={`${buttonBase} border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]`}
            >
              放弃
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-preview-confirm
              disabled={busy}
              onClick={onConfirm}
              className={`${buttonBase} bg-[var(--nx-accent)] font-medium text-[var(--nx-bg-0)] hover:brightness-110`}
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  提交中…
                </>
              ) : (
                '确认应用'
              )}
            </button>
            <button
              type="button"
              data-preview-cancel
              disabled={busy}
              onClick={onCancel}
              className={`${buttonBase} border border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]`}
            >
              放弃
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export default TaskStatusPreviewCard
