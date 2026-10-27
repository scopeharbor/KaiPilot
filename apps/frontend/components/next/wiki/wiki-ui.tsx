'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/** 维基新轨共用的小型 UI 原件（与知识库工作台同一套 nx 令牌）。 */
export function WikiButton({
  tone = 'default',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'primary' | 'danger' }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'primary' &&
          'border-[var(--nx-accent)] bg-[var(--nx-accent)] text-[var(--nx-bg-0)] hover:opacity-90',
        tone === 'danger' &&
          'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)] hover:bg-[var(--nx-bg-2)]',
        tone === 'default' &&
          'border-[var(--nx-border-hairline)] bg-[var(--nx-bg-0)] text-[var(--nx-text-secondary)] hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-accent)]',
        className,
      )}
    />
  )
}

export function WikiNotice({
  tone = 'info',
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'warning' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      {...props}
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        tone === 'info' && 'border-[var(--nx-border-hairline)] text-[var(--nx-text-secondary)]',
        tone === 'warning' && 'border-[var(--nx-status-warning)] text-[var(--nx-status-warning)]',
        tone === 'error' && 'border-[var(--nx-status-danger)] text-[var(--nx-status-danger)]',
        props.className,
      )}
    >
      {children}
    </div>
  )
}

export function WikiPanel({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...props}
      className={cn(
        'rounded-lg border border-[var(--nx-border-hairline)] bg-[var(--nx-workspace-bg)] p-4',
        className,
      )}
    >
      {children}
    </section>
  )
}

/** 简单逐行 diff（LCS），审阅提议时对比基线与提议正文。 */
export function lineDiff(
  base: string,
  next: string,
): Array<{ kind: 'same' | 'add' | 'del'; text: string }> {
  const a = base.split('\n')
  const b = next.split('\n')
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]! })
      i++
    } else {
      out.push({ kind: 'add', text: b[j]! })
      j++
    }
  }
  while (i < a.length) out.push({ kind: 'del', text: a[i++]! })
  while (j < b.length) out.push({ kind: 'add', text: b[j++]! })
  return out
}
