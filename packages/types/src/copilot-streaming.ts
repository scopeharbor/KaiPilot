/**
 * v3-copilot-live-streaming-output —— Copilot 流式输出共享契约。
 *
 * 定义 Copilot 回合流式端点的 SSE 事件协议：turn-meta / answer-delta /
 * answer-done / turn-clarify / turn-route / turn-error 六类事件、增量文本
 * 上界、事件序列校验与禁存校验 helper。
 *
 * 纯类型 + 确定性常量 + 纯函数，零 Adonis/React/数据库/网络/时钟/随机依赖。
 *
 * 命名纪律：全部导出使用 Copilot / COPILOT / copilot 前缀（与既有
 * copilot-turn / copilot-shared-contracts 纪律一致）。
 */

import type { CopilotClarificationItem, CopilotRouterDestination } from './copilot-intent-router.js'
import type { CopilotScope } from './copilot-shared-contracts.js'
import type { CopilotWebSearchGateCode } from './copilot-web-search.js'

// ===========================================================================
// 流式端点常量
// ===========================================================================

/** 流式端点路径（独立于非流式回合端点）。 */
export const COPILOT_STREAM_ENDPOINT = '/api/v1/copilot/turns/stream'

/**
 * 单条 `answer-delta` 增量文本上界（字符）。
 *
 * 超过该上界的增量被服务端截断后推送（summarize/truncate 由消费端与
 * 持久化摘要各自承担，协议层只保证单帧有界）。
 */
export const COPILOT_STREAM_DELTA_MAX_LENGTH = 4_000

/** 单次流式帧（event + data）的序列号起点。 */
export const COPILOT_STREAM_SEQUENCE_START = 1

/** SSE 帧分隔符（协议层固定）。 */
export const COPILOT_STREAM_FRAME_SEPARATOR = '\n\n'

// ===========================================================================
// 流式事件类型（服务端 → 客户端）
// ===========================================================================

/** turn-meta：首个事件，携带会话归属与意图摘要（低敏）。 */
export interface CopilotStreamTurnMetaEvent {
  readonly type: 'turn-meta'
  /** 事件序号，单调递增。 */
  readonly sequence: number
  /** 会话 ID（回合内新建则在此返回）。 */
  readonly sessionId: string
  /** 路由出的目的地键（只给键，不给内容细节；低敏）。 */
  readonly destinations: readonly string[]
  /** 归一化意图摘要（有界低敏）。 */
  readonly intentSummary: string
  readonly scope: CopilotScope
  /**
   * 页面上下文披露（可选，v3-copilot-authoritative-page-context）。
   * 服务端权威解析后的透明信息；流式回合经此事件下发，旧客户端忽略即可。
   */
  readonly pageContextDisclosure?: import('./copilot-page-context.js').CopilotPageContextDisclosureV1
}

/** answer-delta：答案增量文本。 */
export interface CopilotStreamAnswerDeltaEvent {
  readonly type: 'answer-delta'
  readonly sequence: number
  /** 增量文本（已脱敏、已过 sanitizer，单帧 ≤ COPILOT_STREAM_DELTA_MAX_LENGTH）。 */
  readonly delta: string
}

/** answer-done：答案流正常结束，携带持久化后的 assistant 消息 id。 */
export interface CopilotStreamAnswerDoneEvent {
  readonly type: 'answer-done'
  readonly sequence: number
  readonly assistantMessageId: string
  /** 累计完整答案（低敏摘要；供客户端终态一致性复核，非必存）。 */
  readonly contentSummary: string
  /**
   * 网页搜索门状态（可选；v3-copilot-optional-web-search-configuration）。
   * 仅在「实际调用或降级」时携带；未配置/未涉及/router 不需要时为 null。
   */
  readonly webSearchStatus?: {
    readonly code: CopilotWebSearchGateCode
    readonly message: string
  } | null
}

/** turn-clarify：终态——需要澄清，不产出任何答案增量。 */
export interface CopilotStreamClarifyEvent {
  readonly type: 'turn-clarify'
  readonly sequence: number
  readonly items: readonly CopilotClarificationItem[]
}

/** turn-route：终态——需要用户确认的变更类目的地。 */
export interface CopilotStreamRouteEvent {
  readonly type: 'turn-route'
  readonly sequence: number
  readonly destinations: readonly CopilotRouterDestination[]
}

