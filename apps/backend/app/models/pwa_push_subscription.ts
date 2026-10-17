import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PushSubscriptionStatus } from '@aiproj/types'

/**
 * PwaPushSubscription —— PWA Web Push 订阅（design D2）。
 *
 * 组织/用户隔离的推送订阅。endpoint/keys 以 AES-GCM 密文存储，
 * 明文永不入库/响应/审计。endpoint_hash 为 SHA-256 哈希，用于唯一约束
 * 而不暴露原始 endpoint。status 支持 active/revoked/invalidated 生命周期。
 * 所有查询必须限定 organization_id 和 user_id。
 */
export default class PwaPushSubscription extends BaseModel {
  static table = 'pwa_push_subscriptions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare userId: number

  @column()
  declare endpointHash: string

  @column()
  declare endpointCiphertext: string

  @column()
  declare p256dhCiphertext: string

  @column()
  declare authCiphertext: string

  @column()
  declare status: PushSubscriptionStatus

  @column()
  declare userAgent: string | null

  @column()
  declare userAgentHash: string | null

  @column.dateTime({ autoCreate: false })
  declare lastSeenAt: DateTime | null

  @column.dateTime({ autoCreate: false })
  declare revokedAt: DateTime | null

  @column.dateTime({ autoCreate: false })
  declare invalidatedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
