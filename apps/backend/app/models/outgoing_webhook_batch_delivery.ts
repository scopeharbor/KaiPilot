import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { OutgoingWebhookBatchStatus, OutgoingWebhookFailureCategory } from '@aiproj/types'

/**
 * OutgoingWebhookBatchDelivery -- 出站 webhook 批量投递（design D1/D4）。
 *
 * 每条批量投递对应一条记录。持有组织/订阅/目标 URL 范围、批量信封元数据、
 * 批量状态、逐项结果 JSON（脱敏）、重试元数据、暂停标记。
 * 不存密钥明文/密文/签名值/完整响应体/prompt/输出/token。
 * organization_id 冗余便于隔离查询。
 * entry_outcomes 为 JSON 数组（仅脱敏投影字段）。
 */
export default class OutgoingWebhookBatchDelivery extends BaseModel {
  static table = 'outgoing_webhook_batch_deliveries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare subscriptionId: number

  @column()
  declare batchId: string

  @column()
  declare targetUrl: string

  @column()
  declare signingKeyFingerprint: string

  @column()
  declare signingKeyVersion: string

  @column()
  declare signatureSchemeVersion: string

  @column()
  declare eventEnvelopeSchemaVersion: string

  @column({
    prepare: (value: unknown) => (value ? JSON.stringify(value) : '[]'),
    consume: (value: unknown) => {
      if (value === null || value === undefined) return []
      if (typeof value === 'string') return JSON.parse(value)
      return value
    },
    serialize: (value: unknown) => value,
  })
  declare eventTypes: readonly string[]

  @column({
    prepare: (value: unknown) => (value ? JSON.stringify(value) : '[]'),
    consume: (value: unknown) => {
      if (value === null || value === undefined) return []
      if (typeof value === 'string') return JSON.parse(value)
      return value
    },
    serialize: (value: unknown) => value,
  })
  declare entryIds: readonly number[]

  @column()
  declare status: OutgoingWebhookBatchStatus

  @column()
  declare entryCount: number

  @column()
  declare attemptCount: number

  @column()
  declare maxAttempts: number

  @column()
  declare lastAttemptSummary: string | null

  @column()
  declare lastAttemptStatus: string | null

  @column.dateTime({ autoCreate: false })
  declare lastAttemptAt: DateTime | null

  @column.dateTime({ autoCreate: false })
  declare nextAttemptAt: DateTime | null

  @column()
  declare failureCategory: OutgoingWebhookFailureCategory | null

  @column()
  declare terminalFailureReason: string | null

  @column({
    consume: (value: unknown) => Boolean(value),
    prepare: (value: unknown) => (value ? 1 : 0),
  })
  declare paused: boolean

  @column()
  declare payloadByteSize: number | null

  @column({
    prepare: (value: unknown) => {
      if (value === null || value === undefined) return null
      return JSON.stringify(value)
    },
    consume: (value: unknown) => {
      if (value === null || value === undefined) return null
      if (typeof value === 'string') return JSON.parse(value)
      return value
    },
    serialize: (value: unknown) => value,
  })
  declare entryOutcomes: unknown | null

  @column.dateTime({ autoCreate: false })
  declare batchCreatedAt: DateTime

  @column.dateTime({ autoCreate: false })
  declare windowClosedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
