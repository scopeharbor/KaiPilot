'use client'

/**
 * v3-copilot-mode-adaptation — 模式切换入口（任务 4.8）。
 *
 * 提供新手/专业模式的显式切换，带无障碍标签。
 * 切换结果持久化到 copilot-store（partialize）。
 *
 * 两种模式下红线提示（假设清单、可信度指示器、确认入口）均可见——
 * 模式差异只在引导密度（D2）。
 */
import * as React from 'react'
import { GraduationCap, Briefcase } from 'lucide-react'
import { useCopilotStore } from '@/stores/copilot-store'
import { resolveUserMode, type CopilotUserMode } from '@/stores/copilot-store'
import { cn } from '@/lib/utils'
import { focusRing } from '@/lib/variants'

export function CopilotModeSwitch() {
  const copilotUserMode = useCopilotStore((s) => s.copilotUserMode)
  const setCopilotUserMode = useCopilotStore((s) => s.setCopilotUserMode)

  const { mode: resolvedMode } = resolveUserMode({
    explicitSelection: copilotUserMode,
    proInferred: false,
  })

  function toggle() {
    const next: CopilotUserMode = resolvedMode === 'novice' ? 'professional' : 'novice'
    setCopilotUserMode(next)
  }

  return (
    <button
      type="button"
      data-copilot-mode-switch
      aria-label={`当前为${resolvedMode === 'novice' ? '新手' : '专业'}模式，点击切换`}
      onClick={toggle}
      className={cn(
        'flex items-center gap-1 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[10px] transition-colors hover:bg-gray-50',
        focusRing,
      )}
    >
      {resolvedMode === 'novice' ? (
        <>
          <GraduationCap className="h-3 w-3 text-gray-500" aria-hidden />
          <span className="text-gray-600">新手</span>
        </>
      ) : (
        <>
          <Briefcase className="h-3 w-3 text-gray-500" aria-hidden />
          <span className="text-gray-600">专业</span>
        </>
      )}
    </button>
  )
}
