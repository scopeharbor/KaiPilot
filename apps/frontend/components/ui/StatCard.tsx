'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface StatCardProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'title' | 'children'
> {
  label: React.ReactNode
  value: React.ReactNode | Record<string, number>
  hint?: React.ReactNode
}

/**
 * 统计卡片使用中性全边框与令牌间距；状态含义必须通过可读文字表达。
 * 不使用侧边色条、渐变背景或发光效果。
 */
export const StatCard = React.forwardRef<HTMLElement, StatCardProps>(
  ({ className, label, value, hint, ...props }, ref) => {
    const displayValue =
      typeof value === 'object' && value !== null && !React.isValidElement(value) ? '--' : value

    return (
      <article
        ref={ref}
        className={cn(
          'flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-border bg-gray-0 p-[var(--card-pad)]',
          className,
        )}
        {...props}
      >
        <span className="text-sm text-gray-500">{label}</span>
        <strong className="truncate text-2xl font-semibold text-gray-800">{displayValue}</strong>
        {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
      </article>
    )
  },
)
StatCard.displayName = 'StatCard'
