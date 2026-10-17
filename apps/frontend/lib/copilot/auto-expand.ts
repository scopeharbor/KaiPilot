/**
 * v3-copilot-mode-adaptation — 上下文自动展开逻辑（§6/§7）。
 *
 * 仅在最高严重度（critical）建议出现时自动打开面板。
 * 约束：
 * - 可通过偏好关闭（6.3）
 * - 不打断进行中的输入（6.5）
 * - 面板已打开时只滚动不改焦点（6.7）
 * - 同一会话内只触发一次（6.9）
 * - 只呈现建议，不执行任何动作（7.1）
 * - 触发依据来自已按组织隔离过滤的建议（7.3）
 *
 * 本模块是纯逻辑，不包含 UI。UI 层通过 useAutoExpand hook 消费。
 */
import type { InboxSeverity } from '@aiproj/types'

/** 最高严重度——只有此级别触发自动展开（D3）。 */
export const AUTO_EXPAND_SEVERITY: InboxSeverity = 'critical'

/**
 * 判断给定严重度是否应触发自动展开。
 * 只有 critical 级别触发（6.1）。
 */
export function shouldTriggerAutoExpand(severity: InboxSeverity): boolean {
  return severity === AUTO_EXPAND_SEVERITY
}

/**
 * 自动展开决策。
 *
 * @param params.enabled - 用户偏好是否启用自动展开
 * @param params.triggered - 本次会话是否已触发过
 * @param params.isTyping - 用户是否正在输入
 * @param params.panelOpen - 面板是否已打开
 * @param params.severity - 建议严重度
 * @returns 是否应执行自动展开
 */
export function evaluateAutoExpand(params: {
  enabled: boolean
  triggered: boolean
  isTyping: boolean
  panelOpen: boolean
  severity: InboxSeverity
}): { action: 'expand' | 'scroll' | 'skip'; reason: string } {
  // 6.3：偏好关闭时不触发
  if (!params.enabled) {
    return { action: 'skip', reason: 'auto-expand disabled by preference' }
  }

  // 6.9：同一会话内只触发一次
  if (params.triggered) {
    return { action: 'skip', reason: 'already triggered this session' }
  }

  // 6.1：只有最高严重度触发
  if (!shouldTriggerAutoExpand(params.severity)) {
    return { action: 'skip', reason: `severity ${params.severity} is below threshold` }
  }

  // 6.5：正在输入时不打断
  if (params.isTyping) {
    return { action: 'skip', reason: 'user is typing' }
  }

  // 6.7：面板已打开时只滚动
  if (params.panelOpen) {
    return { action: 'scroll', reason: 'panel already open, scroll to suggestion' }
  }

  return { action: 'expand', reason: 'highest severity suggestion arrived' }
}
