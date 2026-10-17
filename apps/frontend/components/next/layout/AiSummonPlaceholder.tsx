'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { nextSummonShortcutLabel } from '@/hooks/use-next-shortcuts'
import { useNextAiColleagueStore } from '@/stores/next-ai-colleague-store'

/**
 * AI 同事唤起触发按钮（v3-ui-next-ai-colleague W4 · tasks 4.1）。
 *
 * 替换 v3-ui-next-shell-space-map 的 AiSummonPlaceholder 占位气泡（设计 D5 第三层
 * 升级为正式入口，保留原文件名以保证向后兼容引用）。
 *
 * - 直连 `useNextAiColleagueStore`：`aria-expanded` 动态绑定 `isOpen`，
 *   点击分发 `toggleOpen`；`Ctrl+/` 和弦由顶栏 useNextShortcuts 单点分发到
 *   Store（本组件不重复注册监听）；
 * - `data-ai-colleague-trigger` 是面板关闭后焦点回跳的落点（W2
 *   `AiColleaguePanel.onCloseAutoFocus` 契约），不得改名或移除；
 * - 零网络 / 零数据获取：纯 UI 入口（RL-01）。
 */
export function AiColleagueTrigger() {
  const isOpen = useNextAiColleagueStore((state) => state.isOpen)
  const toggleOpen = useNextAiColleagueStore((state) => state.toggleOpen)

  return (
    <button
      type="button"
      data-ai-colleague-trigger=""
      aria-label="AI 唤起"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      onClick={toggleOpen}
      className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-[var(--nx-border-hairline)] bg-[var(--nx-bg-1)] px-2.5 text-sm text-[var(--nx-text-secondary)] transition-colors hover:border-[var(--nx-border-focus)] hover:text-[var(--nx-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--nx-bg-0)] xl:h-9 xl:px-3"
    >
      <Sparkles className="h-4 w-4 text-[var(--nx-ai)]" aria-hidden />
      <span className="hidden sm:inline">AI 唤起</span>
      <kbd className="hidden rounded-[4px] border border-[var(--nx-border-hairline)] px-1 font-mono text-[10px] leading-4 text-[var(--nx-text-muted)] xl:inline-block">
        {nextSummonShortcutLabel()}
      </kbd>
    </button>
  )
}

export default AiColleagueTrigger
