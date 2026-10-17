import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { OutgoingWebhookEventType } from '@aiproj/types'

/**
 * OutgoingWebhookSubscription -- 出站 webhook 订阅（design D1/D3）。
 *
 * 订阅配置 + 加密密钥 + 状态生命周期。密钥以 AES-GCM 密文存 `secretCiphertext`，
 * 明文永不入库/响应/审计；`secretFingerprint` 为非密钥哈希前缀，供 UI 识别。
 * `eventTypes` 为 JSON 数组，仅允许白名单事件（service 层校验）。
 * 所有查询必须限定 organization_id。本模型不触发任何外发 HTTP。
 */
const jsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? []
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })

export default class OutgoingWebhookSubscription extends BaseModel {
  static table = 'outgoing_webhook_subscriptions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare name: string

  @column()
  declare targetUrl: string

  @jsonColumn()
  declare eventTypes: OutgoingWebhookEventType[]

  @column()
  declare status: 'active' | 'inactive'

  @column()
  declare secretCiphertext: string

  @column()
  declare secretFingerprint: string

  @column()
  declare createdBy: number | null

  @column()
  declare updatedBy: number | null

  @column.dateTime({ autoCreate: false })
  declare lastRotatedAt: DateTime | null

  @column.dateTime({ autoCreate: false })
  declare deactivatedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
