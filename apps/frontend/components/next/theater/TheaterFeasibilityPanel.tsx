'use client'

import * as React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import type {
  ConfirmedProjectContext,
  FeasibilityAssessment,
  FeasibilityOption,
} from '@aiproj/types'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { newLiveOutputId, useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { LiveOutputPanel } from './TheaterLiveOutput'
import { FeasibilityChat, OptionCard, VerdictBadge, errorMessage } from './FeasibilityParts'

/** 评估基于用户确认的项目理解，但不带已选的决定（否则会在已改过的范围上再评估）。 */
function assessContext(): ConfirmedProjectContext | null {
  const context = useAiProjectDraftStore.getState().context
  if (!context) return null
  const { feasibilityDecision: _omit, ...rest } = context
  void _omit
  return rest
}

/** 日历提醒、矛盾、各项工作量（生成前与审查页共用的评估详情）。 */
export function FeasibilityDetails({ assessment }: { assessment: FeasibilityAssessment }) {
  const [showEstimates, setShowEstimates] = React.useState(false)
  return (
    <>
      {assessment.calendarNotices.length > 0 ? (
        <div
          data-feasibility-calendar
          className="rounded-md border border-[var(--nx-border-hairline)] p-2.5"
        >
          <p className="text-xs font-medium text-[var(--nx-text-secondary)]">日历提醒</p>
          <ul className="mt-1 list-disc pl-4 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            {assessment.calendarNotices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {assessment.contradictions.length > 0 ? (
        <div
          data-feasibility-contradictions
          className="rounded-md border border-[var(--nx-status-warning)]/50 p-2.5"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-status-warning)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            我注意到这些地方可能有矛盾或没说清
          </p>
          <ul className="mt-1 list-disc pl-4 text-xs leading-relaxed text-[var(--nx-text-secondary)]">
            {assessment.contradictions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-[var(--nx-text-muted)]">
            可以在下面直接告诉我怎么处理。
          </p>
        </div>
      ) : null}

      {assessment.estimates.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={showEstimates}
            onClick={() => setShowEstimates((value) => !value)}
            className="inline-flex items-center gap-1 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showEstimates ? '' : '-rotate-90'}`}
              aria-hidden
            />
            各项工作量（{assessment.estimates.length} 项）
          </button>
          {showEstimates ? (
            <table className="mt-2 w-full text-left text-xs text-[var(--nx-text-secondary)]">
              <thead className="text-[var(--nx-text-muted)]">
                <tr>
                  <th className="py-1 font-normal">能力</th>
                  <th className="py-1 font-normal">人日</th>
                  <th className="py-1 font-normal">可放第二期</th>
                </tr>
              </thead>
              <tbody>
                {assessment.estimates.map((estimate) => (
                  <tr
                    key={estimate.capabilityId}
                    className="border-t border-[var(--nx-border-hairline)]"
                  >
                    <td className="py-1 pr-2 text-[var(--nx-text-primary)]" title={estimate.reason}>
                      {estimate.name}
                    </td>
                    <td className="py-1 pr-2 font-mono">
                      {estimate.low === estimate.high
                        ? estimate.low
                        : `${estimate.low}–${estimate.high}`}
                    </td>
                    <td className="py-1">{estimate.deferrable ? '可以' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/**
 * 生成前「能否如期完成」（2026-09-28，检查点 A + B）。
 *
 * 项目理解确认后自动评估一次：模型估每项能力的工作量、指出矛盾，程序算产能、日历与各方案的日期 / 人数。
 * 用户可以直接选方案，也可以用自己的话商量（模型回应并提方案，程序核算）。选定的决定写进
 * context.feasibilityDecision，点「开始生成」时由服务端套用；不选就照原计划。生成过程中不再打断。
 */
export function TheaterFeasibilityPanel() {
  const understandingStatus = useAiProjectDraftStore((state) => state.understandingStatus)
  const assessment = useAiProjectDraftStore((state) => state.feasibilityAssessment)
  const chat = useAiProjectDraftStore((state) => state.feasibilityChat)
  const decision = useAiProjectDraftStore((state) => state.context?.feasibilityDecision ?? null)
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = React.useState<string | null>(null)
  const [liveId, setLiveId] = React.useState<string | null>(null)
  const live = useLiveOutputLanes(liveId)
  const requestRef = React.useRef(0)

  const run = React.useCallback(async () => {
    const context = assessContext()
    if (!context) return
    const requestId = ++requestRef.current
    const id = newLiveOutputId()
    setLiveId(id)
    setStatus('loading')
    setError(null)
    try {
      const selection = useAiProjectDraftStore.getState().modelSelection
      const result = await aiDraftApi.feasibility({
        context,
        ...(selection ?? {}),
        liveOutputId: id,
      })
      if (requestId !== requestRef.current) return
      useAiProjectDraftStore.getState().setFeasibilityAssessment(result.assessment)
      setStatus('idle')
    } catch (failure) {
      if (requestId !== requestRef.current) return
      setStatus('error')
      setError(errorMessage(failure, '评估没有完成'))
    }
  }, [])

  React.useEffect(() => {
    if (understandingStatus === 'confirmed' && !assessment && status === 'idle') void run()
  }, [understandingStatus, assessment, status, run])

  if (understandingStatus !== 'confirmed') return null

  const choose = (option: FeasibilityOption) =>
    useAiProjectDraftStore
      .getState()
      .setFeasibilityDecision({ ...option.decision, decidedAt: new Date().toISOString() })

  return (
    <section
      data-theater-feasibility
      aria-label="能否如期完成"
      className="mt-6 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]/60 p-4"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--nx-text-primary)]">
          <CalendarClock className="h-4 w-4 text-[var(--nx-accent)]" aria-hidden />
          能否如期完成
          {assessment ? <VerdictBadge verdict={assessment.verdict} /> : null}
        </h3>
        {assessment && status !== 'loading' ? (
          <button
            type="button"
            onClick={() => void run()}
            className="inline-flex items-center gap-1 text-xs text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重新评估
          </button>
        ) : null}
      </header>
      <p className="mt-1 text-xs text-[var(--nx-text-muted)]">
        生成前先估一下：工作量由 AI
        估，工作日、产能与各方案的日期由程序算。选不选都可以开始生成，生成过程中不会再打断你。
      </p>

      {status === 'loading' ? (
        <div className="mt-3">
          <p className="flex items-center gap-2 text-sm text-[var(--nx-text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--nx-accent)]" aria-hidden />
            正在估算每项能力的工作量、核对日历与团队产能（约半分钟）…
          </p>
          <div className="mt-2">
            <LiveOutputPanel
              compact
              lanes={live.lanes}
              totalChars={live.totalChars}
              title="模型实时输出"
              emptyText="正在连接模型…"
            />
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--nx-status-danger)]">
          {error}
          <button type="button" onClick={() => void run()} className="text-xs underline">
            重试
          </button>
        </p>
      ) : null}

      {assessment && status !== 'loading' ? (
        <div className="mt-3 flex flex-col gap-3">
          <p
            data-feasibility-summary
            className="text-sm leading-relaxed text-[var(--nx-text-primary)]"
          >
            {assessment.summary}
          </p>
          <FeasibilityDetails assessment={assessment} />
          <div role="radiogroup" aria-label="怎么处理" className="flex flex-col gap-2">
            {assessment.options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                selected={decision?.summary === option.decision.summary}
                onChoose={() => choose(option)}
              />
            ))}
          </div>
          {decision ? (
            <p
              data-feasibility-decision
              className="flex flex-wrap items-center gap-2 text-xs text-[var(--nx-text-secondary)]"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-[var(--nx-accent)]" aria-hidden />
              已选：{decision.summary}（开始生成时套用）
              <button
                type="button"
                onClick={() => useAiProjectDraftStore.getState().setFeasibilityDecision(null)}
                className="underline"
              >
                撤销
              </button>
            </p>
          ) : null}
          <FeasibilityChat
            assessment={assessment}
            history={chat}
            onAppend={(turn) => useAiProjectDraftStore.getState().appendFeasibilityChat(turn)}
            onAdopt={choose}
            adoptedSummary={decision?.summary ?? null}
          />
        </div>
      ) : null}
    </section>
  )
}
