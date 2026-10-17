'use client'

import * as React from 'react'
import { Loader2, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react'
import { useAiExplanationMultiProjectImpact } from '@/hooks/use-multi-project-impact-analysis'

/**
 * AI 影响解释浮层（v3-ui-next-pmo-domain W8 · tasks 8.4，
 * spec「多项目影响分析工作台」AI 解释显式触发）。
 *
 * - 触发纪律（RL-01）：浮层打开不自动调用；用户显式点击「生成 AI 解释」
 *   才发请求，支持重新生成；关闭/重开不产生任何状态变更；
 * - 常驻免责声明 + AIMarker（provider/model/置信度/token 成本/生成时间）：
 *   AI 解释为只读辅助叙述（advisoryOnly / confirmationRequired / applied=false），
 *   未经人工确认不会执行任何变更；
 * - 三态闭环：生成中（aria-busy）/ 成功文本（正文级字号舒适行距）/ 失败可重试；
 *   服务端 AI 不可用（provider=null）时呈现中性说明，不伪造 AI 结论。
 */
export interface PmoImpactAiExplanationModalProps {
  organizationId: number
  snapshotId: number
  open: boolean
  onClose: () => void
}

export function PmoImpactAiExplanationModal({
  organizationId,
  snapshotId,
  open,
  onClose,
}: PmoImpactAiExplanationModalProps) {
  const aiMutation = useAiExplanationMultiProjectImpact(organizationId)
  const [focus, setFocus] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // 关闭浮层不清理结果：重开仅重读既有回执，不自动重发（RL-01）。
  const handleGenerate = () => {
    aiMutation.mutate({ snapshotId, focus: focus.trim() || null })
  }

  if (!open) return null

  const ai = aiMutation.data ?? null
  const pending = aiMutation.isPending
  const failed = aiMutation.isError
  const errorMessage =
    aiMutation.error instanceof Error ? aiMutation.error.message : 'AI 服务暂时不可用，请稍后重试。'

  return (
    <div
      data-imp-ai-modal
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        data-imp-ai-scrim
        aria-label="关闭 AI 解释"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 影响解释"
        aria-busy={pending || undefined}
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-[var(--nx-text-primary)]">
                AI 影响解释
              </h3>
              <p className="truncate font-mono text-[10px] text-[var(--nx-text-muted)]">
                快照 #{snapshotId} · 显式触发的辅助叙述
              </p>
            </div>
          </div>
          <button
            type="button"
            data-imp-ai-close
            aria-label="关闭 AI 解释"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* 常驻免责声明 */}
          <div
            data-imp-ai-disclaimer
            className="flex items-start gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5"
          >
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-status-warning)]"
              aria-hidden
            />
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
              <span className="font-medium text-[var(--nx-text-primary)]">
                AI 解释仅供决策参考。
              </span>
              本工具为只读辅助叙述（advisory-only），未经人工确认不会执行任何变更，也不会影响
              快照、项目或依赖数据。
            </p>
          </div>

          {/* 聚焦输入 + 显式触发 */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--nx-text-muted)]">
              聚焦区域（可选，例如「项目 Beta 的里程碑」）
            </span>
            <textarea
              data-imp-ai-focus
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              rows={2}
              disabled={pending}
              className="resize-none rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] focus:outline-none disabled:opacity-60"
              placeholder="不填写则解释整份快照的影响结论…"
            />
          </label>

          <button
            type="button"
            data-imp-ai-generate
            disabled={pending}
            onClick={handleGenerate}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                AI 生成中…
              </>
            ) : ai ? (
              <>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重新生成
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
                生成 AI 解释
              </>
            )}
          </button>

          {/* 生成中态 */}
          {pending ? (
            <div
              data-imp-ai-pending
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-8 text-center"
            >
              <Loader2 className="h-5 w-5 animate-spin text-[var(--nx-ai)]" aria-hidden />
              <p className="text-xs text-[var(--nx-text-secondary)]">
                正在生成影响解释（长文生成可能需要一点时间）…
              </p>
            </div>
          ) : null}

          {/* 失败态：可重试 */}
          {failed ? (
            <div
              data-imp-ai-error
              role="alert"
              className="flex flex-col items-center gap-2 rounded-md border border-[var(--nx-status-danger)]/30 bg-[var(--nx-status-danger)]/5 px-4 py-6 text-center"
            >
              <ShieldAlert className="h-5 w-5 text-[var(--nx-status-danger)]" aria-hidden />
              <p className="text-xs text-[var(--nx-status-danger)]">{errorMessage}</p>
              <button
                type="button"
                data-imp-ai-retry
                onClick={handleGenerate}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重试
              </button>
            </div>
          ) : null}

          {/* 成功态 */}
          {ai && !pending ? (
            <div data-imp-ai-result className="flex flex-col gap-3">
              {ai.provider === null && ai.model === null && ai.confidence === 0 ? (
                <div
                  data-imp-ai-unavailable
                  className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2.5 text-[11px] text-[var(--nx-text-secondary)]"
                >
                  {ai.explanation}
                </div>
              ) : (
                <>
                  <div
                    data-imp-ai-text
                    className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-3 text-sm leading-7 text-[var(--nx-text-primary)]"
                  >
                    {ai.explanation}
                  </div>
                  {ai.assumptions.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <h4 className="text-[11px] font-medium text-[var(--nx-text-muted)]">
                        数据假设
                      </h4>
                      <ul className="list-inside list-disc space-y-0.5 text-[11px] text-[var(--nx-text-secondary)]">
                        {ai.assumptions.map((assumption) => (
                          <li key={assumption}>{assumption}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {ai.followUpQuestions.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <h4 className="text-[11px] font-medium text-[var(--nx-text-muted)]">
                        可继续追问
                      </h4>
                      <ul className="space-y-0.5 text-[11px] text-[var(--nx-text-secondary)]">
                        {ai.followUpQuestions.map((question) => (
                          <li key={question} className="flex items-start gap-1.5">
                            <span
                              aria-hidden
                              className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--nx-text-muted)]"
                            />
                            {question}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}

              {/* AIMarker */}
              <div
                data-imp-ai-marker
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--nx-border-hairline)] pt-2.5 text-[10px] text-[var(--nx-text-muted)]"
              >
                <span className="inline-flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[var(--nx-ai)]">
                  <Sparkles className="h-2.5 w-2.5" aria-hidden />
                  AI 生成 · 需人工确认
                </span>
                {ai.provider ? (
                  <span className="font-mono">
                    {ai.provider}/{ai.model}
                  </span>
                ) : null}
                {ai.confidence > 0 ? (
                  <span data-imp-ai-confidence className="font-mono">
                    置信度 {Math.round(ai.confidence * 100)}%
                  </span>
                ) : null}
                {ai.tokenCost !== null ? (
                  <span className="font-mono">tokens ≈{ai.tokenCost}</span>
                ) : null}
                <span className="font-mono">
                  {new Date(ai.generatedAt).toLocaleString('zh-CN')}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default PmoImpactAiExplanationModal
