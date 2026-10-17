'use client'

import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  FileSearch,
  Loader2,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react'
import { acceptCandidate, evaluateCandidates, rejectCandidate } from '@/lib/api/risks-v2'
import type { RiskLevel, RiskSignalCandidate } from '@/lib/api/risks-v2'
import { useDialogA11y } from '@/hooks/use-dialog-a11y'
import { cn } from '@/lib/utils'

/**
 * 基于规则识别的风险候选清单（v3-ui-next-risk-change-domains W1 · tasks 1.3）。
 *
 * - 触发「规则评估」（POST /projects/:id/risks/evaluate-candidates，门禁由父层注入
 *   canEvaluate），将规则引擎识别的 RiskSignalCandidate 以清单呈现；
 * - 每条候选展示严重度、规则 ID 与版本、置信度、有效期与可展开的证据链；
 * - 采纳经确认弹窗（展示推荐行动 / 严重度 / 置信度 / 证据链）后调用
 *   POST /candidates/:id/accept 转为正式风险，条目移出队列；
 * - 拒绝直接调用 POST /candidates/:id/reject 并移出队列（后端记录审计）；
 * - 写成功统一失效 ['risks'] / ['risks-v2'] / ['risk-matrix'] 缓存
 *   （底册 / 摘要 / 矩阵计数联动刷新，RL-04）。
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

const LEVEL_CHIP: Record<RiskLevel, string> = {
  low: 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.12)] text-[var(--nx-status-success)]',
  medium:
    'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.12)] text-[var(--nx-status-warning)]',
  high: 'border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.14)] text-[var(--nx-status-danger)]',
  critical:
    'border-[rgba(239,68,68,0.55)] bg-[rgba(239,68,68,0.18)] text-[var(--nx-status-danger)]',
}

/** 确定性日期展示（UTC 日历日）。 */
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export interface RiskCandidateListProps {
  projectId: number
  /** 是否允许触发规则评估与采纳/拒绝（由父层按权限注入）。 */
  canEvaluate: boolean
}

