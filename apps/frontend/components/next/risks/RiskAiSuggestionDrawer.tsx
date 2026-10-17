'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, RotateCcw, Sparkles, X, Zap } from 'lucide-react'
import {
  acceptAiSuggestion,
  rejectAiSuggestion,
  triggerAiSuggestions,
  type RiskAiSuggestion,
} from '@/lib/api/risks'
import { cn } from '@/lib/utils'
import {
  RISK_CATEGORY_LABELS,
  RISK_SCALE_OPTIONS,
  riskExposureTone,
  RISK_TONE_LABELS,
} from '@/components/next/charts/risk/risk-meta'
import { VariantTextarea } from '@/components/locale/variant-field'

/**
 * AI 风险建议抽屉（v3-ui-next-risk-change-domains W1 · tasks 1.7，
 * spec「AI 风险识别建议审查与人工显式采纳」，RL-01 零自动执行）。
 *
 * - 打开即调用 POST /projects/:projectId/risks/ai-suggestions（等待期展示仪器感
 *   骨架屏，杜绝空态误报）；顶部常驻免责警示：「未经人工确认绝不写入正式项目」；
 * - 每张建议卡完整回显 AIMarker：置信度百分比、推断来源（自动推断/明确指认/默认）、
 *   推断原因与建议概率 / 影响度 / 缓解方案；
 * - 操作三态（逐一独立留痕，严禁批量静默采纳）：
 *   1. 直接采纳 → POST …/ai-suggestions/:batchId/accept，卡片打上已采纳标记，
 *      后续不可重复操作；
 *   2. 修改并采纳 → 就地微调概率 / 影响 / 缓解方案后「确认采纳」，
 *      载荷携带 modifiedByUser: true；
 *   3. 拒绝 → POST …/ai-suggestions/:batchId/reject，卡片移出候选队列；
 * - 采纳成功后统一失效 ['risks'] / ['risks-v2'] / ['risk-matrix'] 缓存，
 *   正式风险列表与工作台摘要即时刷新。
 */

const AI_SOURCE_LABELS: Record<string, string> = {
  inferred: '自动推断',
  explicit: '明确指认',
  default: '默认建议',
}

export interface RiskAiSuggestionDrawerProps {
  projectId: number
  open: boolean
  onClose: () => void
}

interface SuggestionView extends RiskAiSuggestion {
  /** 本地采纳标记（成功后锁定，防重复采纳） */
  accepted?: boolean
}

