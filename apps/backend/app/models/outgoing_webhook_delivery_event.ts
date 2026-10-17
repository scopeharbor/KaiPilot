import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  OutgoingWebhookEventType,
  OutgoingWebhookDeliveryStatus,
  OutgoingWebhookAttemptStatus,
  OutgoingWebhookFailureCategory,
  OutgoingWebhookSourceEntityType,
} from '@aiproj/types'

/**
 * OutgoingWebhookDeliveryEvent -- 出站 webhook 投递事件（outbox/ledger 主体，design D1）。
 *
 * 每条订阅匹配的域事件一条记录，持有低敏 canonical payload（仅白名单字段，builder+assert 保证）、
 * 幂等键、投递状态、重试元数据。重试复用同一 envelopeTimestamp + payload，签名恒定。
 * 所有查询必须限定 organization_id。本模型不发起外发 HTTP（投递由 DeliveryService 编排）。
 * 永不存密钥明文/密文/签名值/完整响应体/prompt/输出/token。
 */
export default class OutgoingWebhookDeliveryEvent extends BaseModel {
  static table = 'outgoing_webhook_delivery_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare subscriptionId: number

  @column()
  declare eventType: OutgoingWebhookEventType

  @column()
  declare sourceEntityType: OutgoingWebhookSourceEntityType

  @column()
  declare sourceEntityId: number

  @column()
  declare projectId: number | null

  @column()
  declare idempotencyKey: string

  @column()
  declare status: OutgoingWebhookDeliveryStatus

  @column()
  declare attemptCount: number

  @column()
  declare maxAttempts: number

  @column()
  declare lastAttemptStatus: OutgoingWebhookAttemptStatus | null

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

  /** 低敏 canonical payload JSON 字符串（仅白名单字段，签名可复现）。 */
  @column()
  declare payload: string

  /** 信 envelope timestamp（签名固定输入，重试不变）。 */
  @column()
  declare envelopeTimestamp: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
