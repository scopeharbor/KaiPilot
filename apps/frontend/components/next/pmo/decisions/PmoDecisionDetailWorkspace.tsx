'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Gavel, Sparkles } from 'lucide-react'
import { useImmersionTier } from '@/hooks/use-immersion-tier'
import { usePermissions } from '@/hooks/use-permissions'
import {
  isNotFoundError,
  ProjectSpaceErrorView,
} from '@/components/next/project-space/ProjectSpaceContainer'
import { useDecisionCase } from '@/hooks/use-decision-workbench'
import { cn } from '@/lib/utils'
import { isPmoDecisionCaseTerminal, type PmoDecisionCaseStatus } from '@aiproj/types'
import { PMO_DECISION_CASE_STATUS_META } from './PmoDecisionCaseTable'
import { PmoDecisionOptionsPanel } from './PmoDecisionOptionsPanel'
import { PmoDecisionEvidencePanel } from './PmoDecisionEvidencePanel'
import { PmoDecisionOutcomePanel } from './PmoDecisionOutcomePanel'
import { PmoDecisionAiNarrativeModal } from './PmoDecisionAiNarrativeModal'

/**
 * PMO 决策议题详情工作台（v3-ui-next-pmo-domain W6 · tasks 6.3，
 * spec「决策工作台详情与人工结论闭环」）。
 *
 * - 数据 100% 复用 useDecision* 既有 hooks（RL-04 缓存同源；解包语义已在 lib/api 层
 *   归一为「apiFetchEnvelope → 显式 .data」，本层无二次解包）；
 * - 加载骨架（aria-busy）/ 接口 404 中性空态 / 错误重试三态在本容器闭环：
 *   API 404 与跨组织一律渲染中性「议题不存在」态（RL-05），文案零区分线索；
 * - 元数据头 + 生命周期时间线（draft → collecting-evidence → ready-for-review →
 *   under-review → decided/deferred/superseded，状态机标签与文字双通道）；
 * - 方案/立场/对比（PmoDecisionOptionsPanel）、证据（PmoDecisionEvidencePanel）、
 *   readiness→结论→交接（PmoDecisionOutcomePanel）、AI 叙述浮层
 *   （PmoDecisionAiNarrativeModal，request_ai 门禁 + 显式触发）按区装配；
 * - 终态（decided/deferred/superseded）标记只读归档，写面板内部按终态隐藏写控件；
 * - 操作级权限：recordPosition 仅需 view（后端 authorizePosition 同语义）——
 *   维护 manage / 结论 decide / 交接 handoff / AI 叙述 request_ai 分级显隐。
 */

const PRE_TERMINAL_STEPS: readonly PmoDecisionCaseStatus[] = [
  'draft',
  'collecting-evidence',
  'ready-for-review',
  'under-review',
]

const TERMINAL_STEPS: readonly PmoDecisionCaseStatus[] = ['decided', 'deferred', 'superseded']

