'use client'

import * as React from 'react'
import { AlertTriangle, BadgeInfo, Loader2, RefreshCw, Sparkles, X, Zap } from 'lucide-react'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { useGeneratePmoAiRationale } from '@/hooks/use-pmo-ai-priority-recommendations'
import { cn } from '@/lib/utils'
import type { PmoRecommendationRecord } from '@aiproj/types'
import { PMO_AI_STATUS_LABELS, RECOMMENDATION_STATUS_LABELS } from '@aiproj/types'
import { AI_STATUS_CHIP, formatNxDateTime } from './PmoAiRecommendationList'

/**
 * AI 理由显式触发浮层（v3-ui-next-pmo-domain W5 · tasks 5.4，
 * spec「PMO AI 优先级推荐建议-审阅-采纳闭环」AI 理由辅助）。
 *
 * - AI 理由只由用户显式点击触发：POST …/:id/ai-rationale（请求体为幂等键
 *   idempotencyKey，对齐既有 PmoAiRationaleRequest 契约与后端 validator——
 *   目标引用上下文由服务端按推荐记录自行组装 prompt，见
 *   PmoAiPriorityRecommendationService.generateAiRationale）；
 * - 浮层顶部常驻免责声明「AI 理由仅供决策参考，未经人工确认不会执行任何变更」；
 * - 呈现 AI 状态（无/生成中/可用/已过期/失败/不可用，颜色 + 文字双通道）与叙述
 *   文本（正文级字号、舒适行距）；available 支持刷新重取、stale 态黄色警示，
 *   failed 态回显失败原因并可重试；
 * - 关闭浮层不改变推荐任何状态（RL-01：无自动采纳）；生成成功后经 hook 内联
 *   失效 ['pmo','ai-priority-recommendations'] 缓存，详情记录随 refetch 更新。
 */

export interface PmoAiRationaleModalProps {
  id: number
  record: PmoRecommendationRecord
  open: boolean
  onClose: () => void
}

