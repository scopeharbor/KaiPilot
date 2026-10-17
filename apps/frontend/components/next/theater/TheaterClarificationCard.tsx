'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  HelpCircle,
  ShieldCheck,
  SkipForward,
  Sparkles,
} from 'lucide-react'
import type {
  ClarificationAnswer,
  ClarificationAnswers,
  ClarificationCard,
  ClarificationCategory,
  ClarificationPhase,
  ClarificationValue,
} from '@aiproj/types'
import { buildClarificationAnswer } from '@/stores/ai-project-draft-store'
import { TheaterClarificationExplain } from './TheaterClarificationExplain'
import { TheaterMemberMention } from './TheaterMemberMention'

/**
 * 一次一题澄清卡片流（v3-ui-next-theater-intent-clarify D4 / spec「对话式澄清卡片逐题浮现与三级交互规约」）。
 *
 * - 严格遵循「一次一题」：始终聚焦当前卡片（`revertedCards[0] ?? activeCard ?? cards[0]`）；
 *   作答经 `onAnswer` 交宿主映射 `store.recordAnswer`，store.cards 收敛后自动推进下一题；
 * - 三级视觉分级与行为规约：
 *   - critical：红色警示基调，禁止跳过、不提供默认假设，必须完成选项选择或自定义输入后方可「确认此项」；
 *   - recommended：琥珀色基调，支持快捷选项、自定义输入与「采用 AI 默认假设」
 *     （`buildClarificationAnswer(card, 'default', defaultValue)` 自动挂 `source: 'default'` marker，显式「AI 假设免责」标签）；
 *   - optional：天青色微光基调，额外显式提供「跳过此项」（`buildClarificationAnswer(card, 'skip', null)`）；
 * - 「重新回答上一题」反悔退回：本地历史栈回滚上一道题并重新呈现为活动卡片，
 *   重新作答会按 field 覆盖 store.answers 中旧值（store 无删除答案的 action，语义为最后一次作答为准）；
 * - 反悔入口在 Answers 之外的 store 状态零改动，全程零自动落库（RL-01/RL-06）。
 */
export interface TheaterClarificationCardProps {
  /** 尚未作答的待澄清卡片（store.cards，按题序）。 */
  cards: ClarificationCard[]
  /** 服务端指定的活动卡片（store.activeCard），为空时按一次一题取 cards[0]。 */
  activeCard: ClarificationCard | null
  /** 已作答字典（store.answers），用于反悔重放时预填上一次的回答。 */
  answers: ClarificationAnswers
  /** 澄清阶段（core / conditional / agent）。 */
  phase: ClarificationPhase
  /** 总题数（store.totalCount，服务端投影参考；进度条兜底用本地计数）。 */
  totalCount: number
  /** 服务端已确认的题数（自适应澄清每轮会重新挂载卡片，本地历史栈会清空，进度以它为准）。 */
  completedCount?: number
  /** 原始意图文本（store.rawInput，解释气泡请求需要）。 */
  rawInput: string
  /** 自适应会话令牌（store.adaptiveSessionToken，解释气泡请求需要）。 */
  adaptiveSessionToken: string | null
  /** 忙时（如宿主模型重算中）禁用一切作答手势。 */
  isBusy?: boolean
  /** 提交答案事件；宿主映射 store.recordAnswer。 */
  onAnswer: (answer: ClarificationAnswer) => void
  /** 宿主在澄清中途要求重放指定卡片（如从就绪态「重新调整回答」回跳）；重复按下幂等。 */
  revealCard?: ClarificationCard | null
  /** 全部卡片作答完毕、进入等待就绪的过渡态时触发（宿主在此对接状态推进）。 */
  onAllAnswered?: () => void
}

interface CategoryMeta {
  label: string
  description: string
  /** 消费的新轨令牌（仅作色值来源，透明度由 color-mix 派生）。 */
  token: string
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
}

const CATEGORY_META: Record<ClarificationCategory, CategoryMeta> = {
  critical: {
    label: '关键必答',
    description: '不补齐会阻断后续草案生成。',
    token: 'var(--nx-status-danger)',
    Icon: AlertTriangle,
  },
  recommended: {
    label: '建议补充',
    description: '可采用 AI 默认假设，但会影响计划质量。',
    token: 'var(--nx-status-warning)',
    Icon: ShieldCheck,
  },
  optional: {
    label: '可选优化',
    description: '不回答也可以继续，用于让草案更贴近偏好。',
    token: 'var(--nx-space-cyan)',
    Icon: Sparkles,
  },
}

const PHASE_LABEL: Partial<Record<ClarificationPhase, string>> = {
  core: '核心要素',
  conditional: '专业补充',
  agent: 'Agent 追问',
}

