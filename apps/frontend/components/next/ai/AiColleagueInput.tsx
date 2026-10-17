'use client'

import * as React from 'react'
import { Camera, Send } from 'lucide-react'

/**
 * AI 同事对话输入控制器（v3-ui-next-ai-colleague W2 · tasks 2.1）。
 *
 * 深空 HUD 仪器感文本框：
 * - 单行起步、随内容自适应增高（上限 6 行，超出滚动）；
 * - `Enter`（非 IME 组合态、未按 Shift）触发提交；`Shift+Enter` 换行不提交；
 *   IME 拼音组合中输入法回车（`isComposing` / `keyCode 229`）用于候选词上屏，
 *   绝不误发（tasks 2.2 回归点）；
 * - `disabled`（父层经 Store 的 thinking/executing 派生）时输入框与发送按钮
 *   双锁，防并发重发；`awaiting_confirmation` 等其余状态保持可输入；
 * - 经 forwardRef 暴露底层 `<textarea>`，面板 `onOpenAutoFocus` 直接 `.focus()`。
 *
 * 预填建议（像 Claude Code 一样按 Tab 采用）：
 * - 输入框为空时，第一条建议显示为占位文字，按 Tab 填入；
 * - 已输入开头时，以它开头的建议可按 Tab 补全；停止输入片刻后向父层要补全建议；
 * - 建议同时以小标签列出（最多 3 条），点击即填入。
 * 📷：看一眼当前页面（截图交给能看图的模型描述，下一句话会带上）。
 *
 * 纯展示控制器：零网络、零 Store 依赖，提交文本经 `onSubmit` 上抛由父层分发。
 */
export interface AiColleagueInputProps {
  /** 提交回调（仅非空文本；父层经 Store `submitUserMessage` 分发）。 */
  onSubmit: (text: string) => void
  /** 执行中锁定（thinking / executing）；锁定期间拒绝一切提交路径。 */
  disabled?: boolean
  /** 占位文案。 */
  placeholder?: string
  /** 预填建议（第一条按 Tab 采用）。 */
  suggestions?: readonly string[]
  /** 用户停下输入时请求补全建议（参数为已输入的开头）。 */
  onRequestSuggestions?: (draft: string) => void
  /** 📷 看一眼当前页面；不传则不显示按钮。 */
  onCapturePage?: () => void
  /** 已附上当前页面的截图描述。 */
  pageAttached?: boolean
}

/** 停止输入多久后请求补全建议（毫秒）。 */
const SUGGEST_DEBOUNCE_MS = 900

/** 与已输入内容匹配的建议：空输入取第一条；否则取以它开头且更长的一条。 */
export function matchSuggestion(value: string, suggestions: readonly string[]): string | null {
  if (suggestions.length === 0) return null
  if (value.trim() === '') return suggestions[0] ?? null
  return suggestions.find((item) => item.startsWith(value) && item.length > value.length) ?? null
}

export type AiColleagueInputHandle = HTMLTextAreaElement

/** 自适应高度上限：6 行 × 22px 行高。 */
const MAX_AUTO_HEIGHT = 132

export const AiColleagueInput = React.forwardRef<AiColleagueInputHandle, AiColleagueInputProps>(
  function AiColleagueInput(
    {
      onSubmit,
      disabled = false,
      placeholder,
      suggestions = [],
      onRequestSuggestions,
      onCapturePage,
      pageAttached = false,
    },
    forwardedRef,
  ) {
    const [value, setValue] = React.useState('')
    const suggestion = matchSuggestion(value, suggestions)

    // 停下输入后要补全建议（只在有内容、可输入时）
    React.useEffect(() => {
      if (!onRequestSuggestions || disabled) return
      const draft = value.trim()
      if (draft.length < 2 || matchSuggestion(value, suggestions)) return
      const timer = setTimeout(() => onRequestSuggestions(value), SUGGEST_DEBOUNCE_MS)
      return () => clearTimeout(timer)
      // suggestions 变化不重新计时（避免拿到建议后立刻又请求）
    }, [value, disabled, onRequestSuggestions])
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      },
      [forwardedRef],
    )

    const resize = React.useCallback(() => {
      const el = textareaRef.current
      if (!el || el.scrollHeight <= 0) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, MAX_AUTO_HEIGHT)}px`
    }, [])

    React.useEffect(() => {
      resize()
    }, [value, resize])

    const submit = React.useCallback(() => {
      if (disabled) return
      const text = value.trim()
      if (text === '') return
      onSubmit(text)
      setValue('')
    }, [disabled, value, onSubmit])

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Tab 采用预填建议（没有可用建议时保持 Tab 的默认行为）
        if (event.key === 'Tab' && !event.shiftKey && suggestion && !disabled) {
          event.preventDefault()
          setValue(suggestion)
          return
        }
        if (event.key !== 'Enter' || disabled) return
        const native = event.nativeEvent
        // IME 组合态（isComposing；keyCode 229 兼容旧 Safari/IE）：Enter 上屏候选词，不提交
        if (native.isComposing || native.keyCode === 229) return
        if (event.shiftKey) return // Shift+Enter 换行
        event.preventDefault()
        submit()
      },
      [disabled, submit, suggestion],
    )

    const shownSuggestions = suggestions.slice(0, 3)
    return (
      <div className="flex flex-col gap-1.5">
        {shownSuggestions.length > 0 && !disabled ? (
          <div data-ai-colleague-suggestions className="flex flex-wrap items-center gap-1.5">
            {shownSuggestions.map((item) => (
              <button
                key={item}
                type="button"
                data-ai-colleague-suggestion
                onClick={() => {
                  setValue(item)
                  textareaRef.current?.focus()
                }}
                className="max-w-full truncate rounded-full border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2 py-0.5 text-[11px] text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-space-cyan)]/50 hover:text-[var(--nx-text-primary)]"
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2 rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] p-2 transition-colors focus-within:border-[var(--nx-border-focus)]">
          {onCapturePage ? (
            <button
              type="button"
              data-ai-colleague-capture
              aria-label="让 AI 看一眼当前页面"
              title={pageAttached ? '已附上当前页面（再点一次重新看）' : '让 AI 看一眼当前页面'}
              disabled={disabled}
              onClick={onCapturePage}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40 ${
                pageAttached
                  ? 'border-[var(--nx-space-cyan)]/60 bg-[var(--nx-space-cyan)]/15 text-[var(--nx-space-cyan)]'
                  : 'border-[var(--nx-border-hairline)] text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)]'
              }`}
            >
              <Camera className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          <textarea
            ref={setRefs}
            data-ai-colleague-input
            value={value}
            disabled={disabled}
            rows={1}
            placeholder={value === '' && suggestion && !disabled ? suggestion : placeholder}
            aria-label="向 AI 同事发送指令"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            data-ghost={value === '' && suggestion && !disabled ? 'true' : undefined}
            className="max-h-[132px] min-h-[2rem] min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-5 text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[ghost=true]:placeholder:text-[var(--nx-text-muted)]/55"
          />
          <button
            type="button"
            data-ai-colleague-send
            aria-label="发送"
            title="发送（Enter）"
            disabled={disabled || value.trim() === ''}
            onClick={submit}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--nx-space-cyan)]/40 bg-[var(--nx-space-cyan)]/10 text-[var(--nx-space-cyan)] transition-colors hover:bg-[var(--nx-space-cyan)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    )
  },
)

export default AiColleagueInput