export function RiskAiSuggestionDrawer({ projectId, open, onClose }: RiskAiSuggestionDrawerProps) {
  const queryClient = useQueryClient()
  const openRef = React.useRef(open)
  openRef.current = open
  const [suggestions, setSuggestions] = React.useState<SuggestionView[]>([])
  const [batchId, setBatchId] = React.useState<string | null>(null)
  const [expandedEditIndex, setExpandedEditIndex] = React.useState<number | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const invalidateAll = React.useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['risks'] }),
      queryClient.invalidateQueries({ queryKey: ['risks-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
    ])
  }, [queryClient])

  const triggerMutation = useMutation({
    mutationFn: () => triggerAiSuggestions(projectId),
    onSuccess: (result) => {
      if (!openRef.current) return
      setActionError(null)
      setSuggestions((result.data?.suggestions ?? []).map((suggestion) => ({ ...suggestion })))
      setBatchId(result.data?.suggestionBatchId ?? null)
      setExpandedEditIndex(null)
    },
    onError: (error) => {
      if (!openRef.current) return
      setActionError(error instanceof Error ? error.message : 'AI 风险建议生成失败，请重试')
    },
  })

  const acceptMutation = useMutation({
    mutationFn: (payload: {
      suggestion: SuggestionView
      modified: { probability: number; impact: number; mitigation: string } | null
    }) =>
      acceptAiSuggestion(projectId, {
        title: payload.suggestion.title,
        description: payload.suggestion.description,
        category: payload.suggestion.category,
        probability: payload.modified?.probability ?? payload.suggestion.probability,
        impact: payload.modified?.impact ?? payload.suggestion.impact,
        mitigation:
          payload.modified?.mitigation.trim() === ''
            ? payload.suggestion.suggestedMitigation
            : (payload.modified?.mitigation ?? payload.suggestion.suggestedMitigation),
        aiMarker: payload.suggestion.aiMarker,
        suggestionBatchId: payload.suggestion.suggestionBatchId,
        modifiedByUser: payload.modified !== null,
      }),
    onSuccess: (_result, payload) => {
      setActionError(null)
      setExpandedEditIndex(null)
      setSuggestions((prev) =>
        prev.map((suggestion) =>
          suggestion.suggestionBatchId === payload.suggestion.suggestionBatchId &&
          suggestion.title === payload.suggestion.title
            ? { ...suggestion, accepted: true }
            : suggestion,
        ),
      )
      invalidateAll()
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '采纳 AI 建议失败，请重试')
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (suggestion: SuggestionView) =>
      rejectAiSuggestion(projectId, suggestion.suggestionBatchId),
    onSuccess: (_result, suggestion) => {
      setActionError(null)
      setExpandedEditIndex(null)
      setSuggestions((prev) =>
        prev.filter(
          (item) =>
            !(
              item.suggestionBatchId === suggestion.suggestionBatchId &&
              item.title === suggestion.title
            ),
        ),
      )
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '拒绝 AI 建议失败，请重试')
    },
  })

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // 打开抽屉 → 自动触发 AI 建议；关闭 → 复位会话状态（下次打开重新生成）
  const hasTriggeredRef = React.useRef(false)
  React.useEffect(() => {
    if (open && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true
      triggerMutation.mutate()
    }
    if (!open) {
      hasTriggeredRef.current = false
      setSuggestions([])
      setBatchId(null)
      setExpandedEditIndex(null)
      setActionError(null)
    }
  }, [open])

  if (!open) return null

  const pendingCount = suggestions.filter((suggestion) => !suggestion.accepted).length
  const acceptedCount = suggestions.length - pendingCount

  const fieldClass =
    'h-8 w-full rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nx-border-focus)] disabled:opacity-50'
  const labelClass = 'mb-1 block text-[11px] font-medium text-[var(--nx-text-secondary)]'

  return (
    <div data-risk-ai-drawer className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        data-risk-ai-scrim
        aria-label="关闭 AI 风险建议"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="AI 风险建议"
        data-risk-ai-panel
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--nx-border-hairline)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)]">
              <Sparkles className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">AI 风险建议</h3>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]">
                POST /projects/{projectId}/risks/ai-suggestions
              </p>
            </div>
          </div>
          <button
            type="button"
            data-risk-ai-close
            aria-label="关闭 AI 风险建议"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* RL-01 免责警示（常驻顶部） */}
          <div
            data-risk-ai-disclaimer
            className="flex gap-2 rounded-sm border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2.5"
          >
            <Zap
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
              aria-hidden
            />
            <p className="text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
              <span className="font-semibold text-[var(--nx-status-warning)]">
                AI 风险建议仅供决策参考
              </span>
              ：所有条目基于项目当前排程滑移与资源负荷规则推断生成。未经人工显式确认，
              <span className="font-semibold text-[var(--nx-text-primary)]">
                绝不会自动写入正式项目
              </span>
              。
            </p>
          </div>

          {actionError ? (
            <div
              role="alert"
              aria-label="AI 风险建议操作失败"
              data-risk-ai-error
              className="flex items-center justify-between gap-2 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-3 py-2"
            >
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--nx-status-danger)]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                {actionError}
              </p>
              <button
                type="button"
                data-risk-ai-retry
                onClick={() => triggerMutation.mutate()}
                disabled={triggerMutation.isPending}
                className="flex h-6 shrink-0 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-1.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-accent)] disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                重试
              </button>
            </div>
          ) : null}

          {suggestions.length > 0 ? (
            <div className="flex items-center justify-between text-[11px] text-[var(--nx-text-muted)]">
              <span data-risk-ai-summary>
                待处理 {pendingCount} 条 / 共 {suggestions.length} 条 · 已采纳 {acceptedCount} 条
              </span>
              <button
                type="button"
                data-risk-ai-retrigger
                disabled={triggerMutation.isPending}
                onClick={() => triggerMutation.mutate()}
                className="flex h-6 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                重新识别
              </button>
            </div>
          ) : null}

          {/* 触发中骨架 */}
          {triggerMutation.isPending && suggestions.length === 0 ? (
            <div
              data-risk-ai-skeleton
              role="status"
              aria-label="AI 正在生成风险建议"
              aria-busy="true"
              className="space-y-2.5"
            >
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
                />
              ))}
              <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-[var(--nx-text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                AI 正在扫描项目排程滑移与资源负荷规则…
              </p>
            </div>
          ) : null}

          {/* 建议卡片清单 */}
          {suggestions.map((suggestion, index) => {
            const tone = riskExposureTone(suggestion.probability, suggestion.impact)
            const editing = expandedEditIndex === index
            return (
              <article
                key={`${suggestion.suggestionBatchId}-${index}`}
                data-risk-ai-card
                data-risk-ai-card-accepted={suggestion.accepted || undefined}
                className={cn(
                  'rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-3.5',
                  suggestion.accepted && 'opacity-80',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        data-risk-ai-card-title
                        className="text-[13px] font-semibold text-[var(--nx-text-primary)]"
                      >
                        {suggestion.title}
                      </span>
                      <span className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)]">
                        {RISK_CATEGORY_LABELS[suggestion.category] ?? suggestion.category}
                      </span>
                      {suggestion.accepted ? (
                        <span
                          data-risk-ai-accepted
                          className="rounded-sm border border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.12)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--nx-status-success)]"
                        >
                          ✓ 已采纳
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]">
                      {suggestion.description}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--nx-text-secondary)]">
                  <span data-risk-ai-card-probability>概率 {suggestion.probability}</span>
                  <span data-risk-ai-card-impact>影响 {suggestion.impact}</span>
                  <span
                    data-risk-ai-card-score
                    className={cn(
                      'font-mono font-semibold',
                      tone === 'high'
                        ? 'text-[var(--nx-status-danger)]'
                        : tone === 'medium'
                          ? 'text-[var(--nx-status-warning)]'
                          : 'text-[var(--nx-status-success)]',
                    )}
                  >
                    敞口 {suggestion.probability * suggestion.impact}（{RISK_TONE_LABELS[tone]}）
                  </span>
                </div>

                {suggestion.suggestedMitigation ? (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--nx-text-muted)]">
                    <span className="text-[var(--nx-text-secondary)]">建议缓解：</span>
                    {suggestion.suggestedMitigation}
                  </p>
                ) : null}

                {/* AIMarker：置信度 / 来源 / 原因透明回显 */}
                <div
                  data-ai-marker
                  className="mt-2.5 rounded-sm border border-[rgba(139,92,246,0.25)] bg-[rgba(139,92,246,0.06)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--nx-text-secondary)]"
                >
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span
                      data-ai-marker-confidence
                      className="font-mono font-medium text-[var(--nx-accent)]"
                    >
                      置信度 {Math.round(suggestion.aiMarker.confidence * 100)}%
                    </span>
                    <span data-ai-marker-source>
                      来源：
                      {AI_SOURCE_LABELS[suggestion.aiMarker.source] ?? suggestion.aiMarker.source}
                    </span>
                    {suggestion.aiMarker.needsConfirmation ? (
                      <span className="text-[var(--nx-status-warning)]">需人工确认</span>
                    ) : null}
                  </p>
                  <p data-ai-marker-reason className="mt-0.5 text-[var(--nx-text-muted)]">
                    {suggestion.aiMarker.reason}
                  </p>
                </div>

                {/* 修改并采纳的内联编辑区 */}
                {editing && !suggestion.accepted ? (
                  <div
                    data-risk-ai-edit
                    className="mt-3 space-y-2.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] p-3"
                  >
                    <p className="text-[11px] font-medium text-[var(--nx-text-secondary)]">
                      在线微调后确认采纳（将携带 modifiedByUser 标记）
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor={`ai-edit-probability-${index}`} className={labelClass}>
                          发生概率
                        </label>
                        <select
                          id={`ai-edit-probability-${index}`}
                          data-risk-ai-edit-probability
                          value={suggestion.probability}
                          disabled={acceptMutation.isPending}
                          onChange={(event) => {
                            const next = Number(event.target.value)
                            setSuggestions((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, probability: next } : item,
                              ),
                            )
                          }}
                          className={fieldClass}
                        >
                          {RISK_SCALE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`ai-edit-impact-${index}`} className={labelClass}>
                          影响度
                        </label>
                        <select
                          id={`ai-edit-impact-${index}`}
                          data-risk-ai-edit-impact
                          value={suggestion.impact}
                          disabled={acceptMutation.isPending}
                          onChange={(event) => {
                            const next = Number(event.target.value)
                            setSuggestions((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, impact: next } : item,
                              ),
                            )
                          }}
                          className={fieldClass}
                        >
                          {RISK_SCALE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label htmlFor={`ai-edit-mitigation-${index}`} className={labelClass}>
                        缓解方案
                      </label>
                      {/* AI 建议的缓解方案：按简繁切换显示，改完转回简体 */}
                      <VariantTextarea
                        id={`ai-edit-mitigation-${index}`}
                        data-risk-ai-edit-mitigation
                        rows={2}
                        maxLength={5000}
                        disabled={acceptMutation.isPending}
                        value={suggestion.suggestedMitigation ?? ''}
                        onValueChange={(value) => {
                          setSuggestions((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, suggestedMitigation: value } : item,
                            ),
                          )
                        }}
                        className={`${fieldClass} h-auto resize-y py-1.5 leading-relaxed`}
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        data-risk-ai-edit-cancel
                        disabled={acceptMutation.isPending}
                        onClick={() => setExpandedEditIndex(null)}
                        className="h-7 rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
                      >
                        取消修改
                      </button>
                      <button
                        type="button"
                        data-risk-ai-edit-confirm
                        disabled={acceptMutation.isPending}
                        onClick={() =>
                          acceptMutation.mutate({
                            suggestion,
                            modified: {
                              probability: suggestion.probability,
                              impact: suggestion.impact,
                              mitigation: suggestion.suggestedMitigation,
                            },
                          })
                        }
                        className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
                      >
                        {acceptMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          <Check className="h-3 w-3" aria-hidden />
                        )}
                        确认采纳（已修改）
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* 操作三态 */}
                {!suggestion.accepted ? (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      data-risk-ai-accept
                      aria-label={`采纳建议：${suggestion.title}`}
                      disabled={acceptMutation.isPending || rejectMutation.isPending || editing}
                      onClick={() =>
                        acceptMutation.mutate({
                          suggestion,
                          modified: null,
                        })
                      }
                      className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" aria-hidden />
                      采纳
                    </button>
                    <button
                      type="button"
                      data-risk-ai-accept-modified
                      aria-label={`修改并采纳：${suggestion.title}`}
                      disabled={acceptMutation.isPending || rejectMutation.isPending}
                      onClick={() => setExpandedEditIndex(editing ? null : index)}
                      className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)] disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3" aria-hidden />
                      修改后采纳
                    </button>
                    <button
                      type="button"
                      data-risk-ai-reject
                      aria-label={`拒绝建议：${suggestion.title}`}
                      disabled={acceptMutation.isPending || rejectMutation.isPending || editing}
                      onClick={() => rejectMutation.mutate(suggestion)}
                      className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
                    >
                      <X className="h-3 w-3" aria-hidden />
                      拒绝
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-[10px] text-[var(--nx-text-muted)]">
                    该项已采纳为正式风险，禁止重复操作
                  </p>
                )}
              </article>
            )
          })}

          {/* 空态 */}
          {!triggerMutation.isPending && suggestions.length === 0 && !actionError ? (
            <div data-risk-ai-empty className="px-6 py-10 text-center">
              <Sparkles className="mx-auto mb-2 h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
              <p className="text-sm text-[var(--nx-text-secondary)]">
                {batchId === null ? '正在准备 AI 风险识别…' : '本次未识别出新的风险建议'}
              </p>
              {batchId !== null ? (
                <button
                  type="button"
                  data-risk-ai-empty-retry
                  onClick={() => triggerMutation.mutate()}
                  className="mt-3 h-7 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
                >
                  重新识别
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
          <p className="text-[10px] text-[var(--nx-text-muted)]">
            批次 {batchId ? `${batchId.slice(0, 8)}…` : '—'} · 每条操作独立审计留痕
          </p>
          <button
            type="button"
            data-risk-ai-close-footer
            onClick={onClose}
            disabled={acceptMutation.isPending || rejectMutation.isPending}
            className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
          >
            关闭
          </button>
        </footer>
      </aside>
    </div>
  )
}

export default RiskAiSuggestionDrawer
