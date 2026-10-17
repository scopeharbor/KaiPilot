'use client'

import * as React from 'react'
import { AlertTriangle, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { requestAiNarrative, type AiNarrativeView } from '@/lib/api/decision-workbench'
import { useCurrentOrganizationId } from '@/hooks/use-organization-dashboard'
import { resolveDecisionActionError } from './PmoDecisionCreateDialog'

/**
 * PMO 决策 AI 叙述浮层（v3-ui-next-pmo-domain W6 · tasks 6.6，
 * spec「决策 AI 叙述只读辅助」）。
 *
 * - 入口门禁在容器层（仅 `pmo_decision:request_ai` 可见「生成 AI 叙述」按钮）；
 *   本浮层内的请求 = 用户在按钮上的显式触发（RL-01：AI 输出绝不自动生效）；
 * - 顶部常驻免责声明：非信任评注、仅供讨论，不参与证据摘要/方案排序/readiness/
 *   结论/交接；
 * - 状态：生成中（loading）/ 成功（ok/fallback/isolated 三态文案）/ 失败重试；
 *   fallback/isolated 时无叙述正文但带 finding 提示（诚实降级，不伪造 AI 输出）；
 * - 输出长文按阅读排版呈现（正文级字号 + 舒适行距）；支持「重新生成」与关闭；
 * - 关闭/重新生成均不改变议题、方案、立场或任何业务状态（关闭后零写请求）。
 */
export interface PmoDecisionAiNarrativeModalProps {
  decisionId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PmoDecisionAiNarrativeModal({
  decisionId,
  open,
  onOpenChange,
}: PmoDecisionAiNarrativeModalProps) {
  const organizationId = useCurrentOrganizationId()
  const [view, setView] = React.useState<AiNarrativeView | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const runRequest = React.useCallback(async (): Promise<void> => {
    if (organizationId === null) {
      setErrorMessage('当前缺少组织上下文，无法请求 AI 叙述。')
      return
    }
    setErrorMessage(null)
    setLoading(true)
    try {
      setView(await requestAiNarrative(organizationId, decisionId))
    } catch (error) {
      setView(null)
      setErrorMessage(resolveDecisionActionError(error, 'AI 叙述生成失败'))
    } finally {
      setLoading(false)
    }
  }, [organizationId, decisionId])

  // 打开 = 用户在页面的显式触发：进入浮层即发起一次生成（无 StrictMode 双挂载风险）。
  React.useEffect(() => {
    if (open) {
      setView(null)
      setErrorMessage(null)
      setLoading(false)
      void runRequest()
    }
  }, [open, runRequest])

  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) onOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, loading, onOpenChange])

  if (!open) return null

  const fallbackMeta =
    view?.status === 'ok'
      ? 'AI 叙述'
      : view?.status === 'fallback'
        ? 'AI 叙述（已回退确定性摘要）'
        : view?.status === 'isolated'
          ? 'AI 叙述（隔离降级）'
          : 'AI 叙述'

  return (
    <div data-pmo-decision-ai-modal className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-pmo-decision-ai-scrim
        aria-label="关闭 AI 叙述"
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 叙述"
        data-pmo-decision-ai-panel
        className="absolute left-1/2 top-1/2 flex max-h-[84vh] w-[min(94vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] shadow-[0_0_64px_rgba(0,0,0,0.6)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">AI 叙述</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /pmo/decision-workbench/cases/{decisionId}/ai/narrative · 显式触发
              </p>
            </div>
          </div>
          <button
            type="button"
            data-pmo-decision-ai-close
            aria-label="关闭 AI 叙述"
            onClick={() => onOpenChange(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* 常驻免责声明（RL-01） */}
          <p
            data-pmo-decision-ai-disclaimer
            role="note"
            className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3.5 py-2.5 text-xs leading-relaxed text-[var(--nx-text-muted)]"
          >
            <span className="font-medium text-[var(--nx-text-secondary)]">免责声明：</span>
            AI 叙述为非信任的讨论评注，仅供决策讨论参考；不参与证据摘要、方案排序、 readiness
            判定、结论或交接，未经人工确认不会执行任何变更。
          </p>

          {loading ? (
            <div
              data-pmo-decision-ai-generating
              role="status"
              aria-label="AI 叙述生成中"
              aria-busy="true"
              className="flex flex-col items-center gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-10 text-center"
            >
              <Loader2 className="h-5 w-5 animate-spin text-[var(--nx-accent)]" aria-hidden />
              <p className="text-xs text-[var(--nx-text-secondary)]">正在生成 AI 叙述…</p>
              <p className="text-[11px] text-[var(--nx-text-muted)]">
                生成过程不改变议题状态；可随时关闭浮层。
              </p>
            </div>
          ) : null}

          {!loading && errorMessage !== null ? (
            <div
              data-pmo-decision-ai-error
              role="alert"
              className="flex flex-col items-center gap-3 rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-6 py-8 text-center"
            >
              <AlertTriangle className="h-5 w-5 text-[var(--nx-status-warning)]" aria-hidden />
              <p className="text-xs text-[var(--nx-text-secondary)]">{errorMessage}</p>
              <button
                type="button"
                data-pmo-decision-ai-retry
                onClick={() => void runRequest()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                重试生成
              </button>
            </div>
          ) : null}

          {!loading && errorMessage === null && view !== null ? (
            <article data-pmo-decision-ai-body className="flex flex-col gap-3">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <span
                  data-pmo-decision-ai-status={view.status}
                  className="inline-flex h-6 items-center rounded-sm border px-2 text-[11px] text-[var(--nx-text-muted)]"
                  style={{
                    borderColor: 'var(--nx-border-hairline)',
                    backgroundColor: 'var(--nx-bg-0)',
                  }}
                >
                  {fallbackMeta}
                </span>
                <button
                  type="button"
                  data-pmo-decision-ai-regenerate
                  onClick={() => void runRequest()}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden />
                  重新生成
                </button>
              </header>

              {view.finding ? (
                <p
                  data-pmo-decision-ai-finding
                  className="rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  提示：{view.finding.message}
                </p>
              ) : null}

              {view.narrative ? (
                <div
                  data-pmo-decision-ai-narrative
                  className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-5 py-4"
                >
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--nx-text-primary)]">
                    {view.narrative}
                  </p>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-4 py-6 text-xs text-[var(--nx-text-muted)]">
                  {view.status === 'fallback' || view.status === 'isolated'
                    ? '本次未获得模型叙述正文，已降级为确定性摘要（见上方提示）。'
                    : '本次未生成叙述正文。'}
                </p>
              )}

              <p className="text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
                provider {view.provider} · hash {view.outputHash}
              </p>
            </article>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--nx-border-hairline)] px-6 py-3">
          <p className="text-[10px] leading-relaxed text-[var(--nx-text-muted)]">
            关闭后不产生任何状态变更（RL-01）。
          </p>
          <button
            type="button"
            data-pmo-decision-ai-close
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md border border-[var(--nx-border-hairline)] px-3 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}

export default PmoDecisionAiNarrativeModal