export function PmoAiRationaleModal({ id, record, open, onClose }: PmoAiRationaleModalProps) {
  const rationaleMutation = useGeneratePmoAiRationale(id)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const dialogRef = React.useRef<HTMLDivElement | null>(null)

  // 只读 AI 理由浮层无表单脏值；生成在途时既有「关闭」按钮即可用，Escape 与之同语义默认可关。
  useDialogA11y({ ref: dialogRef, open, onClose })

  const generate = () => {
    setActionError(null)
    rationaleMutation.mutate(
      { idempotencyKey: `pmo-ai-rationale:${id}:${Date.now()}` },
      {
        onError: (error) => {
          setActionError(error instanceof Error ? error.message : 'AI 理由生成失败，请稍后重试')
        },
      },
    )
  }

  if (!open) return null

  const effectiveStatus = rationaleMutation.isPending ? ('generating' as const) : record.aiStatus
  const aiMetadata = record.aiMetadata
  const text = aiMetadata?.narrative ?? null
  const statusLabel = PMO_AI_STATUS_LABELS[effectiveStatus] ?? effectiveStatus
  const statusChip = AI_STATUS_CHIP[effectiveStatus] ?? AI_STATUS_CHIP.none

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        data-pmo-ai-rationale-modal
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="AI 推荐理由"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)]"
      >
        {/* 头 */}
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
                AI 推荐理由
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                #{id} · {record.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-pmo-ai-rationale-close
            aria-label="关闭 AI 理由浮层"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* RL-01 免责声明（常驻顶部） */}
          <div
            data-pmo-ai-rationale-disclaimer
            className="flex gap-2 rounded-sm border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2.5"
          >
            <Zap
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
              aria-hidden
            />
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              <span className="font-semibold text-[var(--nx-status-warning)]">
                AI 理由仅供决策参考，
              </span>
              未经人工确认
              <span className="font-semibold text-[var(--nx-text-primary)]">不会执行任何变更</span>
              。
            </p>
          </div>

          {/* 状态行 */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-[var(--nx-text-muted)]">AI 状态</span>
            <span
              data-pmo-ai-rationale-status
              className={cn('rounded-sm border px-1.5 py-0.5 text-[10px]', statusChip)}
            >
              {statusLabel}
            </span>
            {aiMetadata?.generatedAt ? (
              <span className="ml-auto font-mono text-[10px] text-[var(--nx-text-muted)]">
                生成于 {formatNxDateTime(aiMetadata.generatedAt)}
              </span>
            ) : null}
          </div>

          {/* stale 警示 */}
          {effectiveStatus === 'stale' ? (
            <div
              data-pmo-ai-rationale-stale
              role="note"
              className="flex gap-2 rounded-sm border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-[11px] text-[var(--nx-status-warning)]"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>AI 理由已超过新鲜度阈值，建议重新生成后再作参考；过期内容不代表当前项目状态。</p>
            </div>
          ) : null}

          {/* 内容态 */}
          {effectiveStatus === 'generating' ? (
            <div
              data-pmo-ai-rationale-generating
              role="status"
              aria-busy="true"
              className="flex min-h-40 flex-col items-center justify-center gap-2.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10"
            >
              <Loader2 className="h-5 w-5 animate-spin text-[var(--nx-accent)]" aria-hidden />
              <p className="text-xs text-[var(--nx-text-secondary)]">
                AI 正在基于推荐上下文生成理由…
              </p>
            </div>
          ) : null}

          {effectiveStatus === 'available' || effectiveStatus === 'stale' ? (
            <div
              data-pmo-ai-rationale-text
              className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-3.5"
            >
              <p className="whitespace-pre-wrap text-[13px] leading-7 text-[var(--nx-text-primary)]">
                {text ?? '（暂无理由文本）'}
              </p>
              {/* AIMarker：来源与置信度，双通道 */}
              <p
                data-pmo-ai-rationale-marker
                className="mt-3 flex flex-wrap items-center gap-1 border-t border-[var(--nx-border-hairline)] pt-2.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
              >
                <BadgeInfo className="h-3 w-3" aria-hidden />
                AI 生成 · {aiMetadata?.provider ?? '未知供应商'} / {aiMetadata?.model ?? '未知模型'}
                {aiMetadata?.confidence !== null && aiMetadata?.confidence !== undefined
                  ? ` · 置信度 ${Math.round(aiMetadata.confidence * 100)}%`
                  : ''}
                {aiMetadata?.status === 'pending' ? ' · 待人工复核' : ''}
              </p>
            </div>
          ) : null}

          {effectiveStatus === 'failed' ? (
            <div
              data-pmo-ai-rationale-failed
              role="alert"
              className="flex gap-2 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-3 py-2.5 text-[11px] text-[var(--nx-status-danger)]"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <p>
                生成失败：{aiMetadata?.failureMessage ?? actionError ?? '未知错误'}
                {aiMetadata?.failureCode ? `（${aiMetadata.failureCode}）` : ''}
              </p>
            </div>
          ) : null}

          {effectiveStatus === 'none' || effectiveStatus === 'unavailable' ? (
            <div
              data-pmo-ai-rationale-empty
              className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
            >
              <p className="text-xs text-[var(--nx-text-secondary)]">
                {effectiveStatus === 'unavailable'
                  ? 'AI 服务当前不可用，暂时无法生成推荐理由。'
                  : '该推荐暂无 AI 理由。点击下方「生成 AI 理由」显式触发生成，生成内容仅作人工审阅参考。'}
              </p>
            </div>
          ) : null}

          {actionError && effectiveStatus !== 'failed' ? (
            <div
              data-pmo-ai-rationale-action-error
              role="alert"
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-3 py-2 text-[11px] text-[var(--nx-status-danger)]"
            >
              {actionError}
            </div>
          ) : null}
        </div>

        {/* 底部动作（显式触发 / 重新生成；关闭零状态变更） */}
        <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--nx-text-muted)]">
            <span>
              推荐状态保持「{RECOMMENDATION_STATUS_LABELS[record.status] ?? record.status}」不变
            </span>
          </div>
          <div className="flex items-center gap-2">
            {effectiveStatus === 'available' ||
            effectiveStatus === 'stale' ||
            effectiveStatus === 'failed' ? (
              <button
                type="button"
                data-pmo-ai-rationale-refresh
                onClick={generate}
                disabled={rationaleMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重新生成
              </button>
            ) : null}
            {effectiveStatus === 'none' || effectiveStatus === 'unavailable' ? (
              <button
                type="button"
                data-pmo-ai-rationale-generate
                onClick={generate}
                disabled={effectiveStatus === 'unavailable'}
                className="flex h-8 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                生成 AI 理由
              </button>
            ) : null}
            <button
              type="button"
              data-pmo-ai-rationale-close-bottom
              onClick={onClose}
              className="h-8 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)]"
            >
              关闭
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default PmoAiRationaleModal
