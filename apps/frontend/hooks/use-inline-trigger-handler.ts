'use client'

/**
 * v3-copilot-inline-triggers —— 监听内联触发事件并注入引用到面板输入。
 *
 * 本 hook 挂载在 CopilotPanelInput 或 CopilotSidebarPanel 中，
 * 监听 'copilot:inline-trigger' 自定义事件，
 * 将结构化 MentionReference 注入到面板输入的 selectedMentions 状态。
 */

import React from 'react'
import type { MentionReference } from '@aiproj/types'

/** 内联触发事件详情。 */
export interface InlineTriggerDetail {
  /** 结构化提及引用。 */
  mention: MentionReference
  /** 当前路由。 */
  currentRoute: string
}

/** 内联触发事件回调类型。 */
export type InlineTriggerCallback = (detail: InlineTriggerDetail) => void

/**
 * 监听内联触发事件。
 *
 * @param onTrigger - 收到引用时的回调（通常用于注入面板输入状态）。
 */
export function useInlineTriggerHandler(onTrigger: InlineTriggerCallback) {
  React.useEffect(() => {
    function handleInlineTrigger(event: Event) {
      const customEvent = event as CustomEvent<InlineTriggerDetail>
      if (customEvent.detail) {
        onTrigger(customEvent.detail)
      }
    }

    window.addEventListener('copilot:inline-trigger', handleInlineTrigger)
    return () => {
      window.removeEventListener('copilot:inline-trigger', handleInlineTrigger)
    }
  }, [onTrigger])
}
