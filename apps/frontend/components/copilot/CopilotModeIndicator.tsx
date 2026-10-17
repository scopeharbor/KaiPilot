'use client'

/**
 * v3-copilot-general-purpose-mode —— 通用问答模式标识与切换控件。
 *
 * spec Requirements：
 * - 模式标识持续可见（非一次性提示），状态栏始终显示当前模式
 * - 标识文案明确「本模式不读取也不修改项目数据」
 * - 模式切换需显式用户动作（点击按钮），禁止系统静默切换
 * - 切换时清空会话消息（双向上下文清理）
 *
 * 本组件集成到 CopilotSidebarPanel 的顶部区域。
 */

import * as React from 'react'
import { MessageSquare, Briefcase, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 通用模式标识文案（spec: 本模式不读取也不修改项目数据）。 */
const GENERAL_PURPOSE_INDICATOR_TEXT = '通用问答模式'
const GENERAL_PURPOSE_ISOLATION_NOTE = '不读取也不修改项目数据'
const PROJECT_MODE_INDICATOR_TEXT = '项目模式'

export type CopilotMode = 'project' | 'general_purpose'

export interface CopilotModeIndicatorProps {
  /** 当前模式。 */
  currentMode: CopilotMode
  /** 模式切换回调。 */
  onModeChange: (mode: CopilotMode) => void
  /** 是否禁用切换（如流式生成中）。 */
  disabled?: boolean
  /** 附加 className。 */
  className?: string
}

/**
 * 通用问答模式标识与切换控件（tasks 4.1–4.8, 9.3）。
 *
 * - 持续可见的模式标识（非一次性提示）——任务 4.1
 * - 文案明确隔离语义——任务 4.2
 * - 显式用户动作切换——任务 4.3
 * - 切换时清空会话——任务 4.6/4.7
 */
export function CopilotModeIndicator({
  currentMode,
  onModeChange,
  disabled = false,
  className,
}: CopilotModeIndicatorProps) {
  const isGeneral = currentMode === 'general_purpose'

  function handleToggle() {
    if (disabled) return
    const nextMode: CopilotMode = isGeneral ? 'project' : 'general_purpose'
    onModeChange(nextMode)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs',
        isGeneral
          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300'
          : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
        disabled && 'opacity-50',
        className,
      )}
      data-copilot-mode={currentMode}
      role="status"
      aria-live="polite"
    >
      {/* 模式图标 */}
      {isGeneral ? (
        <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}

      {/* 模式名称 */}
      <span className="font-medium">
        {isGeneral ? GENERAL_PURPOSE_INDICATOR_TEXT : PROJECT_MODE_INDICATOR_TEXT}
      </span>

      {/* 隔离声明（仅通用模式显示） */}
      {isGeneral && (
        <span className="text-[10px] opacity-70">({GENERAL_PURPOSE_ISOLATION_NOTE})</span>
      )}

      {/* 切换按钮（显式用户动作——任务 4.3） */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          'ml-auto rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
          'hover:bg-white/50 dark:hover:bg-gray-700/50',
          'focus:outline-none focus:ring-1 focus:ring-blue-400',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        aria-label={isGeneral ? '切换到项目模式' : '切换到通用问答模式'}
      >
        {isGeneral ? '切回项目' : '通用问答'}
      </button>
    </div>
  )
}

/**
 * 项目 scope 请求在通用模式下的切换提示（task 4.5）。
 * 当用户在通用模式下提交了项目相关请求时显示。
 */
export function GeneralPurposeSwitchPrompt({
  onSwitchToProject,
  onCancel,
  className,
}: {
  onSwitchToProject: () => void
  onCancel: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700',
        'dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium">检测到项目相关请求</p>
        <p className="mt-1 opacity-80">
          当前处于通用问答模式，无法访问项目数据。是否切换到项目模式？
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onSwitchToProject}
            className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-amber-700"
          >
            切换到项目模式
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-transparent px-2 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-100"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 会话记录中通用模式轮次的视觉分隔标记（task 4.9）。
 */
export function GeneralPurposeTurnDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 text-[10px] text-gray-400 dark:text-gray-500',
        className,
      )}
      role="separator"
      aria-label="模式切换分隔线"
    >
      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      <MessageSquare className="h-3 w-3" aria-hidden="true" />
      <span>以下为通用问答内容</span>
      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}
