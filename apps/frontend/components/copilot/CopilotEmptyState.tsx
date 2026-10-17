'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, GraduationCap } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { useCopilotStore } from '@/stores/copilot-store'
import { resolveUserMode } from '@/stores/copilot-store'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

/**
 * 空状态引导（spec copilot-sidebar-shell / 任务 5.6、5.7）。
 *
 * 首次打开无会话时给出可点击示例问题：
 * - 示例按**当前路由**与**当前角色权限**过滤（`requiresPermission` 命中才显示）；
 * - 点击只把问题**填入输入框**（不自动执行、不发起任何请求——红线任务组 7）；
 * - 没有任何可用权限时降级为一句直白文案，不暗示存在隐藏能力（5.7）。
 */
export interface CopilotEmptyStateProps {
  /** 点击示例问题：把问题填入输入框（由面板提供实现）。 */
  onPick: (text: string) => void
}

interface ExamplePrompt {
  text: string
  /** 路由正则；undefined 表示任意路由可用。 */
  route?: RegExp
  /** 所需权限；undefined 表示登录即可。 */
  permission?: string[]
}

const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = [
  { text: '你好，介绍一下你能帮我做什么', permission: ['ai:trigger'] },
  { text: '帮我创建一个新项目', permission: ['project:create'] },
  {
    text: '梳理这个项目当前的关键路径与里程碑',
    route: /\/projects\/.+/,
    permission: ['project:view'],
  },
  {
    text: '帮我分析任务依赖中可能阻塞进度的问题',
    route: /\/projects\/.+/,
    permission: ['project:view'],
  },
  {
    text: '总结本周项目进展',
    route: /\/projects\/.+/,
    permission: ['project:view'],
  },
  {
    text: '解释项目管理中「关键路径」是什么意思',
    permission: ['project:view'],
  },
  {
    text: '甘特图里的任务依赖是如何影响排期的？',
    permission: ['project:view'],
  },
  {
    text: '如何创建新项目并让 AI 帮忙拆解计划？',
    permission: ['project:create'],
  },
]

/** 降级文案：没有任何可用能力时的不泄露提示（5.7）。 */
export const COPILOT_EMPTY_STATE_DEGRADED_TEXT =
  '当前没有可用于 AI 协助的权限。可以在项目页面或具备权限的入口稍后再试。'

export function CopilotEmptyState({ onPick }: CopilotEmptyStateProps) {
  const pathname = usePathname() ?? '/'
  const { canAny } = usePermissions()
  const copilotUserMode = useCopilotStore((s) => s.copilotUserMode)
  const { mode: resolvedMode } = resolveUserMode({
    explicitSelection: copilotUserMode,
    proInferred: false,
  })
  const isNovice = resolvedMode === 'novice'

  const visible = React.useMemo(() => {
    const matches = EXAMPLE_PROMPTS.filter((p) => {
      if (p.route && !p.route.test(pathname)) return false
      if (p.permission && p.permission.length > 0 && !canAny(p.permission)) return false
      return true
    })
    return matches
  }, [pathname, canAny])

  if (visible.length === 0) {
    return (
      <div
        data-copilot-empty-state
        data-copilot-user-mode={resolvedMode}
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <Sparkles className="h-8 w-8 text-ai" aria-hidden />
        <p className="text-sm text-gray-500">{COPILOT_EMPTY_STATE_DEGRADED_TEXT}</p>
      </div>
    )
  }

  return (
    <div
      data-copilot-empty-state
      data-copilot-user-mode={resolvedMode}
      className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <Sparkles className="h-8 w-8 text-ai" aria-hidden />
      <div>
        <p className="text-sm font-medium text-gray-800">我是 AI Copilot</p>
        {isNovice ? (
          <>
            {/* 新手模式：突出引导文案（4.3） */}
            <p className="mt-1 text-xs text-gray-500">从下面挑一个问题开始，或直接输入你的需求。</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-[10px] text-gray-400">
              <GraduationCap className="h-3 w-3" aria-hidden />
              新手模式：更多引导与示例
            </p>
          </>
        ) : (
          /* 专业模式：不强调引导（4.4） */
          <p className="mt-1 text-xs text-gray-500">输入你的需求，或选择一个示例。</p>
        )}
      </div>
      <ul className="flex w-full max-w-xs flex-col gap-1.5">
        {visible.map((p) => (
          <li key={p.text}>
            <button
              type="button"
              data-copilot-example
              onClick={() => onPick(p.text)}
              className={cn(
                'w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700',
                focusRing,
              )}
            >
              {p.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
