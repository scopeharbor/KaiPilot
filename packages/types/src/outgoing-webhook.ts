/**
 * v2-5-outgoing-webhook-subscription-foundation -- 出站 webhook 订阅共享契约（前后端）。
 *
 * 本 change 只覆盖订阅管理面：事件白名单、订阅状态、脱敏投影、创建/更新/停用/轮换 DTO、
 * 一次性密钥响应。投递账本、HMAC 签名、outbox、重试退避由后续 change 承接。
 *
 * 密钥明文仅在创建/轮换响应中一次性返回；脱敏投影与审计永不包含明文密钥或密文。
 * 事件白名单为前后端共享的唯一来源（后端校验 + 前端选项渲染均引用本常量）。
 */

/** 低敏事件白名单：仅允许未来可表示为低敏信封的事件类型（design D2，append-only）。 */
export const OUTGOING_WEBHOOK_EVENT_WHITELIST = [
  'project.updated',
  'task.created',
  'task.updated',
  'task.completed',
  'risk.created',
] as const

export type OutgoingWebhookEventType = (typeof OUTGOING_WEBHOOK_EVENT_WHITELIST)[number]

/** 低敏事件元数据：展示文案 + 允许的未来信封字段（2.3 P1）。 */
export interface OutgoingWebhookEventMetadata {
  /** 中文展示文案，供前端选项渲染。 */
  label: string
  /** 未来投递信封允许携带的低敏字段名（仅元数据，本 change 不投递）。 */
  allowedEnvelopeFields: readonly string[]
}

/** 事件 -> 元数据映射，前后端共用，避免重复字面量（2.4 P1）。 */
export const OUTGOING_WEBHOOK_EVENT_METADATA: Record<
  OutgoingWebhookEventType,
  OutgoingWebhookEventMetadata
> = {
  'project.updated': {
    label: '项目更新',
    allowedEnvelopeFields: ['projectId', 'projectName', 'updatedBy'],
  },
  'task.created': {
    label: '任务创建',
    allowedEnvelopeFields: ['taskId', 'taskTitle', 'projectId', 'createdBy'],
  },
  'task.updated': {
    label: '任务更新',
    allowedEnvelopeFields: ['taskId', 'taskTitle', 'projectId', 'updatedBy'],
  },
  'task.completed': {
    label: '任务完成',
    allowedEnvelopeFields: ['taskId', 'taskTitle', 'projectId', 'completedBy'],
  },
  'risk.created': {
    label: '风险登记',
    allowedEnvelopeFields: ['riskId', 'riskTitle', 'projectId', 'createdBy'],
  },
}

/** 判定事件类型是否在白名单内（类型守卫，后端 validator 与前端共用）。 */
export function isAllowedOutgoingWebhookEvent(type: string): type is OutgoingWebhookEventType {
  return (OUTGOING_WEBHOOK_EVENT_WHITELIST as readonly string[]).includes(type)
}

/** 订阅状态：active 可被未来投递引用；inactive 已停用，保留可见。 */
export type OutgoingWebhookSubscriptionStatus = 'active' | 'inactive'

/** 脱敏订阅投影：list/detail/update/deactivate 响应统一形态，永不包含密钥明文或密文。 */
export interface OutgoingWebhookSubscriptionDto {
  id: number
  name: string
  /** 规范化后的 HTTPS 目标 URL。 */
  targetUrl: string
  eventTypes: readonly OutgoingWebhookEventType[]
  status: OutgoingWebhookSubscriptionStatus
  /** 非密钥指纹（前缀），用于 UI 识别，不可还原密钥。 */
  secretFingerprint: string
  lastRotatedAt: string | null
  deactivatedAt: string | null
  createdBy: number | null
  updatedBy: number | null
  createdAt: string
  updatedAt: string | null
}

/** 一次性密钥展示：仅创建/轮换响应返回明文，调用方须立即保存，平台不留明文。 */
export interface OutgoingWebhookSecretRevealDto {
  /** 一次性明文密钥。 */
  secret: string
  /** 与脱敏投影一致的指纹，便于对照。 */
  fingerprint: string
  /** 本次轮换/生成时间。 */
  rotatedAt: string
}

/** 创建订阅入参。 */
export interface CreateOutgoingWebhookSubscriptionRequest {
  name: string
  targetUrl: string
  eventTypes: readonly OutgoingWebhookEventType[]
}

/** 更新订阅入参（全部可选，仅允许改 name/targetUrl/eventTypes，不改密钥）。 */
export interface UpdateOutgoingWebhookSubscriptionRequest {
  name?: string
  targetUrl?: string
  eventTypes?: readonly OutgoingWebhookEventType[]
}

/** 创建/轮换响应：脱敏投影 + 一次性密钥。 */
export interface OutgoingWebhookSubscriptionCreatedDto extends OutgoingWebhookSubscriptionDto {
  secret: OutgoingWebhookSecretRevealDto
}

/** 轮换响应：脱敏投影 + 新一次性密钥。 */
export interface OutgoingWebhookSubscriptionRotatedDto extends OutgoingWebhookSubscriptionDto {
  secret: OutgoingWebhookSecretRevealDto
}
