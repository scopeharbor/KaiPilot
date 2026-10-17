/**
 * v3-frontend-ai-usage-telemetry —— 前端 AI 使用事件的共享契约。
 *
 * 定义事件种类、事件形状、禁存约束、批量发送契约与 fixtures。
 * 本模块纯类型 + 确定性常量，零运行时依赖。
 *
 * 关键设计点（与 proposal/design 对齐）：
 * - 事件只含类别与计数，绝不含用户输入文本、实体标识、击键、prompt、模型输出、token 与 secret
 * - 首问意图类别复用 copilot-intent-catalog 的 CopilotIntentClass 枚举
 * - 放弃定义写死：面板打开且未产生任何提交即为放弃
 * - 事件只发自家后端，不接任何第三方分析服务
 */

import type { CopilotIntentClass } from './copilot-shared-contracts.js'

// ===========================================================================
// 枚举 — 事件种类
// ===========================================================================

/**
 * 前端 AI 使用事件种类：
 * - panel_open: 面板打开
 * - panel_close: 面板关闭
 * - session_turn: 会话轮数（每次提交计数）
 * - first_question_intent: 首问意图类别
 * - abandonment: 放弃（面板打开且未产生任何提交即关闭）
 * - chip_click: 芯片点击
 * - action_click: 动作卡片点击
 * - action_reject: 动作卡片拒绝
 */
export const FRONTEND_TELEMETRY_EVENT_KINDS = [
  'panel_open',
  'panel_close',
  'session_turn',
  'first_question_intent',
  'abandonment',
  'chip_click',
  'action_click',
  'action_reject',
] as const

export type FrontendTelemetryEventKind = (typeof FRONTEND_TELEMETRY_EVENT_KINDS)[number]

// ===========================================================================
// 结构类型 — 事件形状
// ===========================================================================

/**
 * 前端 AI 使用事件基础形状。
 * 所有事件都包含 eventKind、timestamp 与 sessionId。
 * 特定事件类型包含额外字段。
 */
export interface FrontendTelemetryEventBase {
  /** 事件种类。 */
  readonly eventKind: FrontendTelemetryEventKind
  /** 事件时间戳（ISO 8601）。 */
  readonly timestamp: string
  /** 会话 ID（与 copilot-store 的 sessionId 对齐）。 */
  readonly sessionId: string
  /** 组织 ID（用于组织隔离）。 */
  readonly organizationId: string
}

/**
 * 面板打开事件。
 */
export interface FrontendTelemetryPanelOpenEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'panel_open'
}

/**
 * 面板关闭事件。
 */
export interface FrontendTelemetryPanelCloseEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'panel_close'
  /** 本次会话是否已提交过（用于判断放弃）。 */
  readonly hasSubmitted: boolean
}

/**
 * 会话轮数事件。
 */
export interface FrontendTelemetrySessionTurnEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'session_turn'
  /** 当前轮数（从 1 开始）。 */
  readonly turnCount: number
}

/**
 * 首问意图类别事件。
 */
export interface FrontendTelemetryFirstQuestionIntentEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'first_question_intent'
  /** 意图类别（复用 CopilotIntentClass 枚举）。 */
  readonly intentClass: CopilotIntentClass
}

/**
 * 放弃事件。
 */
export interface FrontendTelemetryAbandonmentEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'abandonment'
}

/**
 * 芯片点击事件。
 */
export interface FrontendTelemetryChipClickEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'chip_click'
  /** 芯片 ID。 */
  readonly chipId: string
  /** 芯片来源（registered-command / intent-catalog）。 */
  readonly chipSource: string
}

/**
 * 动作卡片点击事件。
 */
export interface FrontendTelemetryActionClickEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'action_click'
  /** 动作 ID。 */
  readonly actionId: string
  /** 动作标签（低敏）。 */
  readonly actionLabel: string
}

/**
 * 动作卡片拒绝事件。
 */
export interface FrontendTelemetryActionRejectEvent extends FrontendTelemetryEventBase {
  readonly eventKind: 'action_reject'
  /** 动作 ID。 */
  readonly actionId: string
  /** 动作标签（低敏）。 */
  readonly actionLabel: string
}

/**
 * 前端 AI 使用事件联合类型。
 */
