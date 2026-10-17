import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { OutgoingWebhookAttemptStatus, OutgoingWebhookFailureCategory } from '@aiproj/types'

/**
 * OutgoingWebhookDeliveryAttempt -- 出站 webhook 投递尝试（append-only，design D1/D4）。
 *
 * 每次发送尝试一条记录，持有调度/开始/完成时间、状态、低敏失败分类、响应状态码、
 * 响应体哈希或有限安全摘要、重试原因。永不存完整响应体/签名值/请求头/密钥/token/authorization。
 * organization_id 冗余便于隔离查询。
 */
export default class OutgoingWebhookDeliveryAttempt extends BaseModel {
  static table = 'outgoing_webhook_delivery_attempts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare deliveryEventId: number

  @column()
  declare organizationId: number

  @column()
  declare attemptNumber: number

  @column()
  declare status: OutgoingWebhookAttemptStatus

  @column.dateTime({ autoCreate: false })
  declare scheduledAt: DateTime

  @column.dateTime({ autoCreate: false })
  declare startedAt: DateTime | null

  @column.dateTime({ autoCreate: false })
  declare completedAt: DateTime | null

  @column()
  declare responseStatus: number | null

  @column()
  declare failureCategory: OutgoingWebhookFailureCategory | null

  @column()
  declare responseBodyHash: string | null

  @column()
  declare responseExcerpt: string | null

  @column()
  declare retryReason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
