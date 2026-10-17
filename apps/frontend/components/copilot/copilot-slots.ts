'use client'

import * as React from 'react'

/**
 * 挂载插槽契约（spec copilot-sidebar-shell / 任务 5.1–5.3；
 * 由 v3-copilot-live-submission-channel 任务 7.1 补齐至八个插槽）。
 *
 * 壳只声明插槽几何、滚动与溢出行为，并**原样渲染归属能力提供的内容**：
 * - `modeIndicator`：模式标识插槽（归属 v3-copilot-general-purpose-mode）
 * - `quickActionChips`：快捷芯片插槽（归属 v3-copilot-context-chips）
 * - `clarification`：澄清卡片插槽（归属 v3-copilot-clarification-and-assumptions）
 * - `assumptions`：假设清单插槽（同上归属）
 * - `confidenceIndicator`：可信度指示器插槽（同上归属）
 * - `unspecifiedInfoWarning`：未指明信息告警插槽（同上归属）
 * - `suggestionInbox`：建议收件箱插槽（归属 v3-copilot-suggestion-inbox）
 * - `memoryView`：记忆视图插槽（归属 v3-copilot-memory-user-and-project）
 *
 * 未提供时插槽**干净折叠**：不留空白、不错位、不渲染任何暗示「加载失败」的控件。
 * 壳内不含芯片派生逻辑、按页面动作表、假设编辑逻辑或置信度映射（5.4/5.5 测试）。
 *
 * 增加插槽而非在壳内硬编码顺序的原因：各能力 change 只提供内容，
 * 不必再改面板文件——此前七个组件全部造好却无人挂载，正是缺这层声明。
 */
export interface CopilotSlotsProps {
  modeIndicator?: React.ReactNode
  quickActionChips?: React.ReactNode
  clarification?: React.ReactNode
  assumptions?: React.ReactNode
  confidenceIndicator?: React.ReactNode
  unspecifiedInfoWarning?: React.ReactNode
  suggestionInbox?: React.ReactNode
  memoryView?: React.ReactNode
}

/** 插槽名清单（测试用：逐个断言可达）。 */
export const COPILOT_SLOT_NAMES = [
  'modeIndicator',
  'quickActionChips',
  'clarification',
  'assumptions',
  'confidenceIndicator',
  'unspecifiedInfoWarning',
  'suggestionInbox',
  'memoryView',
] as const satisfies readonly (keyof CopilotSlotsProps)[]

export type CopilotSlotName = (typeof COPILOT_SLOT_NAMES)[number]
