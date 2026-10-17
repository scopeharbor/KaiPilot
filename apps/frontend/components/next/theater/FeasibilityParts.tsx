'use client'

import * as React from 'react'
import { Loader2, MessageSquare, Send } from 'lucide-react'
import type {
  FeasibilityAssessment,
  FeasibilityNegotiationTurn,
  FeasibilityOption,
} from '@aiproj/types'
import { aiDraftApi } from '@/lib/api/ai-draft'
import { newLiveOutputId, useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { LiveOutputPanel } from './TheaterLiveOutput'

export const FEASIBILITY_VERDICT: Record<
  FeasibilityAssessment['verdict'],
  { label: string; token: string }
> = {
  fits: { label: '做得完', token: 'var(--nx-status-success, var(--nx-accent))' },
  tight: { label: '很紧', token: 'var(--nx-status-warning)' },
  over: { label: '会超期', token: 'var(--nx-status-danger)' },
  early: { label: '可以提前', token: 'var(--nx-accent)' },
  unknown: { label: '无法判断', token: 'var(--nx-text-muted)' },
}

export function VerdictBadge({ verdict }: { verdict: FeasibilityAssessment['verdict'] }) {
  const meta = FEASIBILITY_VERDICT[verdict]
  return (
    <span
      data-feasibility-verdict={verdict}
      className="rounded border px-1.5 py-0.5 text-[11px] font-normal"
      style={{ color: meta.token, borderColor: meta.token }}
    >
      {meta.label}
    </span>
  )
}

export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}

export function OptionCard({
  option,
  selected,
  onChoose,
  chooseLabel = '选这个',
  busy,
}: {
  option: FeasibilityOption
  selected: boolean
  onChoose: () => void
  chooseLabel?: string
  busy?: boolean
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      data-feasibility-option={option.kind}
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 ${
        selected
          ? 'border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10'
          : 'border-[var(--nx-border-hairline)]'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm text-[var(--nx-text-primary)]">
          {option.label}
          {option.recommended ? (
            <span className="ml-2 rounded border border-[var(--nx-accent)] px-1 text-[10px] text-[var(--nx-accent)]">
              建议
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-[var(--nx-text-secondary)]">{option.detail}</p>
      </div>
      <button
        type="button"
        onClick={onChoose}
        disabled={selected || busy}
        className="shrink-0 rounded border border-[var(--nx-border-focus)] px-2 py-1 text-xs text-[var(--nx-accent)] disabled:cursor-default disabled:opacity-60"
      >
        {selected ? '已选' : chooseLabel}
      </button>
    </div>
  )
}

/**
 * 「用你自己的话商量」：用户说想法 → 模型回应并提方案（程序核算数字）→ 用户点「就这样」才采用。
 * 生成前（就绪页）与生成后（审查页）共用；对话记录由调用方保存。
 */
export function FeasibilityChat({
  assessment,
  history,
  onAppend,
  onAdopt,
  adoptedSummary,
  adoptLabel = '就这样',
  placeholder = '例如：老板要求 11 月底一定上线，但商城可以晚点做；或者：能不能只加一个前端？',
  draftId,
}: {
  assessment: FeasibilityAssessment
  history: FeasibilityNegotiationTurn[]
  onAppend: (turn: FeasibilityNegotiationTurn) => void
  onAdopt: (option: FeasibilityOption) => void
  adoptedSummary?: string | null
  adoptLabel?: string
  placeholder?: string
  /** 审查页：带上草案编号，方案按这份草案真实重排核算。 */
  draftId?: string
}) {
  const [message, setMessage] = React.useState('')
  const [replying, setReplying] = React.useState(false)
  const [liveId, setLiveId] = React.useState<string | null>(null)
  const live = useLiveOutputLanes(liveId)
  const [proposal, setProposal] = React.useState<FeasibilityOption | null>(null)

  const send = async () => {
    const text = message.trim()
    if (!text || replying) return
    const before = history
    onAppend({ role: 'user', text })
    setMessage('')
    setReplying(true)
    setProposal(null)
    const id = newLiveOutputId()
    setLiveId(id)
    try {
      const selection = useAiProjectDraftStore.getState().modelSelection
      const result = await aiDraftApi.negotiateFeasibility({
        assessment,
        history: before,
        message: text,
        ...(selection ?? {}),
        liveOutputId: id,
        ...(draftId ? { draftId } : {}),
      })
      onAppend({ role: 'assistant', text: result.reply })
      setProposal(result.proposal)
    } catch (failure) {
      onAppend({
        role: 'assistant',
        text: errorMessage(failure, '这次没有回应成功，请再说一次，或直接选上面的方案。'),
      })
    } finally {
      setReplying(false)
    }
  }

  return (
    <div className="rounded-md border border-[var(--nx-border-hairline)] p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--nx-text-secondary)]">
        <MessageSquare className="h-3.5 w-3.5" aria-hidden />
        用你自己的话商量
      </p>
      {history.length > 0 ? (
        <ol data-feasibility-chat className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed">
          {history.map((turn, index) => (
            <li
              key={index}
              className={
                turn.role === 'user'
                  ? 'self-end rounded-md bg-[var(--nx-accent)]/10 px-2 py-1 text-[var(--nx-text-primary)]'
                  : 'rounded-md bg-[var(--nx-bg-0)] px-2 py-1 text-[var(--nx-text-secondary)]'
              }
            >
              {turn.text}
            </li>
          ))}
        </ol>
      ) : null}
      {replying ? (
        <div className="mt-2">
          <LiveOutputPanel
            compact
            lanes={live.lanes}
            totalChars={live.totalChars}
            title="模型实时输出"
            emptyText="正在想…"
          />
        </div>
      ) : null}
      {proposal ? (
        <div data-feasibility-proposal className="mt-2">
          <OptionCard
            option={proposal}
            selected={adoptedSummary === proposal.decision.summary}
            onChoose={() => onAdopt(proposal)}
            chooseLabel={adoptLabel}
          />
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <textarea
          rows={2}
          value={message}
          disabled={replying}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder={placeholder}
          aria-label="说说你的想法"
          className="min-w-0 flex-1 resize-none rounded border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-1 text-xs text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
        />
        <button
          type="button"
          disabled={!message.trim() || replying}
          onClick={() => void send()}
          aria-label="发送"
          className="shrink-0 self-end rounded border border-[var(--nx-border-focus)] px-2 py-1 text-xs text-[var(--nx-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {replying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </div>
    </div>
  )
}
