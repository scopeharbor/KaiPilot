'use client'

import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { Bot, FileDown, RotateCw, Sparkles, TriangleAlert, X } from 'lucide-react'
import { getAiImpactSuggestions } from '@/lib/api/change-requests'
import { cn } from '@/lib/utils'

/**
 * AI 变更影响辅助分析浮层（v3-ui-next-risk-change-domains W2 · tasks 2.3，
 * design Decision 4.2 / spec「AI 变更影响辅助分析（RL-01 纯建议）」）。
 *
 * - 触发端点 POST /change-requests/:id/ai-impact（需已存在的变更草稿/退回态记录）；
 * - 顶部常驻免责声明：AI 建议仅供决策参考，未经人工确认不会写入任何字段；
 * - 逐维展示 AI 推断文本 + 综合置信度 + 推断来源 + 假设前提（RL-07 透明性）；
 * - 「填入表单」为唯一出参动作：由用户显式点击后经 onFill 回传建议文本，
 *   供宿主表单决定如何引用（只落六维影响摘要，严禁静默覆盖用户未保存内容）；
 * - Esc / 遮罩 / 关闭按钮三路退出；确定性暗黑浮层（var(--nx-*) 令牌）。
 */

export interface ChangeAiImpactModalProps {
  open: boolean
  projectId: number
  crId: number
  onClose: () => void
  /** 用户显式点击「填入表单」后回调（键为六维摘要键）。 */
  onFill: (suggestions: Record<string, string>) => void
}

const DIMENSION_ORDER = ['scope', 'schedule', 'resources', 'cost', 'risks', 'assumptions'] as const

const DIMENSION_LABELS: Record<string, string> = {
  scope: '范围',
  schedule: '进度',
  resources: '资源',
  cost: '成本',
  risks: '风险',
  assumptions: '假设',
}

export function ChangeAiImpactModal({ open, crId, onClose, onFill }: ChangeAiImpactModalProps) {
  const [fillState, setFillState] = React.useState<'idle' | 'filled'>('idle')

  const fetchSuggestions = useMutation({
    mutationFn: () => getAiImpactSuggestions(crId),
    onSuccess: () => setFillState('idle'),
  })

  // 每次打开重新拉取最新推断（点击即显式动作，RL-01 允许人工触发）
  React.useEffect(() => {
    if (open) {
      setFillState('idle')
      fetchSuggestions.mutate()
    }
  }, [open, crId])

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const suggestion = fetchSuggestions.data?.data
  const suggestionsRecord: Record<string, string> = suggestion?.suggestions ?? {}
  const presentDimensions = DIMENSION_ORDER.filter(
    (key) => typeof suggestionsRecord[key] === 'string' && suggestionsRecord[key] !== '',
  )

  return (
    <div
      data-cr-ai-modal
      data-cr-ai-cr-id={crId}
      className="fixed inset-0 z-50"
      role="presentation"
    >
      <button
        type="button"
        data-cr-ai-scrim
        aria-label="关闭 AI 影响分析"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="AI 变更影响辅助分析"
        aria-describedby="cr-ai-disclaimer"
        data-cr-ai-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                AI 变更影响分析
              </h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /change-requests/{crId}/ai-impact
              </p>
            </div>
          </div>
          <button
            type="button"
            data-cr-ai-close
            aria-label="关闭 AI 影响分析"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* RL-01 免责声明 */}
          <p
            id="cr-ai-disclaimer"
            data-cr-ai-disclaimer
            className="flex items-start gap-2 rounded-sm border border-[var(--nx-status-warning)] bg-[rgba(245,158,11,0.08)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--nx-status-warning)]"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              AI 影响分析仅供决策参考：推断基于既有项目数据，可能失真或过时。未经人工
              确认绝不会写入变更请求或覆盖你已录入的内容。
            </span>
          </p>

          {fetchSuggestions.isPending ? (
            <div
              data-cr-ai-loading
              role="status"
              aria-label="AI 影响分析生成中"
              aria-busy="true"
              className="space-y-3"
            >
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
                />
              ))}
            </div>
          ) : null}

          {fetchSuggestions.isError ? (
            <div
              data-cr-ai-error
              role="alert"
              aria-label="AI 影响分析失败"
              className="rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.08)] px-2.5 py-2 text-xs text-[var(--nx-status-danger)]"
            >
              <p>AI 影响分析生成失败：{fetchSuggestions.error?.message ?? '请稍后重试'}</p>
              <button
                type="button"
                data-cr-ai-retry
                onClick={() => fetchSuggestions.mutate()}
                className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
              >
                <RotateCw className="h-3 w-3" aria-hidden />
                重新生成
              </button>
            </div>
          ) : null}

          {suggestion ? (
            <>
              {/* 置信度与来源（RL-07 透明标记） */}
              <div
                data-cr-ai-meta
                className="flex flex-wrap items-center gap-2 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 py-2 text-[11px] text-[var(--nx-text-secondary)]"
              >
                <span className="font-mono text-[var(--nx-accent)]">
                  {(suggestion.confidence * 100).toFixed(0)}% 置信度
                </span>
                <span aria-hidden>·</span>
                <span>推断来源：{suggestion.source || '规则推断'}</span>
              </div>

              {presentDimensions.length === 0 ? (
                <p
                  data-cr-ai-empty
                  className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-6 text-center text-xs text-[var(--nx-text-muted)]"
                >
                  本次未生成可用的维度推断，请补充变更描述后重试。
                </p>
              ) : (
                <div className="space-y-2.5">
                  {presentDimensions.map((key) => (
                    <div
                      key={key}
                      data-cr-ai-dimension={key}
                      className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] px-3 py-2.5"
                    >
                      <h4 className="mb-1 text-[11px] font-semibold text-[var(--nx-text-primary)]">
                        {DIMENSION_LABELS[key] ?? key}
                      </h4>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--nx-text-secondary)]">
                        {suggestionsRecord[key]}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {suggestion.assumptions.length > 0 ? (
                <div data-cr-ai-assumptions className="rounded-sm px-1">
                  <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--nx-text-muted)]">
                    AI 假设前提
                  </h4>
                  <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                    {suggestion.assumptions.map((assumption, index) => (
                      <li key={index}>{assumption}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3.5">
          {suggestion && presentDimensions.length > 0 ? (
            <button
              type="button"
              data-cr-ai-fill
              disabled={fillState === 'filled'}
              onClick={() => {
                onFill(suggestionsRecord)
                setFillState('filled')
              }}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] px-4 text-xs font-medium text-[var(--nx-text-primary)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]',
                fillState === 'filled'
                  ? 'cursor-default border-[var(--nx-status-success)] text-[var(--nx-status-success)]'
                  : 'hover:border-[var(--nx-accent)]',
              )}
            >
              {fillState === 'filled' ? (
                <>
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                  已填入表单
                </>
              ) : (
                <>
                  <FileDown className="h-3.5 w-3.5" aria-hidden />
                  填入影响摘要
                </>
              )}
            </button>
          ) : null}
          <button
            type="button"
            data-cr-ai-close-bottom
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  )
}

export default ChangeAiImpactModal
