'use client'

/**
 * 可信度指示器组件（任务 7.7–7.10）
 *
 * 四档（≥80 高 / 50–79 中 / <50 低 / 未知），配色走设计 token。
 * 一处实现，三处复用：假设清单、AI 生成卡片、报表 AI 洞察。
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import type { CopilotConfidenceBand } from '@aiproj/types'

// ── 档位映射 ──

function confidenceToBand(confidence: number | undefined): CopilotConfidenceBand {
  if (confidence === undefined || confidence === null) return 'fallback'
  if (confidence >= 80) return 'high'
  if (confidence >= 50) return 'medium'
  return 'low'
}

const BAND_CONFIG: Record<
  CopilotConfidenceBand,
  {
    label: string
    dotClass: string
    textClass: string
    filledDots: number
  }
> = {
  high: {
    label: '高可信度',
    dotClass: 'bg-[hsl(var(--success))]',
    textClass: 'text-[hsl(var(--success))]',
    filledDots: 5,
  },
  medium: {
    label: '中可信度',
    dotClass: 'bg-[hsl(var(--warning))]',
    textClass: 'text-[hsl(var(--warning))]',
    filledDots: 3,
  },
  low: {
    label: '低可信度',
    dotClass: 'bg-[hsl(var(--destructive))]',
    textClass: 'text-[hsl(var(--destructive))]',
    filledDots: 2,
  },
  fallback: {
    label: '未知',
    dotClass: 'bg-[hsl(var(--muted))]',
    textClass: 'text-[hsl(var(--muted-foreground))]',
    filledDots: 0,
  },
}

// ── 尺寸 ──

const SIZE_CONFIG = {
  sm: { dotSize: 'h-2 w-2', gap: 'gap-0.5', textSize: 'text-[10px]' },
  md: { dotSize: 'h-2.5 w-2.5', gap: 'gap-1', textSize: 'text-xs' },
  lg: { dotSize: 'h-3 w-3', gap: 'gap-1', textSize: 'text-sm' },
} as const

interface ConfidenceIndicatorProps {
  confidence?: number
  band?: CopilotConfidenceBand
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

export function ConfidenceIndicator({
  confidence,
  band: explicitBand,
  size = 'md',
  showLabel = false,
  className,
}: ConfidenceIndicatorProps) {
  const band = explicitBand ?? confidenceToBand(confidence)
  const config = BAND_CONFIG[band]
  const sizeConfig = SIZE_CONFIG[size]

  return (
    <div
      role="img"
      aria-label={`可信度：${config.label}${confidence !== undefined ? ` (${confidence}%)` : ''}`}
      className={cn('inline-flex items-center', sizeConfig.gap, className)}
    >
      {/* 五点指示器 */}
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn(
            'inline-block rounded-full',
            sizeConfig.dotSize,
            i < config.filledDots
              ? config.dotClass
              : band === 'fallback'
                ? 'bg-[hsl(var(--muted))] opacity-50'
                : 'bg-[hsl(var(--muted))] opacity-30',
          )}
        />
      ))}
      {showLabel && (
        <span className={cn('ml-1 font-medium', sizeConfig.textSize, config.textClass)}>
          {config.label}
        </span>
      )}
    </div>
  )
}

/**
 * 获取置信度的四档中文标签（供外部使用）。
 */
export function confidenceBandLabel(band: CopilotConfidenceBand): string {
  return BAND_CONFIG[band].label
}
