import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import WebhookDelivery from './webhook_delivery.js'

/**
 * WebhookEndpoint —— per-provider 入站接收端点（design D4）。
 *
 * 签名密钥以 AES-GCM 密文存 `signingSecretEncrypted`，明文永不回显。
 * `previousSecretEncrypted` + `secretRotatedAt` 支持轮换过渡窗口。
 * 所有查询必须限定 organization_id。
 */
export default class WebhookEndpoint extends BaseModel {
  static table = 'webhook_endpoints'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare provider: string

  @column()
  declare slug: string

  @column()
  declare signingSecretEncrypted: string

  @column()
  declare previousSecretEncrypted: string | null

  @column.dateTime({ autoCreate: false })
  declare secretRotatedAt: DateTime | null

  @column()
  declare timestampToleranceSeconds: number

  @column()
  declare enabled: boolean

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => WebhookDelivery)
  declare deliveries: HasMany<typeof WebhookDelivery>
}
