'use client'

import * as React from 'react'
import { Check, CornerDownLeft, MessageCircleQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * AI 追问卡片（参照 Claude Code 的提问卡）：编号候选答案 + 最后一项「其他（自己输入）」。
 *
 * - 点选项 / 数字键 1–N 直接回答；↑↓ 移动高亮、Enter 选中；
 * - 最后一项展开输入框，Enter 提交、Esc 收起；
 * - 只有最新一张卡可答（`active`），回答后锁定并显示所选答案。
 */
export interface QuestionCardProps {
  prompt: string
  options: readonly string[]
  status: 'open' | 'answered' | 'skipped'
  answer?: string
  /** 是否为当前可回答的卡（对话里最后一条助手消息）。 */
  active: boolean
  onAnswer: (answer: string) => void
}

const CUSTOM_LABEL = '其他（自己输入）'

export function QuestionCard({
  prompt,
  options,
  status,
  answer,
  active,
  onAnswer,
}: QuestionCardProps) {
  const answerable = active && status === 'open'
  const customIndex = options.length
  const [highlight, setHighlight] = React.useState(0)
  const [customOpen, setCustomOpen] = React.useState(options.length === 0)
  const [customText, setCustomText] = React.useState('')
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (customOpen && answerable) inputRef.current?.focus()
  }, [customOpen, answerable])

  const choose = (index: number) => {
    if (!answerable) return
    if (index === customIndex) {
      setHighlight(index)
      setCustomOpen(true)
      return
    }
    const option = options[index]
    if (option) onAnswer(option)
  }

  const submitCustom = () => {
    const text = customText.trim()
    if (answerable && text) onAnswer(text)
  }

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!answerable || event.target instanceof HTMLInputElement) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((value) => Math.min(customIndex, value + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((value) => Math.max(0, value - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(highlight)
    } else if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1
      if (index <= customIndex) {
        event.preventDefault()
        choose(index)
      }
    }
  }

  const answeredIndex = status === 'answered' && answer !== undefined ? options.indexOf(answer) : -1
  const answeredCustom = status === 'answered' && answer !== undefined && answeredIndex < 0

  return (
    <article
      data-card="question"
      data-status={status}
      data-active={answerable ? 'true' : undefined}
      className={cn(
        'overflow-hidden rounded-md border bg-[var(--nx-workspace-surface)]',
        answerable
          ? 'border-[var(--nx-border-focus)]/80'
          : 'border-[var(--nx-border-hairline)] opacity-90',
      )}
    >
      <div className="flex items-start gap-2 border-b border-[var(--nx-border-hairline)] px-3 py-2.5">
        <MessageCircleQuestion
          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--nx-accent)]"
          aria-hidden
        />
        <p
          data-question-prompt
          className="text-xs leading-5 whitespace-pre-wrap text-[var(--nx-text-primary)]"
        >
          {prompt}
        </p>
      </div>

      <div
        ref={listRef}
        role="listbox"
        aria-label={prompt}
        tabIndex={answerable ? 0 : -1}
        onKeyDown={handleListKeyDown}
        className="flex flex-col gap-0.5 p-1.5 focus-visible:outline-none"
      >
        {options.map((option, index) => {
          const chosen = answeredIndex === index
          return (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={answerable ? highlight === index : chosen}
              data-question-option={index + 1}
              disabled={!answerable}
              onMouseEnter={() => answerable && setHighlight(index)}
              onClick={() => choose(index)}
              className={cn(
                'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors',
                answerable && highlight === index
                  ? 'bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)]'
                  : 'text-[var(--nx-text-secondary)]',
                chosen && 'text-[var(--nx-accent)]',
                !answerable && !chosen && 'opacity-60',
                answerable ? 'cursor-pointer' : 'cursor-default',
              )}
            >
              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
                {index + 1}.
              </span>
              <span className="min-w-0 flex-1">{option}</span>
              {chosen ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            </button>
          )
        })}

        {/* 最后一项：自己输入 */}
        {customOpen && answerable ? (
          <div
            data-question-custom
            className="flex items-center gap-2 rounded-sm bg-[var(--nx-bg-1)] px-2 py-1"
          >
            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
              {customIndex + 1}.
            </span>
            <input
              ref={inputRef}
              data-question-custom-input
              value={customText}
              onChange={(event) => setCustomText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  submitCustom()
                } else if (event.key === 'Escape' && options.length > 0) {
                  event.preventDefault()
                  setCustomOpen(false)
                  listRef.current?.focus()
                }
              }}
              placeholder="输入你的回答，回车发送"
              aria-label="自己输入回答"
              className="h-7 min-w-0 flex-1 bg-transparent text-xs text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none"
            />
            <button
              type="button"
              data-question-custom-submit
              onClick={submitCustom}
              disabled={customText.trim() === ''}
              aria-label="发送回答"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--nx-accent)] disabled:opacity-40"
            >
              <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            role="option"
            aria-selected={answerable ? highlight === customIndex : answeredCustom}
            data-question-option={customIndex + 1}
            data-question-custom-toggle
            disabled={!answerable}
            onMouseEnter={() => answerable && setHighlight(customIndex)}
            onClick={() => choose(customIndex)}
            className={cn(
              'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors',
              answerable && highlight === customIndex
                ? 'bg-[var(--nx-bg-1)] text-[var(--nx-text-primary)]'
                : 'text-[var(--nx-text-muted)]',
              answeredCustom && 'text-[var(--nx-accent)]',
              answerable ? 'cursor-pointer' : 'cursor-default',
            )}
          >
            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--nx-text-muted)]">
              {customIndex + 1}.
            </span>
            <span className="min-w-0 flex-1">{answeredCustom ? answer : CUSTOM_LABEL}</span>
            {answeredCustom ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          </button>
        )}
      </div>

      {answerable ? (
        <p className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
          点选或按数字键回答；也可以直接在下方输入框里回复。
        </p>
      ) : status === 'open' ? (
        <p className="border-t border-[var(--nx-border-hairline)] px-3 py-1.5 text-[10px] text-[var(--nx-text-muted)]">
          这个问题已过期（之后有了新的对话）。
        </p>
      ) : null}
    </article>
  )
}

export default QuestionCard
