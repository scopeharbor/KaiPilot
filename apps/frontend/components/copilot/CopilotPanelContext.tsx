'use client'

/**
 * v3-copilot-mode-adaptation — Copilot 面板上下文。
 *
 * 把面板形态（drawer/fullscreen/minimized）与用户模式（novice/professional）
 * 向下传递给插槽组件，避免 prop drilling。
 *
 * 约束：上下文不包含任何业务数据或写入能力——仅传递渲染决策信号。
 */
import * as React from 'react'
import type { CopilotPanelForm, CopilotUserMode } from '@/stores/copilot-store'

export interface CopilotPanelContextValue {
  /** 当前面板形态。 */
  form: CopilotPanelForm
  /** 解析后的用户模式。 */
  userMode: CopilotUserMode
}

export const CopilotPanelContext = React.createContext<CopilotPanelContextValue>({
  form: 'drawer',
  userMode: 'novice',
})

/** 面板形态在全屏时为 true。 */
export function useIsFullscreen(): boolean {
  const ctx = React.useContext(CopilotPanelContext)
  return ctx.form === 'fullscreen'
}

/** 用户模式是否为新手。 */
export function useIsNovice(): boolean {
  const ctx = React.useContext(CopilotPanelContext)
  return ctx.userMode === 'novice'
}
