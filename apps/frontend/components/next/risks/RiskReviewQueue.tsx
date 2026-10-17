'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, Loader2, RefreshCw, Send, X } from 'lucide-react'
import { useReviewQueue } from '@/hooks/use-risks-v2'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuthStore } from '@/stores/auth-store'
import { reviewRisk } from '@/lib/api/risks-v2'
import type { RiskLevel, RiskReviewItem } from '@/lib/api/risks-v2'
import { cn } from '@/lib/utils'

/**
 * 待复查风险队列（v3-ui-next-risk-change-domains W1 · tasks 1.3）。
 *
 * - 联动 useReviewQueue 呈现待复查清单：风险等级（双通道色标）、敞口分值、
 *   下次复查日期与责任人；
 * - 逾期判定：nextReviewAt 早于当前时间即高亮为「已逾期」（danger 色标 + 文本双通道）；
 * - 具备风险写能力的用户可就地「提交复查」：弹窗录入复查结论（必填）与后续行动（必填），
 *   可选排定下次复查日期，调用 POST /risks/:riskId/review（不自动改变风险状态）；
 * - 提交成功统一失效 ['risks-v2'] 前缀缓存（摘要 / 复查队列联动刷新）。
 */

const LEVEL_TEXT: Record<RiskLevel, string> = {
  low: 'text-[var(--nx-status-success)]',
  medium: 'text-[var(--nx-status-warning)]',
  high: 'text-[var(--nx-status-danger)]',
  critical: 'text-[var(--nx-status-danger)]',
}

const LEVEL_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

