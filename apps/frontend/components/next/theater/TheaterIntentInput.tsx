'use client'

import * as React from 'react'
import { Loader2, Send } from 'lucide-react'
import { useAiProjectDraftStore } from '@/stores/ai-project-draft-store'
import { TheaterIntentAttachments } from './TheaterIntentAttachments'
import { TheaterMemberMention } from './TheaterMemberMention'
import { TheaterModelPicker } from './TheaterModelPicker'
import { TheaterRequirementBrief } from './TheaterRequirementBrief'

/** 意图输入长度守卫（与旧轨 AiProjectIntentWorkspace 严格对齐，design D3）。 */
export const INTENT_INPUT_MIN = 10
export const INTENT_INPUT_MAX = 50_000
/** 超过这个长度先整理需求清单（与后端 BRIEF_THRESHOLD_CHARS 一致）。 */
export const INTENT_BRIEF_THRESHOLD = 8_000

export interface TheaterIntentInputProps {
  /** 提交回调（页面接线：触发 aiIntentApi.analyze 等后续动作；W1 脚手架可不接）。 */
  onSubmit?: (text: string) => void
  /** 切换至手动放置立项模式（W2 任务 2.5） */
  onOpenManualPlacement?: () => void
}

/**
 * 单焦点意图输入（v3-ui-next-theater-intent-clarify D3 / 任务 1.4）。
 *
 * - 完全复用 ai-project-draft-store：输入变更 → `setRawInput`，提交 → `startAnalyzing`
 *   （RL-04，禁止分叉业务契约）；busy 态由 `status === 'analyzing'` 派生；
 * - MIN_INPUT=10 / MAX_INPUT=4000 前端双守卫，不合法时按钮置灰禁用并给出微光提示；
 * - `Cmd/Ctrl + Enter` 快捷提交；提交后输入框 readOnly 锁定 + 旋转加载文案，防重提交；
 * - 提交仅触发 `startAnalyzing`（状态机推进），真正的 analyze 网络请求由页面在
 *   `onSubmit` 中接线（RL-01：澄清/就绪阶段零生成请求）。
 */
