'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * 可点击复制的编号（项目编号 `PROJ-5`、任务编号 `PROJ-5#128`）。
 *
 * 左键点一下即复制到剪贴板，文字短暂变为「已复制」；无图标、无动画，
 * 只有悬停时轻微变亮。点击不会冒泡触发外层卡片 / 行的点击。
 */
export function CopyableCode({
  code,
  prefix = '',
  className,
  'data-testid': testId,
}: {
  code: string
  /** 显示时的前缀（如项目头部的 `#`），不参与复制。 */
  prefix?: string
  className?: string
  'data-testid'?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = async (event: React.MouseEvent | React.KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1200)
  }

  return (
    // span + role=button：编号常出现在可点击的行 / 卡片里，不能嵌套 <button>
    <span
      role="button"
      tabIndex={0}
      data-copyable-code={code}
      data-testid={testId}
      aria-label={`复制编号 ${code}`}
      title="点击复制"
      onClick={copy}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') void copy(event)
      }}
      className={cn(
        'inline-block cursor-copy rounded border border-[var(--nx-border-hairline)] px-1.5 py-0.5 font-mono text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--nx-border-focus)]',
        className,
      )}
    >
      {copied ? '已复制' : `${prefix}${code}`}
    </span>
  )
}

export default CopyableCode
