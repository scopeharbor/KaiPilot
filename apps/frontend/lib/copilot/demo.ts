'use client'

import type { CopilotMessage } from '@aiproj/types'
import { generateCopilotMessageId } from '@aiproj/types'
import { useCopilotStore } from '@/stores/copilot-store'
import {
  boundedCopilotSummary,
  buildCopilotDemoActions,
  buildCopilotDemoAssumptions,
  buildCopilotDemoReply,
} from '@/components/copilot/copilot-fixtures'
import { clearCopilotDemoCursor, writeCopilotDemoCursor } from '@/lib/copilot/demo-cursor'

/**
 * 面板本阶段的**演示编排**（v3-copilot-sidebar-shell）。
 *
 * 意图路由 / 动作确认通道未接入：提交只做本机 fixture 演示——
 * 追加一条用户消息（有界摘要）→ 进入分步流式状态 → 由面板组件推进阶段 →
 * 完成后追加演示回复与动作/假设演示数据。**零网络、零业务写入**（红线任务组 7）。
 *
 * 后续 change 接入生产通道后，本模块由真实 submit/SSE 消费替换，渲染面不变。
 */

/** 提交演示（任务 2.4/4.6 的入口；Cmd/Ctrl+Enter 与提交按钮共用）。 */
export function submitCopilotDemo(draft: string): void {
  const text = draft.trim()
  if (!text) return
  const store = useCopilotStore.getState()
  if (store.streaming) return

  const userMessage: CopilotMessage = {
    messageId: generateCopilotMessageId(),
    sessionId: store.sessionId,
    role: 'user',
    messageSummary: boundedCopilotSummary(text),
    sourceRefs: [],
    createdAt: new Date().toISOString(),
  }
  store.appendMessage(userMessage)
  startCopilotDemoStream()
}

/**
 * 只启动演示流式，**不追加用户消息**。
 *
 * v3-copilot-live-submission-channel：真实提交通道已经先落过用户消息，
 * 降级时若再调 `submitCopilotDemo` 会把同一条消息追加两次。故拆出本函数，
 * 供降级路径复用演示流式与游标，而不重复落消息。
 */
export function startCopilotDemoStream(): void {
  const store = useCopilotStore.getState()
  if (store.streaming) return
  store.clearDraft()
  store.setDemoActions([])
  store.setDemoAssumptions([])
  store.setStreamError(null)
  store.setStreaming(true, 'understanding')
  writeCopilotDemoCursor(store.sessionId, 'understanding')
}

/** 取消演示生成（任务 4.7：中止且不呈现部分结果为完成态）。 */
export function cancelCopilotDemo(): void {
  const store = useCopilotStore.getState()
  store.setStreaming(false, 'cancelled')
  clearCopilotDemoCursor()
}

/** 演示流式完成：追加演示回复与动作/假设数据（由面板流式推进到末步时调用）。 */
export function completeCopilotDemo(): void {
  const store = useCopilotStore.getState()
  store.appendMessage(buildCopilotDemoReply())
  store.setDemoActions(buildCopilotDemoActions())
  store.setDemoAssumptions(buildCopilotDemoAssumptions())
  store.setStreaming(false, 'done')
  clearCopilotDemoCursor()
}
