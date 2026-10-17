/**
 * v3-frontend-ai-usage-telemetry —— 前端埋点客户端。
 *
 * 实现要点：
 * - 不引入任何第三方分析 SDK（D1）
 * - 事件只含类别与计数，不含用户输入文本、实体标识、击键（D2）
 * - 批量发送，不在交互路径上产生额外往返（D5）
 * - 发送失败静默丢弃，不重试到影响交互（D5）
 * - 用户可关闭，关闭后前端不再发送（D4）
 */

import type {
  FrontendTelemetryEvent,
  FrontendTelemetryEventKind,
  FrontendTelemetryBatchRequest,
  CopilotIntentClass,
} from '@aiproj/types'

/** 批量发送窗口（毫秒）。 */
const BATCH_WINDOW_MS = 30_000

/** 批量发送最大事件数。 */
const BATCH_MAX_SIZE = 50

/** 发送端点。 */
const TELEMETRY_ENDPOINT = '/api/v1/frontend-telemetry'

/** localStorage key for telemetry enabled state. */
const TELEMETRY_ENABLED_KEY = 'aiproj-telemetry-enabled'

/**
 * 检查埋点是否启用。
 * 个人选择优先于组织默认值。
 */
function isTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem(TELEMETRY_ENABLED_KEY)
  // 如果个人有显式选择，使用个人选择
  if (stored !== null) {
    return stored === 'true'
  }
  // 回退到组织默认值
  const orgDefault = localStorage.getItem('aiproj-telemetry-org-default')
  if (orgDefault !== null) {
    return orgDefault === 'true'
  }
  // 默认启用
  return true
}

/**
 * 设置埋点开关状态（个人选择）。
 */
export function setTelemetryEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(TELEMETRY_ENABLED_KEY, String(enabled))
}

/**
 * 获取埋点开关状态。
 */
export function getTelemetryEnabled(): boolean {
  return isTelemetryEnabled()
}

/**
 * 埋点客户端状态。
 */
interface TelemetryClientState {
  /** 事件缓冲区。 */
  buffer: FrontendTelemetryEvent[]
  /** 批量发送定时器。 */
  timer: ReturnType<typeof setTimeout> | null
  /** 是否已初始化。 */
  initialized: boolean
}

/** 客户端状态（单例）。 */
const state: TelemetryClientState = {
  buffer: [],
  timer: null,
  initialized: false,
}

/**
 * 初始化埋点客户端。
 * 在应用启动时调用一次。
 */
export function initTelemetryClient(): void {
  if (state.initialized) return
  state.initialized = true

  // 注册页面卸载时发送剩余事件
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushBuffer)
  }
}

/**
 * 创建事件基础字段。
 */
function createEventBase(
  eventKind: FrontendTelemetryEventKind,
  organizationId: string,
  sessionId: string,
): FrontendTelemetryEvent {
  return {
    eventKind,
    timestamp: new Date().toISOString(),
    sessionId,
    organizationId,
  } as FrontendTelemetryEvent
}

/**
 * 记录面板打开事件。
 */
export function trackPanelOpen(params: { organizationId: string; sessionId: string }): void {
  const event = {
    ...createEventBase('panel_open', params.organizationId, params.sessionId),
    eventKind: 'panel_open' as const,
  }
  addToBuffer(event)
}

/**
 * 记录面板关闭事件。
 */
export function trackPanelClose(params: {
  organizationId: string
  sessionId: string
  hasSubmitted: boolean
}): void {
  const event = {
    ...createEventBase('panel_close', params.organizationId, params.sessionId),
    eventKind: 'panel_close' as const,
    hasSubmitted: params.hasSubmitted,
  }
  addToBuffer(event)
}

/**
 * 记录会话轮数事件。
 */
export function trackSessionTurn(params: {
  organizationId: string
  sessionId: string
  turnCount: number
}): void {
  const event = {
    ...createEventBase('session_turn', params.organizationId, params.sessionId),
    eventKind: 'session_turn' as const,
    turnCount: params.turnCount,
  }
  addToBuffer(event)
}

/**
 * 记录首问意图类别事件。
 */
export function trackFirstQuestionIntent(params: {
  organizationId: string
  sessionId: string
  intentClass: CopilotIntentClass
}): void {
  const event = {
    ...createEventBase('first_question_intent', params.organizationId, params.sessionId),
    eventKind: 'first_question_intent' as const,
    intentClass: params.intentClass,
  }
  addToBuffer(event)
}

/**
 * 记录放弃事件。
 */
export function trackAbandonment(params: { organizationId: string; sessionId: string }): void {
  const event = {
    ...createEventBase('abandonment', params.organizationId, params.sessionId),
    eventKind: 'abandonment' as const,
  }
  addToBuffer(event)
}

/**
 * 记录芯片点击事件。
 */
export function trackChipClick(params: {
  organizationId: string
  sessionId: string
  chipId: string
  chipSource: string
}): void {
  const event = {
    ...createEventBase('chip_click', params.organizationId, params.sessionId),
    eventKind: 'chip_click' as const,
    chipId: params.chipId,
    chipSource: params.chipSource,
  }
  addToBuffer(event)
}

/**
 * 记录动作卡片点击事件。
 */
export function trackActionClick(params: {
  organizationId: string
  sessionId: string
  actionId: string
  actionLabel: string
}): void {
  const event = {
    ...createEventBase('action_click', params.organizationId, params.sessionId),
    eventKind: 'action_click' as const,
    actionId: params.actionId,
    actionLabel: params.actionLabel,
  }
  addToBuffer(event)
}

/**
 * 记录动作卡片拒绝事件。
 */
export function trackActionReject(params: {
  organizationId: string
  sessionId: string
  actionId: string
  actionLabel: string
}): void {
  const event = {
    ...createEventBase('action_reject', params.organizationId, params.sessionId),
    eventKind: 'action_reject' as const,
    actionId: params.actionId,
    actionLabel: params.actionLabel,
  }
  addToBuffer(event)
}

/**
 * 将事件添加到缓冲区。
 */
function addToBuffer(event: FrontendTelemetryEvent): void {
  // 检查埋点开关（关闭后前端不再发送）
  if (!isTelemetryEnabled()) {
    return
  }

  state.buffer.push(event)

  // 如果缓冲区达到最大值，立即发送
  if (state.buffer.length >= BATCH_MAX_SIZE) {
    flushBuffer()
    return
  }

  // 启动定时器（如果未启动）
  if (!state.timer) {
    state.timer = setTimeout(() => {
      flushBuffer()
    }, BATCH_WINDOW_MS)
  }
}

/**
 * 发送缓冲区中的事件。
 */
async function flushBuffer(): Promise<void> {
  if (state.buffer.length === 0) return

  // 取出缓冲区中的事件
  const events = [...state.buffer]
  state.buffer = []

  // 清除定时器
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }

  // 构建批量请求
  const request: FrontendTelemetryBatchRequest = { events }

  try {
    // 发送请求（静默失败，不重试）
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      // 使用 keepalive 确保页面卸载时也能发送
      keepalive: true,
    })
  } catch {
    // 静默丢弃，不重试到影响交互
  }
}

/**
 * 获取当前缓冲区（用于测试）。
 */
export function getBuffer(): readonly FrontendTelemetryEvent[] {
  return state.buffer
}

/**
 * 清空缓冲区（用于测试）。
 */
export function clearBuffer(): void {
  state.buffer = []
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
  }
}
