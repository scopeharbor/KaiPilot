'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eraser } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * v3-ai-draft-live-output-panel —— AI 一键生成的实时输出固定窗口。
 *
 * 固定在 9 阶段进度卡正下方（由工作台 flex 布局保证，不越出生成区域）：
 * - 终端风格：等宽字体、深色底、内部滚动，新内容从底部追加（旧内容向上滚动）；
 * - 自动跟随底部；用户上滚查看历史时暂停跟随，回到底部恢复；
 * - 头部：状态点 + 标题 + 当前生成模块 + 累积输出字符数 + 清空/折叠；
 * - 生成中显示流式光标（尊重 prefers-reduced-motion）。
 */

export const DRAFT_OUTPUT_SCROLL_FOLLOW_TOLERANCE_PX = 24

export interface DraftOutputPanelProps {
  /** store.streamOutput：已累积的模型输出纯文本。 */
  text: string
  /** store.streamOutputActive：生成是否仍在输出。 */
  active: boolean
  /** 当前生成中的模块中文名（如「任务清单」）；无则省略。 */
  currentModuleLabel?: string | null
  /** 清空面板（store.clearStreamOutput）。 */
  onClear: () => void
}

export function DraftOutputPanel({
  text,
  active,
  currentModuleLabel,
  onClear,
}: DraftOutputPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  // 新文本到达且处于跟随模式 → 滚到底部（内容「往上面跑」）
  useEffect(() => {
    const el = containerRef.current
    if (el && following) el.scrollTop = el.scrollHeight
  }, [text, following])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= DRAFT_OUTPUT_SCROLL_FOLLOW_TOLERANCE_PX
    // 用户滚回底部 → 恢复跟随；离开底部 → 暂停跟随（自动滚动也经由此判定，幂等）
    setFollowing(atBottom)
  }

  const jumpToBottom = () => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
    setFollowing(true)
  }

  return (
    <section
      data-draft-output-panel
      className="overflow-hidden rounded-[var(--radius-lg)] border border-border/80 bg-gray-950 text-gray-200 shadow-sm"
      aria-label="AI 生成实时输出"
    >
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span
          className={cn(
            'relative h-2 w-2 shrink-0 rounded-full',
            active ? 'animate-pulse bg-ai motion-reduce:animate-none' : 'bg-gray-500',
          )}
          aria-hidden
        />
        <h3 className="text-sm font-medium text-gray-100">AI 实时输出</h3>
        {currentModuleLabel ? (
          <span className="truncate rounded-full bg-white/10 px-2 py-0.5 text-xs text-gray-300">
            当前生成：{currentModuleLabel}
          </span>
        ) : null}
        <span className="ml-auto hidden text-xs tabular-nums text-gray-400 sm:inline" aria-hidden>
          {text.length.toLocaleString()} 字符
        </span>
        <span className="sr-only">
          {active ? '生成中' : '已结束'}，已输出 {text.length} 字符
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
          aria-label="清空实时输出"
        >
          <Eraser className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
          aria-label={collapsed ? '展开实时输出' : '折叠实时输出'}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </button>
      </header>

      {!collapsed ? (
        <div
          ref={containerRef}
          data-draft-output-body
          className="relative max-h-60 min-h-20 overflow-y-auto overscroll-contain px-3 py-2"
          onScroll={handleScroll}
        >
          <div
            className="font-mono text-xs leading-5 text-gray-300"
            aria-live="polite"
            aria-atomic="false"
          >
            {text ? (
              <>
                <span className="whitespace-pre-wrap break-words">{text}</span>
                {active ? (
                  <span
                    className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : (
                  <span className="block text-gray-500">— 已结束 —</span>
                )}
              </>
            ) : active ? (
              <span className="text-gray-400">正在等待模型输出…</span>
            ) : (
              <span className="text-gray-500">暂无输出</span>
            )}
          </div>

          {!following && text ? (
            <button
              type="button"
              onClick={jumpToBottom}
              data-draft-output-following="paused"
              className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-200 shadow transition-colors hover:bg-gray-700"
            >
              已暂停跟随 · 点击回到底部
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