function DecisionTimeline({ status }: { status: PmoDecisionCaseStatus }) {
  const terminal = isPmoDecisionCaseTerminal(status)
  const currentIndex = terminal ? PRE_TERMINAL_STEPS.length : PRE_TERMINAL_STEPS.indexOf(status)

  function stepState(step: PmoDecisionCaseStatus, index: number): 'done' | 'current' | 'pending' {
    if (index < currentIndex || terminal) return 'done'
    if (index === currentIndex && step === status) return 'current'
    if (step === status) return 'current'
    return 'pending'
  }

  return (
    <ol
      data-decision-timeline
      aria-label={`议题生命周期：当前 ${PMO_DECISION_CASE_STATUS_META[status].label}`}
      className="flex flex-wrap items-center gap-1.5"
    >
      {PRE_TERMINAL_STEPS.map((step, index) => {
        const state = stepState(step, index)
        const meta = PMO_DECISION_CASE_STATUS_META[step]
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              data-decision-timeline-step={state}
              data-step-status={step}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-[4px] border px-2 text-xs',
                state === 'pending' && 'opacity-45',
              )}
              style={
                state === 'pending'
                  ? undefined
                  : { color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }
              }
            >
              {state === 'done' ? '✓' : state === 'current' ? '▶' : null}
              {meta.label}
            </span>
            {index < PRE_TERMINAL_STEPS.length - 1 ? (
              <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
                →
              </span>
            ) : null}
          </li>
        )
      })}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
          →
        </span>
        <span
          data-decision-timeline-step={terminal ? 'done' : 'pending'}
          aria-hidden
          className={cn(
            'inline-flex h-6 items-center rounded-[4px] border px-2 text-xs',
            terminal ? '' : 'opacity-45',
          )}
          style={
            terminal
              ? {
                  color: PMO_DECISION_CASE_STATUS_META[status].color,
                  backgroundColor: PMO_DECISION_CASE_STATUS_META[status].bg,
                  borderColor: PMO_DECISION_CASE_STATUS_META[status].border,
                }
              : undefined
          }
        >
          {terminal ? '✓ ' : ''}
          {PMO_DECISION_CASE_STATUS_META[status].label}
        </span>
        {terminal ? (
          <span
            data-decision-timeline-step="current"
            className="text-[10px] text-[var(--nx-text-muted)]"
          >
            （终态只读归档）
          </span>
        ) : null}
        {!terminal ? (
          <>
            <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
              /
            </span>
            {TERMINAL_STEPS.filter((step) => step !== status).map((step, index) => (
              <React.Fragment key={step}>
                {index > 0 ? (
                  <span aria-hidden className="text-[10px] text-[var(--nx-text-muted)]">
                    ·
                  </span>
                ) : null}
                <span
                  data-decision-timeline-step="pending"
                  data-step-status={step}
                  className="inline-flex h-6 items-center rounded-[4px] border border-[var(--nx-border-hairline)] px-2 text-xs text-[var(--nx-text-muted)] opacity-60"
                >
                  {PMO_DECISION_CASE_STATUS_META[step].label}
                </span>
              </React.Fragment>
            ))}
          </>
        ) : null}
      </li>
    </ol>
  )
}

export interface PmoDecisionDetailWorkspaceProps {
  decisionId: number
}

