/**
 * v3-frontend-ai-usage-telemetry —— Copilot 面板事件采集集成。
 *
 * 在面板打开、关闭、提交、芯片点击、动作点击与拒绝处接入采集。
 */

import {
  trackPanelOpen,
  trackPanelClose,
  trackSessionTurn,
  trackFirstQuestionIntent,
  trackAbandonment,
  trackChipClick,
  trackActionClick,
  trackActionReject,
} from './telemetry-client'
import type { CopilotIntentClass } from '@aiproj/types'

/**
 * 追踪面板打开事件。
 */
export function trackCopilotPanelOpen(params: { organizationId: string; sessionId: string }): void {
  trackPanelOpen(params)
}

/**
 * 追踪面板关闭事件（含放弃判断）。
 */
export function trackCopilotPanelClose(params: {
  organizationId: string
  sessionId: string
  hasSubmitted: boolean
}): void {
  trackPanelClose(params)

  // 如果未提交，记录放弃事件
  if (!params.hasSubmitted) {
    trackAbandonment({
      organizationId: params.organizationId,
      sessionId: params.sessionId,
    })
  }
}

/**
 * 追踪会话轮数事件。
 */
export function trackCopilotSessionTurn(params: {
  organizationId: string
  sessionId: string
  turnCount: number
}): void {
  trackSessionTurn(params)
}

/**
 * 追踪首问意图类别事件。
 */
export function trackCopilotFirstQuestionIntent(params: {
  organizationId: string
  sessionId: string
  intentClass: CopilotIntentClass
}): void {
  trackFirstQuestionIntent(params)
}

/**
 * 追踪芯片点击事件。
 */
export function trackCopilotChipClick(params: {
  organizationId: string
  sessionId: string
  chipId: string
  chipSource: string
}): void {
  trackChipClick(params)
}

/**
 * 追踪动作卡片点击事件。
 */
export function trackCopilotActionClick(params: {
  organizationId: string
  sessionId: string
  actionId: string
  actionLabel: string
}): void {
  trackActionClick(params)
}

/**
 * 追踪动作卡片拒绝事件。
 */
export function trackCopilotActionReject(params: {
  organizationId: string
  sessionId: string
  actionId: string
  actionLabel: string
}): void {
  trackActionReject(params)
}
