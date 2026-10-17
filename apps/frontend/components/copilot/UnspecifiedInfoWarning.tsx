'use client'

/**
 * 未明确信息警告块（任务 7.5）
 *
 * 独立成组，不与已确认信息混排。
 * 配色走 warning 设计 token。
 */
import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CopilotAssumptionEntry } from '@aiproj/types'

interface UnspecifiedInfoWarningProps {
  assumptions: readonly CopilotAssumptionEntry[]
  className?: string
}

export function UnspecifiedInfoWarning({ assumptions, className }: UnspecifiedInfoWarningProps) {
  const defaultAssumptions = assumptions.filter((a) => a.usedDefault)

  if (defaultAssumptions.length === 0) return null

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] p-3',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--warning))]">
        <AlertTriangle className="h-3.5 w-3.5" />
        ⚠️ 以下信息未明确，使用了默认值
      </div>
      <ul className="mt-2 space-y-1">
        {defaultAssumptions.map((a) => (
          <li key={a.assumptionId} className="text-xs text-[hsl(var(--foreground))]">
            · {a.statement}
          </li>
        ))}
      </ul>
    </div>
  )
}
