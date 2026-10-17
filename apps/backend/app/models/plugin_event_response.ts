import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/**
 * v3-plugin-event-subscription-contract —— 插件事件响应记录（幂等 recorder）。
 * delivery_identity 唯一：重复交付最多一条有效建议；低敏字段（无 payload、无实体数据）。
 */
export default class PluginEventResponse extends BaseModel {
  public static table = 'plugin_event_responses'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare installationId: number

  @column()
  declare pluginId: string

  @column()
  declare deliveryIdentity: string

  @column()
  declare eventId: string

  @column()
  declare kind: 'observation' | 'advisory-draft' | 'action-proposal'

  @column()
  declare title: string | null

  @column()
  declare body: string | null

  @column()
  declare proposalKey: string | null

  @column()
  declare proposalSummary: string | null

  @column()
  declare proposalRegistered: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