export function TheaterIntentInput({ onSubmit, onOpenManualPlacement }: TheaterIntentInputProps) {
  const rawInput = useAiProjectDraftStore((state) => state.rawInput)
  const status = useAiProjectDraftStore((state) => state.status)
  const setRawInput = useAiProjectDraftStore((state) => state.setRawInput)
  const startAnalyzing = useAiProjectDraftStore((state) => state.startAnalyzing)

  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [caret, setCaret] = React.useState(0)
  const syncCaret = () => setCaret(textareaRef.current?.selectionStart ?? 0)

  const busy = status === 'analyzing'
  const trimmedLength = rawInput.trim().length
  const tooShort = trimmedLength < INTENT_INPUT_MIN
  const tooLong = trimmedLength > INTENT_INPUT_MAX
  const eligible = !tooShort && !tooLong
  const canSubmit = eligible && !busy

  const [briefing, setBriefing] = React.useState(false)
  const requirementBrief = useAiProjectDraftStore((state) => state.requirementBrief)
  const requirementBriefFor = useAiProjectDraftStore((state) => state.requirementBriefFor)
  const needsBrief = trimmedLength > INTENT_BRIEF_THRESHOLD
  const briefFresh = Boolean(requirementBrief) && requirementBriefFor === rawInput.trim()

  const submit = () => {
    if (!canSubmit) return
    // 长需求先整理成需求清单给用户确认；短需求或整理稿仍对应当前原文时直接开始。
    if (needsBrief && !briefFresh) {
      setBriefing(true)
      return
    }
    if (!needsBrief && requirementBrief) {
      useAiProjectDraftStore.getState().setRequirementBrief(null, null)
    }
    startAnalyzing()
    onSubmit?.(rawInput.trim())
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    submit()
  }

  const guardText = tooLong
    ? `超出最大长度限制：最多 ${INTENT_INPUT_MAX} 字符，请精简描述`
    : tooShort && trimmedLength === 0
      ? `请至少输入 ${INTENT_INPUT_MIN} 个字符描述项目意图`
      : tooShort
        ? `请至少输入 ${INTENT_INPUT_MIN} 个字符描述项目意图（已输入 ${trimmedLength} 字符）`
        : ''

  return (
    <section data-theater-intent className="flex flex-1 flex-col items-center justify-center py-8">
      <p className="font-mono text-xs tracking-[0.25em] text-[var(--nx-text-muted)]">
        生成剧场 · 一句话启动项目
      </p>
      <h1
        id="theater-intent-title"
        className="mt-4 text-center text-2xl font-semibold text-[var(--nx-text-primary)]"
      >
        用一句话描述项目意图
      </h1>
      <p className="mt-2 max-w-xl text-center text-sm leading-relaxed text-[var(--nx-text-secondary)]">
        系统将解析意图并逐题澄清，全程需人工确认后才会生成项目草案（RL-01）。
      </p>

      <div className="mt-10 w-full max-w-3xl rounded-[24px] border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)]/80 p-4 transition-colors focus-within:border-[var(--nx-border-focus)]">
        <textarea
          ref={textareaRef}
          id="theater-intent-textarea"
          autoFocus
          readOnly={busy}
          maxLength={INTENT_INPUT_MAX}
          rows={4}
          value={rawInput}
          onChange={(event) => {
            if (busy) return
            setRawInput(event.target.value)
            setCaret(event.target.selectionStart ?? event.target.value.length)
          }}
          onSelect={syncCaret}
          onClick={syncCaret}
          onKeyDown={handleKeyDown}
          placeholder="例如：搭建一个企业级跨部门敏捷项目协作系统，包含任务看板与工时统计。输入 @ 可以直接指定组织成员"
          aria-labelledby="theater-intent-title"
          aria-describedby="theater-intent-guard"
          className="w-full resize-none bg-transparent text-base leading-relaxed text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none disabled:opacity-60"
        />

        <TheaterMemberMention
          textareaRef={textareaRef}
          value={rawInput}
          caret={caret}
          onInsert={(next, position) => {
            setRawInput(next)
            setCaret(position)
            requestAnimationFrame(() => {
              textareaRef.current?.focus()
              textareaRef.current?.setSelectionRange(position, position)
            })
          }}
        />

        <div className="mt-3">
          <TheaterIntentAttachments disabled={busy} maxChars={INTENT_INPUT_MAX} />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p
              id="theater-intent-guard"
              role="status"
              data-intent-guard
              className={`min-h-5 text-xs leading-5 ${
                tooLong ? 'text-[var(--nx-status-danger)]' : 'text-[var(--nx-text-muted)]'
              }`}
            >
              {guardText}
            </p>
            <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--nx-text-muted)]">
              <TheaterModelPicker />
              <span aria-hidden className="h-3 w-px bg-[var(--nx-border-hairline)]" />
              <span data-intent-char-count>
                {rawInput.length} / {INTENT_INPUT_MAX}
              </span>
              <span aria-hidden className="h-3 w-px bg-[var(--nx-border-hairline)]" />
              <span>
                <kbd className="rounded-[4px] border border-[var(--nx-border-hairline)] px-1 text-[10px]">
                  ⌘
                </kbd>
                /
                <kbd className="rounded-[4px] border border-[var(--nx-border-hairline)] px-1 text-[10px]">
                  Ctrl
                </kbd>
                +{' '}
                <kbd className="rounded-[4px] border border-[var(--nx-border-hairline)] px-1 text-[10px]">
                  Enter
                </kbd>{' '}
                快速提交
              </span>
              {onOpenManualPlacement && (
                <>
                  <span aria-hidden className="h-3 w-px bg-[var(--nx-border-hairline)]" />
                  <button
                    type="button"
                    data-testid="theater-btn-manual-mode"
                    onClick={onOpenManualPlacement}
                    className="font-sans text-[var(--nx-text-secondary)] underline underline-offset-2 transition-colors hover:text-[var(--nx-text-primary)]"
                  >
                    手动放置立项
                  </button>
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            data-intent-submit
            disabled={!canSubmit}
            onClick={submit}
            className="flex h-11 shrink-0 items-center gap-2 rounded-md border border-[var(--nx-border-focus)] bg-[var(--nx-accent)]/10 px-5 text-sm font-medium text-[var(--nx-text-primary)] transition-colors hover:bg-[var(--nx-accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:border-[var(--nx-border-hairline)] disabled:bg-[var(--nx-bg-0)] disabled:text-[var(--nx-text-muted)]"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {busy ? 'AI 正在后台理解项目并准备问题…' : '解析意图'}
          </button>
        </div>
      </div>

      {briefing ? (
        <TheaterRequirementBrief
          rawInput={rawInput.trim()}
          onCancel={() => setBriefing(false)}
          onSkip={() => {
            setBriefing(false)
            useAiProjectDraftStore.getState().setRequirementBrief(null, null)
            startAnalyzing()
            onSubmit?.(rawInput.trim())
          }}
          onConfirm={(brief) => {
            setBriefing(false)
            useAiProjectDraftStore.getState().setRequirementBrief(brief, rawInput.trim())
            startAnalyzing()
            onSubmit?.(rawInput.trim())
          }}
        />
      ) : null}
    </section>
  )
}

export default TheaterIntentInput
