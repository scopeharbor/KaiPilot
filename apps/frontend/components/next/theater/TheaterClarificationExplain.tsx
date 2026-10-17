'use client'

import * as React from 'react'
import { Loader2, Send, Sparkles, X } from 'lucide-react'
import type { ClarificationCard } from '@aiproj/types'
import { aiIntentApi, type ExplainClarificationTurn } from '@/lib/api/ai-intent'
import { maskMentions } from '@/lib/member-mask'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'

/** 打字机节奏：每 16ms 揭开 2 个字符（约 125 字符/秒，弱网下也保持可读节奏）。 */
const TYPEWRITER_TICK_MS = 16
const TYPEWRITER_CHARS_PER_TICK = 2

/**
 * 题目流式追问解释气泡（v3-ui-next-theater-intent-clarify D5 / spec「澄清问题流式追问与辅助解释」）。
 *
 * - 接入只读端点 `POST /api/v1/ai/project-intents/explain`（`aiIntentApi.explainStream`，SSE）；
 * - 打字机微动效逐字呈现 AI 对当前题目的通俗背景解释与决策建议；
 * - 支持自然语言追加追问；追问会话仅驻留组件内存，绝不写 store、绝不计入澄清答案（RL-01/RL-12）；
 * - 挂载 AbortController：打开时首轮自动发起「先整体解释一下这道题」；
 *   收起、切换题目、组件卸载时立即 `abort()` 中断底层 SSE，杜绝后台游离请求（D5 §关键设计规约）。
 */
export interface TheaterClarificationExplainProps {
  /** 当前澄清题目（换题自动中断旧解释流并重置会话）。 */
  card: ClarificationCard
  /** 原始意图文本（store.rawInput，解释请求必传）。 */
  rawInput: string
  /** 自适应会话令牌（store.adaptiveSessionToken；为空时无法发起解释）。 */
  adaptiveSessionToken: string | null
  /** 解释气泡受控打开态。 */
  open: boolean
  /** 宿主切换打开态；关闭即中断底层 SSE。 */
  onOpenChange: (open: boolean) => void
  /** 可选：AI 连接与模型选择（与旧轨解释请求同构）。 */
  connectionId?: number
  modelId?: number
}

interface ExplainTurn {
  role: 'user' | 'assistant'
  text: string
}

function toExplainError(failure: unknown): string {
  if (failure instanceof Error && failure.message.trim()) return failure.message
  return '解释加载失败，请稍后重试'
}

