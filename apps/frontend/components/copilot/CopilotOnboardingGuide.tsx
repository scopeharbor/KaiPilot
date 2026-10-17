'use client'

/**
 * v3-copilot-mode-adaptation — Copilot 新手引导步骤（§5 任务 5.1–5.5）。
 *
 * 在首次使用时显示一个简洁的引导卡片，介绍 Copilot 入口与快捷键。
 *
 * 约束（spec REQ）：
 * - 复用同一份 localStorage 完成记录（5.2：不新建第二套状态机）。
 * - 跳过后不再出现（5.3：跳过即标记完成）。
 * - 刷新后不再出现（5.4：完成记录持久化）。
 * - 内容指向 Copilot 实际入口与快捷键（5.5）。
 *
 * 零网络、零 provider。
 */
import * as React from 'react'
import { Sparkles, X, Keyboard } from 'lucide-react'
import { useCopilotStore } from '@/stores/copilot-store'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

/** localStorage key——与 copilot-store 同域但独立键。 */
const ONBOARDING_KEY = 'aiproj-copilot-onboarding-completed'

/** 检查引导是否已完成。 */
function isOnboardingCompleted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'true'
  } catch {
    return false
  }
}

/** 标记引导为已完成。 */
function completeOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, 'true')
  } catch {
    // localStorage 不可用时静默降级
  }
}

export function CopilotOnboardingGuide() {
  const [visible, setVisible] = React.useState(false)
  const open = useCopilotStore((s) => s.open)

  // 首次挂载时检查是否需要显示引导
  React.useEffect(() => {
    if (!open && !isOnboardingCompleted()) {
      setVisible(true)
    }
  }, [open])

  // 如果面板已打开，隐藏引导（用户已自行发现入口）
  React.useEffect(() => {
    if (open && visible) {
      setVisible(false)
    }
  }, [open, visible])

  function handleDismiss() {
    completeOnboarding()
    setVisible(false)
  }

  function handleSkip() {
    completeOnboarding()
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      data-copilot-onboarding
      role="dialog"
      aria-label="AI Copilot 新手引导"
      className="fixed bottom-20 right-6 z-[calc(var(--z-sticky)+2)] w-72 rounded-[var(--radius-lg)] border border-border bg-gray-0 shadow-lg"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-ai" aria-hidden />
          <span className="text-xs font-medium text-gray-800">认识 AI Copilot</span>
        </div>
        <button
          type="button"
          data-copilot-onboarding-close
          aria-label="关闭引导"
          onClick={handleDismiss}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-gray-400 hover:text-gray-600',
            focusRing,
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* 内容 */}
      <div className="px-3 py-3 text-xs text-gray-600">
        <p>AI Copilot 可以帮你分析项目进度、回答管理问题、生成摘要。</p>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400">
          <Keyboard className="h-3 w-3" aria-hidden />
          <span>
            快捷键{' '}
            <kbd className="rounded border border-border bg-gray-50 px-1 py-0.5 font-mono text-[10px]">
              Ctrl+Shift+C
            </kbd>{' '}
            打开面板
          </span>
        </div>
        <p className="mt-2 text-[10px] text-gray-400">
          你也可以点击侧栏的 <Sparkles className="inline h-3 w-3 text-ai" aria-hidden /> 图标。
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <button
          type="button"
          data-copilot-onboarding-skip
          onClick={handleSkip}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          稍后再说
        </button>
        <button
          type="button"
          data-copilot-onboarding-open
          onClick={() => {
            completeOnboarding()
            setVisible(false)
            useCopilotStore.getState().setOpen(true)
          }}
          className={cn(
            'rounded-[var(--radius-sm)] bg-[var(--primary-500)] px-3 py-1 text-[10px] text-white hover:bg-[var(--primary-600)]',
            focusRing,
          )}
        >
          打开 Copilot
        </button>
      </div>
    </div>
  )
}
