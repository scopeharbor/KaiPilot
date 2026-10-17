'use client'

import * as React from 'react'
import { CheckCircle2, RefreshCw, X } from 'lucide-react'
import { aiIntentApi } from '@/lib/api/ai-intent'
import { apiErrorMessage } from '@/lib/api-client'
import { maskMentions, unmaskMembers } from '@/lib/member-mask'
import { newLiveOutputId, useLiveOutputLanes } from '@/lib/ai-draft/live-output-client'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { LiveOutputPanel } from './TheaterLiveOutput'
import { VariantTextarea } from '@/components/locale/variant-field'

export interface TheaterRequirementBriefProps {
  rawInput: string
  /** 用户确认整理稿（可能改过）后开始追问。 */
  onConfirm: (brief: string) => void
  /** 不整理：追问读原文前 8,000 字（项目理解仍读全文）。 */
  onSkip: () => void
  onCancel: () => void
}

/**
 * 长需求整理面板（超过 8,000 字时）。
 *
 * 不是摘要：逐条保留原文里的具体事项，只合并重复、去掉客套，每条标注「〔段N〕」出处。
 * 整理过程实时吐字；整理稿可以直接改，确认后才开始追问。原文始终完整保存。
 */
export function TheaterRequirementBrief({
  rawInput,
  onConfirm,
  onSkip,
  onCancel,
}: TheaterRequirementBriefProps) {
  const [liveId, setLiveId] = React.useState<string | null>(null)
  const live = useLiveOutputLanes(liveId)
  const [state, setState] = React.useState<
    { kind: 'loading' } | { kind: 'ready'; text: string } | { kind: 'error'; message: string }
  >({ kind: 'loading' })
  const requestRef = React.useRef(0)

  const run = React.useCallback(async () => {
    const store = useAiProjectDraftStore.getState()
    const requestId = ++requestRef.current
    const id = newLiveOutputId()
    setLiveId(id)
    setState({ kind: 'loading' })
    try {
      const result = await aiIntentApi.brief({
        rawInput: maskMentions(rawInput, store.mentionedMembers),
        ...(store.modelSelection ?? {}),
        liveOutputId: id,
      })
      if (requestId !== requestRef.current) return
      // 模型看到的是成员代号；展示时换回姓名，确认时再换回代号。
      const members = store.mentionedMembers
      setState({
        kind: 'ready',
        text: unmaskMembers(
          result.brief,
          (userId) => members.find((m) => m.userId === userId)?.handle,
        ),
      })
    } catch (failure) {
      if (requestId !== requestRef.current) return
      setState({
        kind: 'error',
        message: apiErrorMessage(failure, '需求整理未能完成，请重试。'),
      })
    }
  }, [rawInput])

  React.useEffect(() => {
    void run()
  }, [run])

  return (
    <section
      data-theater-requirement-brief
      aria-label="需求整理"
      className="mt-4 w-full max-w-3xl rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--nx-text-primary)]">
            需求较长（{rawInput.length.toLocaleString('zh-CN')} 字），先整理成需求清单
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--nx-text-muted)]">
            不是摘要：逐条保留你写的每一项具体要求，只合并重复、去掉客套，每条标注出自原文第几段。
            追问时读这份清单；生成项目理解时会再读一遍完整原文。
          </p>
        </div>
        <button
          type="button"
          aria-label="取消整理"
          onClick={onCancel}
          className="shrink-0 rounded p-1 text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {state.kind === 'loading' ? (
        <div className="mt-3">
          <LiveOutputPanel
            compact
            lanes={live.lanes}
            totalChars={live.totalChars}
            title="AI 正在整理需求清单"
            emptyText="正在连接模型，整理过程会在这里实时显示…"
          />
        </div>
      ) : state.kind === 'error' ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-[var(--nx-status-danger)]" data-brief-error>
            整理失败：{state.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void run()} className={SECONDARY}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新整理
            </button>
            <button type="button" onClick={onSkip} className={SECONDARY}>
              跳过整理，直接开始追问
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <VariantTextarea
            data-brief-text
            aria-label="需求清单（可以直接修改）"
            value={state.text}
            onValueChange={(text) => setState({ kind: 'ready', text })}
            rows={14}
            className="w-full resize-y rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3 font-mono text-xs leading-5 text-[var(--nx-text-primary)] focus:border-[var(--nx-border-focus)] focus:outline-none"
          />
          <p className="text-[11px] text-[var(--nx-text-muted)]">
            清单 {state.text.length.toLocaleString('zh-CN')}{' '}
            字。发现漏项或写错可以直接改，确认后开始追问。
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-brief-confirm
              disabled={state.text.trim().length === 0}
              onClick={() =>
                onConfirm(
                  maskMentions(
                    state.text.trim(),
                    useAiProjectDraftStore.getState().mentionedMembers,
                  ),
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-status-success)] px-3 py-1.5 text-xs font-medium text-[var(--nx-status-success)] hover:bg-[var(--nx-status-success)]/10 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              确认清单，开始追问
            </button>
            <button type="button" onClick={() => void run()} className={SECONDARY}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              重新整理
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

const SECONDARY =
  'inline-flex items-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] px-3 py-1.5 text-xs text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]'
