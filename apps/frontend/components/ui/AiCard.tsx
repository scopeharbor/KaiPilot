'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { AiChip } from '@/components/ui/AiChip'

export interface AiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 顶部 AI 芯片文案，默认「AI 建议」；传 null 隐藏芯片。 */
  chipLabel?: string | null
}

/**
 * AiCard——克制版 AI 卡片容器（定稿①）：极浅 AI 紫**纯色底（≤6%）** + 顶部 AI 芯片 + **全边框 1px**。
 * 严格规避 slop：**无**左色条、**无**渐变背景、**无**发光滤镜；圆角 `--radius-lg`（14px，非过圆）。
 */
export const AiCard = React.forwardRef<HTMLDivElement, AiCardProps>(
  ({ chipLabel = 'AI 建议', className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-[var(--radius-lg)] border border-border bg-ai-bg p-[var(--card-pad)] text-gray-700',
        className,
      )}
      {...props}
    >
      {chipLabel !== null ? (
        <div className="mb-3">
          <AiChip label={chipLabel} />
        </div>
      ) : null}
      {children}
    </div>
  ),
)
AiCard.displayName = 'AiCard'
