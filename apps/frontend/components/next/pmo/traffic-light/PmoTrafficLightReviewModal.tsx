'use client'

import * as React from 'react'
import { ClipboardCheck, Loader2, ShieldAlert, X } from 'lucide-react'
import { useUpsertTrafficLightReview } from '@/hooks/use-pmo-traffic-light'
import type { PortfolioTrafficLightItem, TrafficLightReviewState } from '@aiproj/types'
import {
  TRAFFIC_LIGHT_REVIEW_STATES,
  TRAFFIC_LIGHT_REVIEW_STATE_LABELS,
  TRAFFIC_LIGHT_STATUS_LABELS,
} from '@aiproj/types'

/**
 * PMO 红绿灯人工复核弹窗（v3-ui-next-pmo-domain W2 · tasks 2.3）。
 *
 * - 仅 `portfolio:manage` 用户可见复核入口（入口显隐由调用方/表格控制），
 *   弹窗本身不消费权限——服务端 policy 为最终裁判；
 * - 复核状态选自 `TRAFFIC_LIGHT_REVIEW_STATES`，备注必填（前端校验）；
 * - 「下一步 → 二次确认」双步闭环：确认页展示项目/灯色/状态/备注摘要，
 *   人工点击「确认提交」后才调用 `POST /pmo/traffic-light/:projectId/review`
 *   （useUpsertTrafficLightReview，成功即失效 ['pmo','traffic-light'] 缓存）；
 * - 失败保留弹窗与输入并回显服务端错误（不覆盖、不静默）；提交中禁用一切关闭。
 */

export interface PmoTrafficLightReviewModalProps {
  /** 待复核项目（父层仅在弹出时挂载本组件）。 */
  item: PortfolioTrafficLightItem
  onClose: () => void
}

function actionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}

export function PmoTrafficLightReviewModal({ item, onClose }: PmoTrafficLightReviewModalProps) {
  const mutation = useUpsertTrafficLightReview(item.projectId)

  const [step, setStep] = React.useState<'form' | 'confirm'>('form')
  const [reviewState, setReviewState] = React.useState<TrafficLightReviewState>('acknowledged')
  const [note, setNote] = React.useState('')
  const [formError, setFormError] = React.useState<string | null>(null)

  const pending = mutation.isPending

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, onClose])

  /** 第一步校验：备注必填。 */
  function handleGoConfirm() {
    if (note.trim() === '') {
      setFormError('请填写复核备注后再继续')
      return
    }
    setFormError(null)
    setStep('confirm')
  }

  /** 第二步：人工确认后才真正提交（RL-06，无任何自动落库路径）。 */
  async function handleSubmit() {
    if (pending) return
    try {
      await mutation.mutateAsync({ reviewState, note: note.trim() })
      onClose()
    } catch {
      // 失败由 mutation.error 回显，弹窗保持打开、输入保留
    }
  }

  const serverError = mutation.isError
    ? actionErrorMessage(mutation.error, '复核提交失败，请重试')
    : null

  return (
    <div data-traffic-review-modal className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-traffic-review-scrim
        aria-label="关闭复核弹窗"
        tabIndex={-1}
        onClick={pending ? undefined : onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`复核项目：${item.projectName}`}
        data-traffic-review-panel
        className="absolute left-1/2 top-1/2 flex max-h-[80vh] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-[0_0_64px_rgba(0,0,0,0.6)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <ClipboardCheck className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                复核项目：{item.projectName}
              </h3>
              <p className="mt-0.5 text-[11px] text-[var(--nx-text-muted)]">
                当前灯色：{TRAFFIC_LIGHT_STATUS_LABELS[item.trafficLight]} · 人工复核记录将留痕审计
              </p>
            </div>
          </div>
          <button
            type="button"
            data-traffic-review-close
            aria-label="关闭复核弹窗"
            disabled={pending}
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {step === 'form' ? (
          <div className="space-y-4 px-5 py-4">
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--nx-text-muted)]">复核状态</span>
              <select
                data-review-state
                value={reviewState}
                onChange={(event) => setReviewState(event.target.value as TrafficLightReviewState)}
                disabled={pending}
                className="h-9 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-40"
              >
                {TRAFFIC_LIGHT_REVIEW_STATES.map((state) => (
                  <option key={state} value={state}>
                    {TRAFFIC_LIGHT_REVIEW_STATE_LABELS[state]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--nx-text-muted)]">
                复核备注（必填）
              </span>
              <textarea
                data-review-note
                value={note}
                onChange={(event) => {
                  setNote(event.target.value)
                  if (formError) setFormError(null)
                }}
                rows={4}
                placeholder="记录本次复核的结论依据（如已线下确认处理方案、判定为误报等）"
                disabled={pending}
                className="w-full resize-none rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-40"
              />
            </label>
            {formError ? (
              <p
                role="alert"
                data-review-form-error
                className="flex items-center gap-1.5 text-[11px] text-[var(--nx-status-danger)]"
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {formError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                data-review-to-confirm
                onClick={handleGoConfirm}
                disabled={pending}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3.5 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-40"
              >
                下一步 · 确认复核
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div
              data-review-summary
              className="space-y-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 py-3 text-xs"
            >
              <p className="flex items-center justify-between gap-3">
                <span className="text-[var(--nx-text-muted)]">项目</span>
                <span className="truncate font-medium text-[var(--nx-text-primary)]">
                  {item.projectName}
                </span>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-[var(--nx-text-muted)]">当前灯色</span>
                <span className="font-medium text-[var(--nx-text-primary)]">
                  {TRAFFIC_LIGHT_STATUS_LABELS[item.trafficLight]}
                </span>
              </p>
              <p className="flex items-center justify-between gap-3">
                <span className="text-[var(--nx-text-muted)]">复核状态</span>
                <span className="font-medium text-[var(--nx-text-primary)]">
                  {TRAFFIC_LIGHT_REVIEW_STATE_LABELS[reviewState]}
                </span>
              </p>
              <p className="flex items-start justify-between gap-3">
                <span className="shrink-0 text-[var(--nx-text-muted)]">备注</span>
                <span className="whitespace-pre-wrap break-words text-right text-[var(--nx-text-primary)]">
                  {note.trim()}
                </span>
              </p>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              点击「确认提交」将立即写入复核标记并更新列表与计数缓存；本操作不可自动回退，
              请核对以上信息无误后提交。
            </p>
            {serverError ? (
              <p
                role="alert"
                data-review-server-error
                className="flex items-start gap-1.5 rounded-sm border border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11px] text-[var(--nx-status-danger)]"
              >
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {serverError}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                data-review-back
                onClick={() => setStep('form')}
                disabled={pending}
                className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] disabled:opacity-40"
              >
                返回修改
              </button>
              <button
                type="button"
                data-review-submit
                onClick={() => void handleSubmit()}
                disabled={pending}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.12)] px-3.5 text-xs font-medium text-[var(--nx-status-danger)] transition-colors hover:bg-[rgba(239,68,68,0.2)] disabled:opacity-50"
              >
                {pending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    提交中…
                  </>
                ) : (
                  '确认提交'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PmoTrafficLightReviewModal