/** turn-error：终态——稳定失败分类（不含后端 message / 状态码 / secret）。 */
export interface CopilotStreamErrorEvent {
  readonly type: 'turn-error'
  readonly sequence: number
  /** 稳定失败分类键（auth/permission/validation/rate-limit/stale/conflict/empty/retryable-service/transport）。 */
  readonly errorKind: string
  /** 可选退化原因（低敏）。 */
  readonly degradedReason?: string
}

/** 六类事件 union。 */
export type CopilotStreamEvent =
  | CopilotStreamTurnMetaEvent
  | CopilotStreamAnswerDeltaEvent
  | CopilotStreamAnswerDoneEvent
  | CopilotStreamClarifyEvent
  | CopilotStreamRouteEvent
  | CopilotStreamErrorEvent

/** 终态事件类型集（收到任一即流结束）。 */
export const COPILOT_STREAM_TERMINAL_EVENT_TYPES = [
  'answer-done',
  'turn-clarify',
  'turn-route',
  'turn-error',
] as const
export type CopilotStreamTerminalEventType = (typeof COPILOT_STREAM_TERMINAL_EVENT_TYPES)[number]

// ===========================================================================
// 校验 helper
// ===========================================================================

/** 判断事件类型是否为终态。 */
export function isCopilotStreamTerminalEventType(
  value: unknown,
): value is CopilotStreamTerminalEventType {
  return (
    typeof value === 'string' &&
    (COPILOT_STREAM_TERMINAL_EVENT_TYPES as readonly string[]).includes(value)
  )
}

/** 判断是否为合法流式事件类型。 */
export function isCopilotStreamEventType(value: unknown): value is CopilotStreamEvent['type'] {
  return (
    typeof value === 'string' &&
    [
      'turn-meta',
      'answer-delta',
      'answer-done',
      'turn-clarify',
      'turn-route',
      'turn-error',
    ].includes(value)
  )
}

/**
 * 断言序列号严格递增（从 COPILOT_STREAM_SEQUENCE_START 起）。
 * 返回第一条违规（非递增/跳号不计——允许客户端主动跳过），无违规返回 null。
 */
export function findCopilotStreamSequenceViolation(
  events: readonly { readonly sequence: number }[],
): { index: number; expected: number; actual: number } | null {
  let expected = COPILOT_STREAM_SEQUENCE_START
  for (let i = 0; i < events.length; i++) {
    const current = events[i]
    if (!current) continue
    const seq = current.sequence
    if (!Number.isInteger(seq) || seq < COPILOT_STREAM_SEQUENCE_START) {
      return { index: i, expected, actual: seq }
    }
    const prev = events[i - 1]
    if (i > 0 && prev && seq <= prev.sequence) {
      return { index: i, expected: prev.sequence + 1, actual: seq }
    }
  }
  return null
}

// ===========================================================================
// 禁存约束（与 copilot-turn 同纪律）
// ===========================================================================

/** 事件中禁止携带的键（全小写；匹配用小写包含语义，宁可多报不漏报）。 */
const COPILOT_STREAM_FORBIDDEN_PAYLOAD_KEYS = new Set([
  'prompt',
  'systemprompt',
  'userprompt',
  'rawtext',
  'fulltext',
  'apikey',
  'authorization',
  'token',
  'secret',
  'password',
])

/** 找出事件载荷中命中的禁止键（供审计/测试断言）。 */
export function copilotStreamFindForbiddenPayloadKeys(
  event: Readonly<Record<string, unknown>>,
): string[] {
  return Object.keys(event).filter((key) => {
    const lowered = key.toLowerCase()
    for (const forbidden of COPILOT_STREAM_FORBIDDEN_PAYLOAD_KEYS) {
      if (lowered === forbidden || lowered.includes(forbidden)) return true
    }
    return false
  })
}

/** 断言事件载荷无禁止键（返回布尔，供防回归测试）。 */
export function copilotStreamHasForbiddenPayloadKeys(
  event: Readonly<Record<string, unknown>>,
): boolean {
  return copilotStreamFindForbiddenPayloadKeys(event).length > 0
}

/** 增量文本有界化（单帧截断，确定性）。 */
export function boundCopilotStreamDelta(delta: string): string {
  if (delta.length <= COPILOT_STREAM_DELTA_MAX_LENGTH) return delta
  return delta.slice(0, COPILOT_STREAM_DELTA_MAX_LENGTH)
}