export function TheaterClarificationExplain({
  card,
  rawInput,
  adaptiveSessionToken,
  open,
  onOpenChange,
  connectionId,
  modelId,
}: TheaterClarificationExplainProps) {
  // 已完成轮次的对话（user 追问 + assistant 完整解释），仅驻留本组件内存。
  const [turns, setTurns] = React.useState<ExplainTurn[]>([])
  // 当前流式轮次的累积目标文本（打字机从 0 逐步揭示）。
  const [draftTarget, setDraftTarget] = React.useState('')
  const [revealed, setRevealed] = React.useState(0)
  const [streaming, setStreaming] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [followUp, setFollowUp] = React.useState('')
  const abortRef = React.useRef<AbortController | null>(null)
  const streamingRef = React.useRef(false)
  // 历史经由 ref 读取，避免 runExplain 的回调身份随 turns 变化导致外层 effect 循环重放。
  const turnsRef = React.useRef<ExplainTurn[]>([])
  React.useEffect(() => {
    turnsRef.current = turns
  }, [turns])

  const runExplain = React.useCallback(
    async (question: string) => {
      if (streamingRef.current) return
      if (!adaptiveSessionToken) {
        setError('解释服务不可用：缺少会话令牌')
        return
      }
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      streamingRef.current = true

      const history: ExplainClarificationTurn[] = turnsRef.current
        .filter((turn) => turn.text.trim())
        .map((turn) => ({ role: turn.role, text: turn.text }))
      const asked = question.trim()
      if (asked) {
        setTurns((current) => [...current, { role: 'user', text: asked }])
        setFollowUp('')
      }
      setDraftTarget('')
      setRevealed(0)
      setError(null)
      setStreaming(true)

      let accumulated = ''
      try {
        // 与分析请求保持一致：原话里的 @成员 换成代号（会话令牌按这份原话签发，不一致会校验失败），
        // 并用你在输入页选的模型（缺省时服务端退回组织默认模型，实测该模型报错导致解释失败）。
        const store = useAiProjectDraftStore.getState()
        const selection = store.modelSelection
        const effectiveConnectionId = connectionId ?? selection?.connectionId
        const effectiveModelId = modelId ?? selection?.modelId
        await aiIntentApi.explainStream(
          {
            rawInput: maskMentions(rawInput.trim(), store.mentionedMembers),
            ...(store.requirementBrief && store.requirementBriefFor === rawInput.trim()
              ? { requirementBrief: store.requirementBrief }
              : {}),
            adaptiveSessionToken,
            ...(asked ? { question: asked } : {}),
            ...(history.length > 0 ? { history } : {}),
            ...(effectiveConnectionId !== undefined ? { connectionId: effectiveConnectionId } : {}),
            ...(effectiveModelId !== undefined ? { modelId: effectiveModelId } : {}),
          },
          (delta) => {
            accumulated += delta
            setDraftTarget(accumulated)
          },
          controller.signal,
        )
        if (accumulated) {
          setTurns((current) => [...current, { role: 'assistant', text: accumulated }])
        }
      } catch (failure) {
        if (controller.signal.aborted) {
          // 主动中止不算失败：已流出的部分照常保留为一条 assistant 记录。
          if (accumulated) {
            setTurns((current) => [...current, { role: 'assistant', text: accumulated }])
          }
        } else {
          setError(toExplainError(failure))
        }
      } finally {
        setDraftTarget('')
        setRevealed(0)
        streamingRef.current = false
        setStreaming(false)
        abortRef.current = null
      }
    },
    [adaptiveSessionToken, connectionId, modelId, rawInput],
  )

  // 打开时自动发起首轮解释；收起或换题时立即中断底层 SSE 并重置会话。
  React.useEffect(() => {
    if (!open) return
    abortRef.current?.abort()
    setTurns([])
    setDraftTarget('')
    setRevealed(0)
    setError(null)
    setFollowUp('')
    void runExplain('')
    return () => {
      abortRef.current?.abort()
    }
  }, [open, card.cardId, runExplain])

  // 打字机：目标文本变化时以固定节奏逐步揭开。
  React.useEffect(() => {
    if (revealed >= draftTarget.length) return
    const timer = window.setInterval(() => {
      setRevealed((current) => Math.min(draftTarget.length, current + TYPEWRITER_CHARS_PER_TICK))
    }, TYPEWRITER_TICK_MS)
    return () => window.clearInterval(timer)
  }, [draftTarget, revealed])

  function handleFollowUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const question = followUp.trim()
    if (!question || streamingRef.current) return
    void runExplain(question)
  }

  if (!open) return null

  const completedTurns = turns.filter((turn) => turn.text.trim())

  return (
    <aside
      data-explain-bubble
      aria-label="题目解释"
      className="mt-3 flex flex-col gap-3 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--nx-text-secondary)]">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--nx-ai)]" aria-hidden />
          <span className="truncate">关于「{card.title}」的解释（只读，不会记为答案）</span>
        </p>
        <button
          type="button"
          data-explain-close
          aria-label="收起解释"
          onClick={() => onOpenChange(false)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      <div role="log" aria-live="polite" className="flex flex-col gap-2 text-sm leading-6">
        {completedTurns.map((turn, index) => (
          <p
            key={`${turn.role}-${index}`}
            className={
              turn.role === 'user' ? 'text-[var(--nx-text-muted)]' : 'text-[var(--nx-text-primary)]'
            }
          >
            {turn.role === 'user' ? `追问：${turn.text}` : turn.text}
          </p>
        ))}
        {draftTarget ? (
          <p data-explain-typing className="text-[var(--nx-text-primary)]">
            {draftTarget.slice(0, revealed)}
          </p>
        ) : streaming ? (
          <p className="flex items-center gap-1.5 text-[var(--nx-text-muted)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            AI 正在解释…
          </p>
        ) : null}
        {error ? (
          <p data-explain-error role="alert" className="text-[var(--nx-status-danger)]">
            {error}
          </p>
        ) : null}
      </div>

      <form onSubmit={handleFollowUp} className="flex items-center gap-2">
        <input
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder="针对这道题继续追问…"
          disabled={streaming || !adaptiveSessionToken}
          aria-label="追加追问"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 text-sm text-[var(--nx-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          data-explain-send
          aria-label="发送追问"
          disabled={!followUp.trim() || streaming || !adaptiveSessionToken}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-3 text-sm text-[var(--nx-space-cyan)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          追问
        </button>
      </form>
    </aside>
  )
}
