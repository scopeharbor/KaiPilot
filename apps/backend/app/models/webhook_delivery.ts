import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import WebhookEndpoint from './webhook_endpoint.js'

/**
 * WebhookDelivery —— 入站投递账本（低敏，design D4/D8）。
 *
 * 每条到达的交付无论通过与否恰好一条。不存原始敏感 payload 全文，
 * 仅 `payloadDigest`（脱敏摘要/哈希）。组织隔离。
 */
export default class WebhookDelivery extends BaseModel {
  static table = 'webhook_deliveries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare endpointId: number

  @column()
  declare provider: string

  @column()
  declare idempotencyKey: string

  @column()
  declare eventType: string | null

  /** valid / invalid / skipped */
  @column()
  declare signatureResult: string

  /** fresh / expired / skipped */
  @column()
  declare timestampResult: string

  /** first / duplicate / skipped */
  @column()
  declare dedupResult: string

  @column()
  declare payloadDigest: string | null

  @column.dateTime({ autoCreate: false })
  declare receivedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => WebhookEndpoint)
  declare endpoint: BelongsTo<typeof WebhookEndpoint>
}