/** 确定性日期展示（UTC 日历日，跨时区测试稳定）。 */
export function formatReviewDate(iso: string | null): string {
  if (!iso) return '未安排'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 逾期判定：下次复查日期已早于当前时间。 */
export function isReviewOverdue(item: Pick<RiskReviewItem, 'nextReviewAt'>): boolean {
  if (!item.nextReviewAt) return false
  const time = new Date(item.nextReviewAt).getTime()
  return !Number.isNaN(time) && time < Date.now()
}

export function RiskReviewQueue({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const { canAny } = usePermissions()
  const currentUserId = useAuthStore((state) => state.user?.id ?? null)
  const canUpdateRisk = canAny(['risk:manage', 'risk:update'])
  const canUpdateOwn = canAny(['risk:update_own'])

  const { data, isLoading, isError, refetch } = useReviewQueue(projectId)
  const queue = data?.data ?? []

  const [reviewTarget, setReviewTarget] = React.useState<RiskReviewItem | null>(null)
  const [conclusion, setConclusion] = React.useState('')
  const [nextAction, setNextAction] = React.useState('')
  const [nextReviewDate, setNextReviewDate] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!reviewTarget) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setReviewTarget(null)
        setFormError(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [reviewTarget])

  const openReview = (item: RiskReviewItem) => {
    setConclusion('')
    setNextAction('')
    setNextReviewDate('')
    setFormError(null)
    setReviewTarget(item)
  }

  const reviewMutation = useMutation({
    mutationFn: (payload: {
      riskId: number
      data: { conclusion: string; nextAction: string; nextReviewAt?: string | null }
    }) => reviewRisk(projectId, payload.riskId, payload.data),
    onSuccess: () => {
      setReviewTarget(null)
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['risks-v2'] })
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : '提交复查失败，请重试')
    },
  })

  const canReviewRow = (item: RiskReviewItem) =>
    canUpdateRisk || (canUpdateOwn && item.ownerId !== null && item.ownerId === currentUserId)

  const fieldClass =
    'w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

  return (
    <section
      data-risk-review-queue
      aria-busy={isLoading}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">待复查风险队列</h3>
          <span
            data-risk-review-count
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {queue.length} 条
          </span>
        </div>
        {queue.length > 0 ? (
          <button
            type="button"
            data-risk-review-refresh
            aria-label="刷新复查队列"
            onClick={() => void refetch()}
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </header>

      {isLoading && queue.length === 0 ? (
        <div
          data-risk-review-skeleton
          role="status"
          aria-label="正在加载复查队列"
          aria-busy="true"
          className="space-y-2 p-4"
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-sm bg-[var(--nx-bg-1)]" />
          ))}
        </div>
      ) : isError ? (
        <div
          role="alert"
          aria-label="复查队列加载失败"
          className="flex flex-col items-center gap-2.5 px-6 py-8 text-center"
        >
          <AlertTriangle className="h-6 w-6 text-[var(--nx-status-warning)]" aria-hidden />
          <p className="text-xs text-[var(--nx-text-secondary)]">复查队列加载失败，请稍后重试</p>
          <button
            type="button"
            data-risk-review-retry
            onClick={() => void refetch()}
            className="h-7 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            重新载入
          </button>
        </div>
      ) : queue.length === 0 ? (
        <div data-risk-review-empty className="px-6 py-8 text-center">
          <p className="text-sm text-[var(--nx-text-secondary)]">暂无待复查风险</p>
          <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
            已识别的开放风险会在临近复查日期时进入本队列
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--nx-border-hairline)]/60">
          {queue.map((item) => {
            const overdue = isReviewOverdue(item)
            const level = item.riskLevel as RiskLevel
            return (
              <li
                key={item.id}
                data-risk-review-item={item.id}
                data-review-overdue={overdue || undefined}
                className={cn(
                  'flex flex-wrap items-center gap-3 px-4 py-3',
                  overdue && 'bg-[rgba(239,68,68,0.05)]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      data-risk-review-level
                      className={cn(
                        'shrink-0 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] font-medium',
                        LEVEL_TEXT[level] ?? 'text-[var(--nx-text-secondary)]',
                      )}
                    >
                      {LEVEL_LABELS[level] ?? level}
                    </span>
                    <p className="truncate text-[13px] font-medium text-[var(--nx-text-primary)]">
                      {item.title}
                    </p>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--nx-text-muted)]">
                    <span>责任人：{item.ownerId === null ? '未指派' : `#${item.ownerId}`}</span>
                    <span aria-hidden>·</span>
                    <span data-risk-review-score>敞口 {item.score} 分</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    data-risk-review-date
                    className={cn(
                      'flex items-center gap-1 font-mono text-[11px]',
                      overdue
                        ? 'text-[var(--nx-status-danger)]'
                        : 'text-[var(--nx-text-secondary)]',
                    )}
                  >
                    <CalendarClock className="h-3 w-3" aria-hidden />
                    {formatReviewDate(item.nextReviewAt)}
                  </span>
                  {overdue ? (
                    <span
                      data-review-overdue-badge
                      className="rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-status-danger)]"
                    >
                      已逾期
                    </span>
                  ) : null}
                  {canReviewRow(item) ? (
                    <button
                      type="button"
                      data-risk-review-open
                      aria-label={`提交 ${item.title} 的复查`}
                      disabled={reviewMutation.isPending && reviewTarget?.id === item.id}
                      onClick={() => openReview(item)}
                      className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" aria-hidden />
                      提交复查
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 复查结论提交弹窗 */}
      {reviewTarget ? (
        <div data-risk-review-dialog-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            data-risk-review-scrim
            aria-label="关闭提交复查弹窗"
            tabIndex={-1}
            onClick={() => {
              setReviewTarget(null)
              setFormError(null)
            }}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="提交风险复查"
            data-risk-review-dialog
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                  提交风险复查
                </h3>
                <p className="mt-0.5 max-w-72 truncate text-[11px] text-[var(--nx-text-muted)]">
                  {reviewTarget.title} · 上次复查{' '}
                  {formatReviewDate(reviewTarget.lastReviewAt ?? null)}
                </p>
              </div>
              <button
                type="button"
                data-risk-review-dialog-close
                aria-label="关闭提交复查弹窗"
                onClick={() => {
                  setReviewTarget(null)
                  setFormError(null)
                }}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <p className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
                复查仅更新复查记录与下次复查日期，不自动改变风险状态机。
              </p>
              {formError ? (
                <p
                  role="alert"
                  aria-label="提交复查失败"
                  data-risk-review-error
                  className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
                >
                  {formError}
                </p>
              ) : null}
              <div>
                <label htmlFor="risk-review-conclusion" className={labelClass}>
                  复查结论 <span className="text-[var(--nx-status-danger)]">*</span>
                </label>
                <textarea
                  id="risk-review-conclusion"
                  data-risk-review-conclusion
                  rows={3}
                  maxLength={2000}
                  value={conclusion}
                  onChange={(event) => setConclusion(event.target.value)}
                  placeholder="记录本次复查判断、最新态势与结论…"
                  className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                />
              </div>
              <div>
                <label htmlFor="risk-review-action" className={labelClass}>
                  后续行动 <span className="text-[var(--nx-status-danger)]">*</span>
                </label>
                <textarea
                  id="risk-review-action"
                  data-risk-review-action
                  rows={2}
                  maxLength={2000}
                  value={nextAction}
                  onChange={(event) => setNextAction(event.target.value)}
                  placeholder="例如：持续监控 / 启动缓解 / 升级上报…"
                  className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                />
              </div>
              <div>
                <label htmlFor="risk-review-next-date" className={labelClass}>
                  下次复查日期（可选）
                </label>
                <input
                  id="risk-review-next-date"
                  data-risk-review-next-date
                  type="date"
                  value={nextReviewDate}
                  onChange={(event) => setNextReviewDate(event.target.value)}
                  className={fieldClass}
                />
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-risk-review-cancel
                onClick={() => {
                  setReviewTarget(null)
                  setFormError(null)
                }}
                disabled={reviewMutation.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-risk-review-submit
                disabled={
                  conclusion.trim() === '' || nextAction.trim() === '' || reviewMutation.isPending
                }
                onClick={() => {
                  if (!reviewTarget) return
                  setFormError(null)
                  reviewMutation.mutate({
                    riskId: reviewTarget.id,
                    data: {
                      conclusion: conclusion.trim(),
                      nextAction: nextAction.trim(),
                      nextReviewAt: nextReviewDate ? `${nextReviewDate}T00:00:00.000Z` : null,
                    },
                  })
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden />
                )}
                提交复查结论
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default RiskReviewQueue
