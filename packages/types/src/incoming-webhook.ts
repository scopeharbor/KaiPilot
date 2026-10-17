/**
 * v2-5-provider-incoming-webhook-foundation —— per-provider 入站 webhook 共享契约（前后端）。
 *
 * 只覆盖接收底座的管理面 DTO；投递账本是后端内部低敏记录，不在此暴露敏感字段。
 * 密钥明文永不出现于任何 DTO。
 */

export type WebhookSignatureResult = 'valid' | 'invalid' | 'skipped'
export type WebhookTimestampResult = 'fresh' | 'expired' | 'skipped'
export type WebhookDedupResult = 'first' | 'duplicate' | 'skipped'

/** 管理面端点摘要（不回显密钥）。 */
export interface WebhookEndpointDto {
  id: number
  provider: string
  slug: string
  enabled: boolean
  timestampToleranceSeconds: number
  secretRotatedAt: string | null
  createdAt: string
  updatedAt: string | null
}

/** 一次性密钥展示：仅注册/轮换时返回明文，之后不可再取回。 */
export interface WebhookSecretRevealDto {
  /** 一次性明文签名密钥，调用方须立即保存，平台不留明文。 */
  signingSecret: string
  /** 轮换时若存在旧密钥过渡窗口，返回当前轮换时间。 */
  rotatedAt: string | null
}

/** 投递账本查询条目（低敏，不含原始 payload）。 */
export interface WebhookDeliveryLedgerEntryDto {
  id: number
  provider: string
  endpointId: number
  idempotencyKey: string
  eventType: string | null
  signatureResult: WebhookSignatureResult
  timestampResult: WebhookTimestampResult
  dedupResult: WebhookDedupResult
  payloadDigest: string | null
  receivedAt: string
}

/** 注册端点响应（含一次性密钥）。 */
export interface WebhookEndpointCreatedDto extends WebhookEndpointDto {
  secret: WebhookSecretRevealDto
}