export function PmoDecisionDetailWorkspace({ decisionId }: PmoDecisionDetailWorkspaceProps) {
  const router = useRouter()
  const tier = useImmersionTier()
  const { canAny } = usePermissions()
  const caseQuery = useDecisionCase(decisionId)

  const [aiOpen, setAiOpen] = React.useState(false)

  const decision = caseQuery.data
  const isTerminal = decision !== undefined && isPmoDecisionCaseTerminal(decision.status)

  if (caseQuery.isPending) {
    return (
      <div
        data-pmo-decision-detail-skeleton
        role="status"
        aria-label="决策议题加载中"
        aria-busy="true"
        className="flex flex-col gap-4"
      >
        <div className="h-9 w-2/5 animate-pulse rounded-md bg-[var(--nx-bg-1)]" />
        <div className="h-28 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
        <div className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
        <div className="h-40 animate-pulse rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)]" />
      </div>
    )
  }

  if (caseQuery.isError || decision === undefined) {
    if (isNotFoundError(caseQuery.error)) {
      return (
        <div
          data-pmo-decision-not-found
          role="status"
          aria-label="议题不存在"
          className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-10 text-center"
        >
          <Gavel className="h-8 w-8 text-[var(--nx-text-muted)]" aria-hidden />
          <h3 className="text-base font-medium text-[var(--nx-text-primary)]">议题不存在</h3>
          <p className="text-xs leading-relaxed text-[var(--nx-text-muted)]">
            该决策议题不存在或已下线。
          </p>
          <button
            type="button"
            data-pmo-decision-back-queue
            onClick={() => router.push('/next/pmo/decisions')}
            className="inline-flex h-9 items-center justify-center rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-workspace-surface)] px-4 text-sm text-[var(--nx-text-primary)] transition-colors hover:border-[var(--nx-accent)]"
          >
            返回决策队列
          </button>
        </div>
      )
    }
    return (
      <ProjectSpaceErrorView
        onRetry={() => void caseQuery.refetch()}
        onBackHome={() => router.push('/next/pmo/decisions')}
      />
    )
  }

  const canDecide = canAny(['pmo_decision:decide'])
  const canManage = canAny(['pmo_decision:manage'])
  const canHandoff = canAny(['pmo_decision:handoff'])
  const canRequestAi = canAny(['pmo_decision:request_ai'])

  return (
    <div
      data-pmo-decision-detail-workspace
      className={cn(
        'flex min-h-[70vh] flex-col gap-4 rounded-xl border border-[var(--nx-border-hairline)] p-4 md:p-5',
        tier === 'precise'
          ? 'bg-[var(--nx-workspace-bg)]'
          : 'nx-space-atmosphere bg-[var(--nx-space-bg)]',
      )}
    >
      {/* 页头动线 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-pmo-decision-back-home
            aria-label="返回角色首页"
            onClick={() => router.push('/next')}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            返回角色首页
          </button>
          <button
            type="button"
            data-pmo-decision-back-queue
            onClick={() => router.push('/next/pmo/decisions')}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]"
          >
            返回决策队列
          </button>
        </div>
        {canRequestAi ? (
          <button
            type="button"
            data-pmo-decision-ai-open
            onClick={() => setAiOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-[var(--nx-border-focus)] bg-[var(--nx-bg-0)] px-3 text-xs font-medium text-[var(--nx-accent)] transition-colors hover:border-[var(--nx-accent)]"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            生成 AI 叙述
          </button>
        ) : null}
      </header>

      {/* 元数据头 + 生命周期时间线 */}
      <section
        data-pmo-decision-meta
        className="flex flex-col gap-3 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-surface)] p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                data-pmo-decision-title
                className="text-lg font-semibold leading-snug text-[var(--nx-text-primary)]"
              >
                {decision.title}
              </h2>
              <span
                className={cn(
                  'inline-flex h-6 items-center rounded-[4px] border px-2 text-xs font-medium',
                  isTerminal && 'opacity-90',
                )}
                data-case-status={decision.status}
                style={{
                  color: PMO_DECISION_CASE_STATUS_META[decision.status].color,
                  backgroundColor: PMO_DECISION_CASE_STATUS_META[decision.status].bg,
                  borderColor: PMO_DECISION_CASE_STATUS_META[decision.status].border,
                }}
              >
                {PMO_DECISION_CASE_STATUS_META[decision.status].label}
              </span>
              <span className="font-mono text-xs text-[var(--nx-text-muted)]">
                #{decision.id} · r{decision.revision}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--nx-text-secondary)]">
              {decision.decisionQuestion}
            </p>
            {decision.scopeSummary ? (
              <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
                范围：{decision.scopeSummary}
              </p>
            ) : null}
          </div>
          <dl
            data-pmo-decision-meta-facts
            className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-[var(--nx-text-muted)] max-sm:hidden"
          >
            <div>
              <dt className="inline">负责人</dt>
              <dd className="ml-1 inline text-[var(--nx-text-secondary)]">#{decision.ownerId}</dd>
            </div>
            <div>
              <dt className="inline">截止</dt>
              <dd className="ml-1 inline text-[var(--nx-text-secondary)]">
                {decision.dueDate ? decision.dueDate.slice(0, 10) : '—'}
              </dd>
            </div>
            <div>
              <dt className="inline">更新时间</dt>
              <dd className="ml-1 inline text-[var(--nx-text-secondary)]">
                {decision.updatedAt.slice(0, 10)}
              </dd>
            </div>
            <div>
              <dt className="inline">记录者</dt>
              <dd className="ml-1 inline text-[var(--nx-text-secondary)]">#{decision.updatedBy}</dd>
            </div>
          </dl>
        </div>
        <DecisionTimeline status={decision.status} />
        {decision.supersededByCaseId ? (
          <p
            data-pmo-decision-superseded-by
            role="note"
            className="flex items-start gap-2 rounded-sm border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs leading-relaxed text-[var(--nx-text-secondary)]"
          >
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--nx-status-warning)]"
              aria-hidden
            />
            本议题已被议题 #{decision.supersededByCaseId} 取代。
          </p>
        ) : null}
      </section>

      {/* 面板装配 */}
      <PmoDecisionEvidencePanel
        decisionId={decisionId}
        canManage={canManage}
        isTerminal={isTerminal}
      />
      <PmoDecisionOptionsPanel
        decisionId={decisionId}
        caseRevision={decision.revision}
        isTerminal={isTerminal}
      />
      <PmoDecisionOutcomePanel
        decisionId={decisionId}
        caseStatus={decision.status}
        caseRevision={decision.revision}
        canDecide={canDecide}
        canHandoff={canHandoff}
      />

      {/* AI 叙述浮层（显式触发；只读辅助） */}
      <PmoDecisionAiNarrativeModal decisionId={decisionId} open={aiOpen} onOpenChange={setAiOpen} />
    </div>
  )
}

export default PmoDecisionDetailWorkspace
