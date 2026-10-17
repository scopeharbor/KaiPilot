'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AiChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 芯片文案，默认「AI 建议」。 */
  label?: string
}

/**
 * AiChip——AI 标识芯片（Sparkles + 文案）。极浅 AI 紫底 + AI 紫文字，pill 形。
 * AI 紫是语义色，仅用于真正的 AI 元素，不作通用强调（定稿①、DESIGN.md §5）。
 */
export function AiChip({ label = 'AI 建议', className, ...props }: AiChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-ai-bg px-2 py-0.5 text-xs font-medium text-ai',
        className,
      )}
      {...props}
    >
      <Sparkles className="h-3 w-3" aria-hidden />
      {label}
    </span>
  )
}
