/**
 * v3-frontend-ai-usage-telemetry —— Copilot 面板事件采集 hook。
 *
 * 在面板打开、关闭、提交、芯片点击、动作点击与拒绝处接入采集。
 */

import { useEffect, useRef } from 'react'
import { useCopilotStore } from '@/stores/copilot-store'
import {
  trackCopilotPanelOpen,
  trackCopilotPanelClose,
  trackCopilotSessionTurn,
  trackCopilotFirstQuestionIntent,
  trackCopilotChipClick,
  trackCopilotActionClick,
  trackCopilotActionReject,
} from '@/lib/telemetry/copilot-telemetry-integration'
import { initTelemetryClient } from '@/lib/telemetry/telemetry-client'
import type { CopilotIntentClass } from '@aiproj/types'

/**
 * 初始化埋点客户端（在应用启动时调用一次）。
 */
export function initCopilotTelemetry(): void {
  initTelemetryClient()
}

/**
 * Copilot 面板事件采集 hook。
 *
 * 追踪面板打开、关闭、会话轮数等事件。
 */
export function useCopilotTelemetry(organizationId: string): {
  trackPanelOpen: () => void
  trackPanelClose: (hasSubmitted: boolean) => void
  trackSessionTurn: (turnCount: number) => void
  trackFirstQuestionIntent: (intentClass: CopilotIntentClass) => void
  trackChipClick: (chipId: string, chipSource: string) => void
  trackActionClick: (actionId: string, actionLabel: string) => void
  trackActionReject: (actionId: string, actionLabel: string) => void
} {
  const open = useCopilotStore((s) => s.open)
  const sessionId = useCopilotStore((s) => s.sessionId)
  const messages = useCopilotStore((s) => s.messages)
  const prevOpenRef = useRef(open)
  const hasSubmittedRef = useRef(false)

  // 追踪面板打开/关闭
  useEffect(() => {
    if (prevOpenRef.current === open) return

    if (open) {
      // 面板打开
      trackCopilotPanelOpen({ organizationId, sessionId })
      hasSubmittedRef.current = false
    } else {
      // 面板关闭
      trackCopilotPanelClose({
        organizationId,
        sessionId,
        hasSubmitted: hasSubmittedRef.current,
      })
    }

    prevOpenRef.current = open
  }, [open, organizationId, sessionId])

  // 追踪会话轮数
  useEffect(() => {
    if (messages.length > 0) {
      trackCopilotSessionTurn({
        organizationId,
        sessionId,
        turnCount: messages.length,
      })
      hasSubmittedRef.current = true
    }
  }, [messages.length, organizationId, sessionId])

  return {
    trackPanelOpen: () => {
      trackCopilotPanelOpen({ organizationId, sessionId })
    },
    trackPanelClose: (hasSubmitted: boolean) => {
      trackCopilotPanelClose({ organizationId, sessionId, hasSubmitted })
    },
    trackSessionTurn: (turnCount: number) => {
      trackCopilotSessionTurn({ organizationId, sessionId, turnCount })
    },
    trackFirstQuestionIntent: (intentClass: CopilotIntentClass) => {
      trackCopilotFirstQuestionIntent({ organizationId, sessionId, intentClass })
    },
    trackChipClick: (chipId: string, chipSource: string) => {
      trackCopilotChipClick({ organizationId, sessionId, chipId, chipSource })
    },
    trackActionClick: (actionId: string, actionLabel: string) => {
      trackCopilotActionClick({ organizationId, sessionId, actionId, actionLabel })
    },
    trackActionReject: (actionId: string, actionLabel: string) => {
      trackCopilotActionReject({ organizationId, sessionId, actionId, actionLabel })
    },
  }
}
