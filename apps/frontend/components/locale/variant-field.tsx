'use client'

import {
  forwardRef,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { useVariantText } from '@/lib/locale/use-variant-text'

/**
 * AI 写的、又允许用户改的栏位：按当前文字变体显示（繁体界面显示繁体），
 * 用户改了以后转回简体再交给 onValueChange（存储始终是简体）。
 *
 * 运行时 DOM 层按设计不碰输入框的值（那通常是用户自己打的字）；AI 写的内容要换成这两个组件。
 * 正在输入时保留用户打的原样（不在光标下改字），失焦或外部值变化后再按变体显示。
 */
function useVariantValue(value: string, onValueChange: (value: string) => void) {
  const { display, canonical } = useVariantText()
  const [draft, setDraft] = useState<string | null>(null)
  const emitted = useRef<string | null>(null)
  // 外部改了值（例如 AI 重新填）：放弃本地草稿，按新值显示
  if (draft !== null && emitted.current !== value) {
    setDraft(null)
  }
  return {
    shown: draft ?? display(value),
    onChange: (raw: string) => {
      setDraft(raw)
      const next = canonical(raw)
      emitted.current = next
      onValueChange(next)
    },
    onBlur: () => setDraft(null),
  }
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}

export const VariantInput = forwardRef<HTMLInputElement, InputProps>(function VariantInput(
  { value, onValueChange, onBlur, ...rest },
  ref,
) {
  const field = useVariantValue(value, onValueChange)
  return (
    <input
      ref={ref}
      {...rest}
      value={field.shown}
      onChange={(event) => field.onChange(event.target.value)}
      onBlur={(event) => {
        field.onBlur()
        onBlur?.(event)
      }}
    />
  )
})

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}

export const VariantTextarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function VariantTextarea({ value, onValueChange, onBlur, ...rest }, ref) {
    const field = useVariantValue(value, onValueChange)
    return (
      <textarea
        ref={ref}
        {...rest}
        value={field.shown}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={(event) => {
          field.onBlur()
          onBlur?.(event)
        }}
      />
    )
  },
)