function formatValue(value: ClarificationValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

/** 反悔重放时把 store 中上一次的回答回填到自定义输入框，便于对照修改。 */
function previousAnswerText(card: ClarificationCard, answers: ClarificationAnswers): string {
  const previous = answers[card.field]
  if (!previous || previous.action !== 'answer') return ''
  if (typeof previous.value === 'string') return previous.value
  if (typeof previous.value === 'number') return String(previous.value)
  return ''
}

export function TheaterClarificationCard({
  cards,
  activeCard,
  answers,
  phase,
  totalCount,
  completedCount = 0,
  rawInput,
  adaptiveSessionToken,
  isBusy = false,
  onAnswer,
  revealCard = null,
  onAllAnswered,
}: TheaterClarificationCardProps) {
  // 已答历史栈（栈顶 = 最近作答），支撑「重新回答上一题」。
  const [history, setHistory] = React.useState<ClarificationCard[]>([])
  // 反悔重放栈：退回的卡片在此排队，优先于 store 卡片呈现。
  const [revertedCards, setRevertedCards] = React.useState<ClarificationCard[]>([])
  const [selectedValues, setSelectedValues] = React.useState<Array<string | number>>([])
  const [customValue, setCustomValue] = React.useState('')
  const [customOpen, setCustomOpen] = React.useState(false)
  // 回答框里也能 @ 组织成员（与输入页同一组件；发给模型前统一换成代号）。
  const customRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [customCaret, setCustomCaret] = React.useState(0)
  const syncCustomCaret = () => setCustomCaret(customRef.current?.selectionStart ?? 0)
  const [explainOpen, setExplainOpen] = React.useState(false)
  const articleRef = React.useRef<HTMLElement | null>(null)

  const card = revertedCards[0] ?? activeCard ?? cards[0] ?? null
  // revealCard 尚未被消化进重放栈（宿主刚指令回跳、呈现在即）时不算「全部作答完毕」，
  // 避免首帧误触发 onAllAnswered 把宿主踢出回跳流（W4 装配：就绪态「重新调整回答」）。
  const pendingReveal =
    revealCard !== null && !revertedCards.some((item) => item.cardId === revealCard.cardId)
  const allAnswered = card === null && !pendingReveal

  // 最新 answers 经 ref 读取：宿主外部更新（如重算回填）不应清空用户正在进行的选项手势。
  const answersRef = React.useRef(answers)
  React.useEffect(() => {
    answersRef.current = answers
  }, [answers])

  // 换题时重置本卡的作答手势；反悔重放的卡片预填上一次的回答；
  // 换题同时收起上一题的解释气泡（其内部 effect 会 abort 旧 SSE 流，design D5）。
  React.useEffect(() => {
    if (!card) return
    setSelectedValues([])
    setCustomValue(previousAnswerText(card, answersRef.current))
    setCustomOpen(card.quickOptions.length === 0)
    setExplainOpen(false)
    articleRef.current?.focus({ preventScroll: true })
  }, [card?.cardId])

  // 宿主指令重放指定卡片（幂等）。
  React.useEffect(() => {
    if (!revealCard) return
    setRevertedCards((current) =>
      current.some((item) => item.cardId === revealCard.cardId)
        ? current
        : [revealCard, ...current],
    )
  }, [revealCard?.cardId])

  // 全部作答完毕的过渡态通知宿主（宿主负责推进 status/重算；只通知一次）。
  const allAnsweredNotifiedRef = React.useRef(false)
  React.useEffect(() => {
    if (!allAnswered) {
      allAnsweredNotifiedRef.current = false
      return
    }
    if (!allAnsweredNotifiedRef.current) {
      allAnsweredNotifiedRef.current = true
      onAllAnswered?.()
    }
  }, [allAnswered, onAllAnswered])

  function commitAnswer(
    card: ClarificationCard,
    action: ClarificationAnswer['action'],
    value: ClarificationValue,
  ) {
    // 本地流推进：作答卡片进入历史栈；若来自重放栈则弹出。
    setRevertedCards((current) => (current[0]?.cardId === card.cardId ? current.slice(1) : current))
    setHistory((current) => [...current, card])
    setSelectedValues([])
    setCustomValue('')
    onAnswer(buildClarificationAnswer(card, action, value))
  }

  function handleBack() {
    if (isBusy) return
    const previous = history[history.length - 1]
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    setRevertedCards((current) => [previous, ...current])
  }

  function toggleOption(value: string | number) {
    if (isBusy) return
    setSelectedValues((current) =>
      card?.questionType === 'multi_choice'
        ? current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value]
        : current[0] === value
          ? []
          : [value],
    )
  }

  const hasSelection =
    card !== null &&
    (card.questionType === 'multi_choice' ? selectedValues.length > 0 : selectedValues.length === 1)
  const hasCustom = customValue.trim().length > 0
  const confirmDisabled = isBusy || (!hasSelection && !hasCustom)

  function resolveAnswerValue(): ClarificationValue {
    const trimmed = customValue.trim()
    if (trimmed) {
      return card?.questionType === 'number' ? Number(trimmed) : trimmed
    }
    if (card?.questionType === 'multi_choice') return selectedValues.map(String)
    return selectedValues[0] ?? null
  }

  function handleConfirm() {
    if (!card || confirmDisabled) return
    commitAnswer(card, 'answer', resolveAnswerValue())
  }

  const accent = card ? CATEGORY_META[card.category].token : 'var(--nx-space-cyan)'
  const position = Math.max(history.length, completedCount) + 1
  const displayTotal = Math.max(totalCount, history.length + revertedCards.length + cards.length)
  const displayRemaining = revertedCards.length + cards.length
  const canGoBack = history.length > 0 && !isBusy
  const phaseLabel = PHASE_LABEL[phase] ?? '澄清'

  // 全部作答完毕（含 revealCard 待消化的一帧过渡）：等待宿主推进就绪态
  // （RL-01：绝不自动发起生成请求）。
  if (allAnswered || card === null) {
    return (
      <section
        data-theater-clarify
        data-clarify-complete
        className="nx-space-atmosphere flex flex-col items-center gap-2 rounded-xl border border-[var(--nx-border-hairline)] bg-[var(--nx-space-surface)] p-8 text-center"
        aria-live="polite"
      >
        <Sparkles className="h-8 w-8 text-[var(--nx-ai)]" aria-hidden />
        <h3 className="text-base font-semibold text-[var(--nx-text-primary)]">
          澄清进度已全部作答完成
        </h3>
        <p className="text-sm leading-6 text-[var(--nx-text-muted)]">
          正在汇总确认上下文…请稍候片刻，不会自动发起任何生成请求。
        </p>
      </section>
    )
  }

  const meta = CATEGORY_META[card.category]
  const Icon = meta.Icon
  const confirmLabel =
    card.questionType === 'multi_choice' && selectedValues.length > 0
      ? `确认此项（已选 ${selectedValues.length} 项）`
      : '确认此项'
  const suggestedText = formatValue(card.suggestedValue)

  return (
    <section
      data-theater-clarify
      aria-live="polite"
      aria-busy={isBusy}
      className="flex w-full max-w-2xl flex-col gap-3"
    >
      {/* 顶部状态条：阶段 + 进度 + 反悔退回入口 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-[var(--nx-text-muted)]">
          <span className="font-medium" style={{ color: accent }}>
            {/* 自适应追问一次只出一题，服务端 totalCount 是待了解项数而非将问题数：只报当前序号。 */}
            {adaptiveSessionToken
              ? `${phaseLabel} · 第 ${position} 题`
              : `${phaseLabel} · 第 ${position} / ${displayTotal} 题`}
          </span>
          <span aria-hidden> · </span>
          {adaptiveSessionToken ? '信息够用就结束' : `剩余 ${displayRemaining} 题`}
        </p>
        <button
          type="button"
          data-clarify-back
          disabled={!canGoBack}
          onClick={handleBack}
          className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          重新回答上一题
        </button>
      </div>

      {/* 当前澄清卡片 */}
      <article
        ref={articleRef}
        data-clarify-card
        data-category={card.category}
        tabIndex={-1}
        aria-labelledby={`${card.cardId}-title`}
        className="flex flex-col gap-4 rounded-xl border bg-[var(--nx-space-surface)] p-4 outline-none transition-[border-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] motion-reduce:transition-none"
        style={{
          borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
          boxShadow: `0 0 30px -10px color-mix(in srgb, ${accent} 45%, transparent)`,
        }}
      >
        <header className="flex flex-wrap items-start justify-between gap-2">
          <span
            data-clarify-badge
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium"
            style={{
              color: accent,
              borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
            }}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {meta.label}
          </span>
          <span className="font-mono text-xs text-[var(--nx-text-muted)]">
            置信度 {Math.round(card.confidence * 100)}%
          </span>
        </header>

        <div>
          <h3
            id={`${card.cardId}-title`}
            className="text-base font-semibold text-[var(--nx-text-primary)]"
          >
            {card.title}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-[var(--nx-text-secondary)]">
            {card.description}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--nx-text-muted)]">{meta.description}</p>
        </div>

        {card.impactScope.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {card.impactScope.map((impact) => (
              <span
                key={`${card.cardId}-${impact.domain}`}
                className="rounded-full border border-[var(--nx-border-hairline)] px-2 py-0.5 text-xs text-[var(--nx-text-muted)]"
              >
                {impact.domain} · {impact.severity}
              </span>
            ))}
          </div>
        ) : null}

        {card.quickOptions.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="快捷选项">
            {card.quickOptions.map((option) => {
              const selected = selectedValues.includes(option.value)
              return (
                <button
                  key={`${card.cardId}-${option.label}`}
                  type="button"
                  data-clarify-option
                  aria-pressed={selected}
                  disabled={isBusy}
                  onClick={() => toggleOption(option.value)}
                  className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? 'border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)]'
                      : 'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)]'
                  }`}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    {selected ? (
                      <Check className="h-3.5 w-3.5 text-[var(--nx-ai)]" aria-hidden />
                    ) : null}
                    {option.label}
                    {option.recommended ? (
                      <span className="rounded-full bg-[var(--nx-bg-1)] px-1.5 py-0.5 text-[10px] text-[var(--nx-space-cyan)]">
                        推荐
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="text-xs leading-5 text-[var(--nx-text-muted)]">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        {suggestedText ? (
          <p className="rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-sm leading-6 text-[var(--nx-text-secondary)]">
            已从原始描述预填，请确认或修改：{suggestedText}
          </p>
        ) : null}

        {/* 折叠式自定义输入 */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-clarify-custom-toggle
            aria-expanded={customOpen}
            disabled={isBusy}
            onClick={() => setCustomOpen((current) => !current)}
            className="flex h-8 items-center gap-1.5 self-start rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${customOpen ? 'rotate-180' : ''}`}
              aria-hidden
            />
            {card.customInput.label}
          </button>
          {customOpen ? (
            <>
              <p className="text-xs leading-5 text-[var(--nx-text-muted)]">
                {card.customInput.description}
              </p>
              <textarea
                id={`${card.cardId}-custom`}
                data-clarify-custom
                value={customValue}
                placeholder={card.customInput.placeholder}
                rows={3}
                disabled={isBusy}
                ref={customRef}
                onChange={(event) => {
                  setCustomValue(event.target.value)
                  setCustomCaret(event.target.selectionStart ?? event.target.value.length)
                }}
                onKeyUp={syncCustomCaret}
                onClick={syncCustomCaret}
                className="min-h-20 w-full resize-y rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-3 py-2 text-sm leading-6 text-[var(--nx-text-primary)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--nx-text-muted)] focus:border-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <TheaterMemberMention
                textareaRef={customRef}
                value={customValue}
                caret={customCaret}
                onInsert={(next, position) => {
                  setCustomValue(next)
                  setCustomCaret(position)
                  requestAnimationFrame(() => {
                    customRef.current?.focus()
                    customRef.current?.setSelectionRange(position, position)
                  })
                }}
              />
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-clarify-explain
            disabled={!adaptiveSessionToken || isBusy}
            onClick={() => setExplainOpen(true)}
            title={adaptiveSessionToken ? '获取这道题的通俗解释与决策参考' : '解释服务当前不可用'}
            className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-[var(--nx-text-muted)] transition-colors hover:text-[var(--nx-space-cyan)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            我不了解这道题
          </button>

          <span className="flex-1" aria-hidden />

          {card.defaultValue && card.category !== 'critical' ? (
            <div className="flex items-center gap-2 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] px-2.5 py-1.5">
              <span className="text-xs text-[var(--nx-text-muted)]">
                AI 推断默认值：{formatValue(card.defaultValue.value)}
              </span>
              <button
                type="button"
                data-clarify-default
                disabled={isBusy}
                onClick={() => commitAnswer(card, 'default', card.defaultValue?.value ?? null)}
                className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-focus)] px-2.5 text-xs font-medium text-[var(--nx-space-cyan)] transition-colors hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                采用 AI 默认假设
                <span
                  data-clarify-default-marker
                  className="rounded-full border border-[var(--nx-border-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-muted)]"
                >
                  AI 假设免责
                </span>
              </button>
            </div>
          ) : null}

          {card.category === 'optional' && card.allowSkip ? (
            <button
              type="button"
              data-clarify-skip
              disabled={isBusy}
              onClick={() => commitAnswer(card, 'skip', null)}
              className="flex h-8 items-center gap-1 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-xs text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SkipForward className="h-3.5 w-3.5" aria-hidden />
              跳过此项
            </button>
          ) : null}

          <button
            type="button"
            data-clarify-confirm
            disabled={confirmDisabled}
            onClick={handleConfirm}
            className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-bg-1)] px-3.5 text-sm font-medium text-[var(--nx-text-primary)] transition-colors hover:text-[var(--nx-ai)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-4 w-4 text-[var(--nx-ai)]" aria-hidden />
            {confirmLabel}
          </button>
        </div>
      </article>

      <TheaterClarificationExplain
        key={card.cardId}
        card={card}
        rawInput={rawInput}
        adaptiveSessionToken={adaptiveSessionToken}
        open={explainOpen}
        onOpenChange={setExplainOpen}
      />
    </section>
  )
}