export function RiskCandidateList({ projectId, canEvaluate }: RiskCandidateListProps) {
  const queryClient = useQueryClient()
  const [items, setItems] = React.useState<RiskSignalCandidate[]>([])
  const [expandedEvidenceId, setExpandedEvidenceId] = React.useState<number | null>(null)
  const [acceptTarget, setAcceptTarget] = React.useState<RiskSignalCandidate | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const invalidateAll = React.useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['risks'] }),
      queryClient.invalidateQueries({ queryKey: ['risks-v2'] }),
      queryClient.invalidateQueries({ queryKey: ['risk-matrix'] }),
    ])
  }, [queryClient])

  const evaluateMutation = useMutation({
    mutationFn: () => evaluateCandidates(projectId),
    onSuccess: (result) => {
      setActionError(null)
      setItems(result.data ?? [])
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '规则评估失败，请重试')
    },
  })

  const acceptMutation = useMutation({
    mutationFn: (candidateId: number) => acceptCandidate(projectId, candidateId),
    onSuccess: () => {
      setItems((prev) => prev.filter((item) => item.id !== acceptTarget?.id))
      setAcceptTarget(null)
      setActionError(null)
      invalidateAll()
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '采纳候选失败，请重试')
      setAcceptTarget(null)
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (candidateId: number) => rejectCandidate(projectId, candidateId),
    onSuccess: (_result, candidateId) => {
      setItems((prev) => prev.filter((item) => item.id !== candidateId))
      setActionError(null)
      invalidateAll()
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : '拒绝候选失败，请重试')
    },
  })

  const anyPending =
    evaluateMutation.isPending || acceptMutation.isPending || rejectMutation.isPending

  // 采纳确认弹层：Escape 关闭；采纳请求在途时拒绝关闭（与弹层「取消」按钮 disabled 同判据）。
  const acceptDialogRef = React.useRef<HTMLDivElement | null>(null)
  useDialogA11y({
    ref: acceptDialogRef,
    open: acceptTarget !== null,
    onClose: () => setAcceptTarget(null),
    canClose: () => !acceptMutation.isPending,
  })

  const handleAcceptConfirm = () => {
    if (!acceptTarget) return
    acceptMutation.mutate(acceptTarget.id)
  }

  const pendingCandidates = items.filter((item) => item.status === 'pending')

  return (
    <section
      data-risk-candidate-list
      aria-busy={evaluateMutation.isPending}
      className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--nx-border-hairline)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-3.5 w-3.5 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-xs font-semibold text-[var(--nx-text-primary)]">规则风险候选</h3>
          <span
            data-risk-candidates-count
            className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-muted)]"
          >
            {pendingCandidates.length} 条
          </span>
        </div>
        {canEvaluate ? (
          <button
            type="button"
            data-risk-candidates-evaluate
            disabled={anyPending}
            onClick={() => evaluateMutation.mutate()}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2.5 text-[11px] font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
          >
            {evaluateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <TrendingUp className="h-3 w-3" aria-hidden />
            )}
            {evaluateMutation.isPending ? '评估中…' : '规则评估'}
          </button>
        ) : null}
      </header>

      {actionError ? (
        <p
          role="alert"
          aria-label="风险候选操作失败"
          data-risk-candidates-error
          className="mx-4 mt-3 rounded-sm border border-[var(--nx-status-danger)] bg-[rgba(239,68,68,0.1)] px-2.5 py-1.5 text-[11px] text-[var(--nx-status-danger)]"
        >
          {actionError}
        </p>
      ) : null}

      {evaluateMutation.isPending ? (
        <div
          data-risk-candidates-skeleton
          role="status"
          aria-label="正在评估规则风险候选"
          aria-busy="true"
          className="space-y-2 p-4"
        >
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]"
            />
          ))}
          <p className="pt-1 text-center text-[11px] text-[var(--nx-text-muted)]">
            规则引擎正在扫描工期延误、关键路径滑移与资源负荷信号…
          </p>
        </div>
      ) : pendingCandidates.length === 0 ? (
        <div data-risk-candidates-empty className="px-6 py-8 text-center">
          <FileSearch className="mx-auto mb-2 h-6 w-6 text-[var(--nx-text-muted)]" aria-hidden />
          <p className="text-sm text-[var(--nx-text-secondary)]">尚未识别出规则风险候选</p>
          <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
            触发「规则评估」扫描项目工期延误、关键路径滑移与资源负荷信号
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--nx-border-hairline)]/60">
          {pendingCandidates.map((candidate) => {
            const severity = candidate.severity as RiskLevel
            const expanded = expandedEvidenceId === candidate.id
            return (
              <li key={candidate.id} data-risk-candidate={candidate.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-risk-candidate-severity
                        className={cn(
                          'rounded-sm border px-1.5 py-0.5 text-[10px] font-medium',
                          LEVEL_CHIP[severity] ?? LEVEL_CHIP.medium,
                        )}
                      >
                        {LEVEL_LABELS[severity] ?? severity}风险候选
                      </span>
                      <span
                        data-risk-candidate-rule
                        className="rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-text-secondary)]"
                      >
                        {candidate.ruleId} · v{candidate.ruleVersion}
                      </span>
                    </div>
                    <p
                      data-risk-candidate-action
                      className="mt-1.5 text-[13px] font-medium leading-snug text-[var(--nx-text-primary)]"
                    >
                      {candidate.recommendedAction}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--nx-text-muted)]">
                      <span
                        data-risk-candidate-confidence
                        className="font-mono text-[var(--nx-accent)]"
                      >
                        置信度 {Math.round(candidate.confidence * 100)}%
                      </span>
                      <span>规则版本 v{candidate.ruleVersion}</span>
                      <span>有效期至 {formatDate(candidate.expiresAt)}</span>
                      {candidate.evidence.length > 0 ? (
                        <button
                          type="button"
                          data-risk-candidate-evidence-toggle
                          aria-expanded={expanded}
                          onClick={() => setExpandedEvidenceId(expanded ? null : candidate.id)}
                          className="flex items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]"
                        >
                          <Braces className="h-3 w-3" aria-hidden />
                          {expanded ? '收起证据链' : `查看证据链（${candidate.evidence.length}）`}
                        </button>
                      ) : null}
                    </div>
                    {expanded ? (
                      <ul
                        data-risk-candidate-evidence
                        className="mt-2 space-y-1.5 rounded-sm border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2.5"
                      >
                        {candidate.evidence.map((evidence, index) => (
                          <li key={`${evidence.id}-${index}`} className="flex gap-2 text-[11px]">
                            <span className="shrink-0 font-mono text-[10px] text-[var(--nx-text-muted)]">
                              [{evidence.type}]
                            </span>
                            <span className="min-w-0 text-[var(--nx-text-secondary)]">
                              <span className="font-medium text-[var(--nx-text-primary)]">
                                {evidence.title}
                              </span>
                              {evidence.detail ? (
                                <span className="text-[var(--nx-text-muted)]">
                                  {' '}
                                  · {evidence.detail}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      data-risk-candidate-accept
                      aria-label={`采纳候选：${candidate.recommendedAction}`}
                      disabled={anyPending}
                      onClick={() => {
                        setActionError(null)
                        setAcceptTarget(candidate)
                      }}
                      className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-2 text-[11px] text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                      采纳
                    </button>
                    <button
                      type="button"
                      data-risk-candidate-reject
                      aria-label={`拒绝候选：${candidate.recommendedAction}`}
                      disabled={anyPending}
                      onClick={() => {
                        setActionError(null)
                        rejectMutation.mutate(candidate.id)
                      }}
                      className="flex h-7 items-center gap-1 rounded-sm border border-[var(--nx-border-hairline)] px-2 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-status-danger)] hover:text-[var(--nx-status-danger)] disabled:opacity-50"
                    >
                      {rejectMutation.isPending && rejectMutation.variables === candidate.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <X className="h-3 w-3" aria-hidden />
                      )}
                      拒绝
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* 采纳确认弹窗（RL-01：候选转正式风险必须人工确认） */}
      {acceptTarget ? (
        <div data-risk-candidate-confirm-overlay className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            aria-label="关闭采纳确认弹窗"
            tabIndex={-1}
            onClick={() => setAcceptTarget(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认采纳风险候选"
            data-risk-candidate-confirm
            ref={acceptDialogRef}
            tabIndex={-1}
            className="absolute left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] shadow-[0_0_48px_rgba(0,0,0,0.5)]"
          >
            <header className="border-b border-[var(--nx-border-hairline)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
                确认采纳风险候选
              </h3>
              <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
                采纳后将调用既有端点自动创建正式风险记录，请先核对以下内容
              </p>
            </header>
            <div className="max-h-72 space-y-3 overflow-y-auto px-5 py-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
                  推荐行动
                </p>
                <p
                  data-risk-candidate-confirm-action
                  className="mt-0.5 text-[13px] text-[var(--nx-text-primary)]"
                >
                  {acceptTarget.recommendedAction}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--nx-text-secondary)]">
                <span>
                  严重度：
                  <span
                    className={cn(
                      'font-medium',
                      LEVEL_TEXT[acceptTarget.severity as RiskLevel] ??
                        'text-[var(--nx-text-secondary)]',
                    )}
                  >
                    {LEVEL_LABELS[acceptTarget.severity as RiskLevel] ?? acceptTarget.severity}
                  </span>
                </span>
                <span aria-hidden>·</span>
                <span>
                  规则：{acceptTarget.ruleId} v{acceptTarget.ruleVersion}
                </span>
                <span aria-hidden>·</span>
                <span data-risk-candidate-confirm-confidence>
                  置信度 {Math.round(acceptTarget.confidence * 100)}%
                </span>
              </div>
              {acceptTarget.evidence.length > 0 ? (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-muted)]">
                    证据链
                  </p>
                  <ul className="mt-1 space-y-1 text-[11px] text-[var(--nx-text-secondary)]">
                    {acceptTarget.evidence.map((evidence, index) => (
                      <li key={`${evidence.id}-${index}`}>
                        <span className="font-mono text-[10px] text-[var(--nx-text-muted)]">
                          [{evidence.type}]
                        </span>{' '}
                        {evidence.title}
                        {evidence.detail ? (
                          <span className="text-[var(--nx-text-muted)]"> · {evidence.detail}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[var(--nx-border-hairline)] px-5 py-3">
              <button
                type="button"
                data-risk-candidate-confirm-cancel
                onClick={() => setAcceptTarget(null)}
                disabled={acceptMutation.isPending}
                className="h-9 rounded-md border border-[var(--nx-border-hairline)] px-4 text-xs text-[var(--nx-text-secondary)] transition-colors hover:text-[var(--nx-text-primary)] disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-risk-candidate-confirm-ok
                onClick={handleAcceptConfirm}
                disabled={acceptMutation.isPending}
                className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-space-surface)] px-4 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)] disabled:opacity-50"
              >
                {acceptMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                )}
                确认采纳
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* 无候选时的辅助告警（评估结果被全部处理后的提示） */}
      {items.length > 0 && pendingCandidates.length === 0 && !evaluateMutation.isPending ? (
        <p
          data-risk-candidates-done
          className="flex items-center gap-1.5 border-t border-[var(--nx-border-hairline)]/60 px-4 py-2.5 text-[11px] text-[var(--nx-text-muted)]"
        >
          <AlertTriangle className="h-3 w-3 text-[var(--nx-status-warning)]" aria-hidden />
          本轮候选已全部处理，可再次触发规则评估刷新
        </p>
      ) : null}
    </section>
  )
}

export default RiskCandidateList