export type FrontendTelemetryEvent =
  | FrontendTelemetryPanelOpenEvent
  | FrontendTelemetryPanelCloseEvent
  | FrontendTelemetrySessionTurnEvent
  | FrontendTelemetryFirstQuestionIntentEvent
  | FrontendTelemetryAbandonmentEvent
  | FrontendTelemetryChipClickEvent
  | FrontendTelemetryActionClickEvent
  | FrontendTelemetryActionRejectEvent

// ===========================================================================
// 常量 — 禁存约束
// ===========================================================================

/**
 * 禁存字段列表：事件不得包含这些字段的值。
 * 用于服务端二次脱敏校验。
 */
export const FRONTEND_TELEMETRY_FORBIDDEN_FIELDS = [
  'userInput',
  'entityIdentifier',
  'keystroke',
  'prompt',
  'modelOutput',
  'token',
  'secret',
  'inputText',
  'originalInput',
] as const

/**
 * 敏感样本列表：用于负例测试，证明敏感样本不出现在任一字段。
 */
export const FRONTEND_TELEMETRY_SENSITIVE_SAMPLES = [
  '用户输入的文本内容',
  'sk-1234567890abcdef',
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'password: mysecretpassword',
  'api_key=abcdef1234567890',
] as const

// ===========================================================================
// 结构类型 — 批量发送契约
// ===========================================================================

/**
 * 批量发送请求形状。
 */
export interface FrontendTelemetryBatchRequest {
  /** 事件数组。 */
  readonly events: readonly FrontendTelemetryEvent[]
}

/**
 * 批量发送响应形状。
 */
export interface FrontendTelemetryBatchResponse {
  /** 接收的事件数。 */
  readonly received: number
}

// ===========================================================================
// 结构类型 — 聚合查询契约
// ===========================================================================

/**
 * 聚合查询参数。
 */
export interface FrontendTelemetryAggregationQuery {
  /** 组织 ID。 */
  readonly organizationId: string
  /** 事件种类（可选，用于过滤）。 */
  readonly eventKind?: FrontendTelemetryEventKind
  /** 时间窗口开始（ISO 8601）。 */
  readonly start: string
  /** 时间窗口结束（ISO 8601）。 */
  readonly end: string
}

/**
 * 五个核心指标聚合结果。
 */
export interface FrontendTelemetryAggregationResult {
  /** 打开率（打开次数 / 总会话数）。 */
  readonly openRate: number
  /** 会话长度（平均轮数）。 */
  readonly sessionLength: number
  /** 首问类别分布。 */
  readonly firstQuestionDistribution: Record<CopilotIntentClass, number>
  /** 放弃率（放弃次数 / 打开次数）。 */
  readonly abandonmentRate: number
  /** 芯片点击分布。 */
  readonly chipClickDistribution: Record<string, number>
}

// ===========================================================================
// 校验函数
// ===========================================================================

/**
 * 校验事件是否包含禁存字段。
 * 返回 true 表示包含禁存字段（不合规）。
 */
export function frontendTelemetryContainsForbiddenFields(
  event: Record<string, unknown>,
  forbiddenFields: readonly string[] = FRONTEND_TELEMETRY_FORBIDDEN_FIELDS,
): boolean {
  for (const field of forbiddenFields) {
    if (field in event) {
      return true
    }
  }
  return false
}

/**
 * 校验事件是否包含敏感样本。
 * 返回 true 表示包含敏感样本（不合规）。
 */
export function frontendTelemetryContainsSensitiveSamples(
  event: Record<string, unknown>,
  sensitiveSamples: readonly string[] = [...FRONTEND_TELEMETRY_SENSITIVE_SAMPLES],
): boolean {
  const serialized = JSON.stringify(event)
  for (const sample of sensitiveSamples) {
    if (sample.length > 0 && serialized.includes(sample)) {
      return true
    }
  }
  return false
}

/**
 * 校验事件是否合规（不包含禁存字段和敏感样本）。
 * 返回 true 表示合规。
 */
export function isFrontendTelemetryEventCompliant(event: Record<string, unknown>): boolean {
  return (
    !frontendTelemetryContainsForbiddenFields(event) &&
    !frontendTelemetryContainsSensitiveSamples(event)
  )
}

/**
 * 校验意图类别是否在合法枚举中。
 */
export function isValidFrontendTelemetryIntentClass(
  intentClass: string,
  validClasses: readonly string[] = [
    'query',
    'analysis',
    'generation',
    'mutation',
    'instruction',
    'meta',
  ],
): boolean {
  return validClasses.includes(intentClass)
}
