import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PluginEventEnvelope } from '@aiproj/types'

/**
 * v3-plugin-event-subscription-contract —— internal plugin event outbox/delivery 行。
 * organization 强隔离（forOrganization）；delivery_identity 幂等唯一；有界保留由宿主清理。
 */
export default class PluginEventDelivery extends BaseModel {
  public static table = 'plugin_event_deliveries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare installationId: number

  @column()
  declare pluginId: string

  @column()
  declare pluginVersion: string

  @column()
  declare subscriptionDigest: string

  @column()
  declare eventType: string

  @column()
  declare eventVersion: string

  @column()
  declare eventId: string

  @column()
  declare deliveryIdentity: string

  @column({
    prepare: (value: PluginEventEnvelope): string => JSON.stringify(value),
    consume: (value: unknown): PluginEventEnvelope =>
      typeof value === 'string'
        ? (JSON.parse(value) as PluginEventEnvelope)
        : (value as PluginEventEnvelope),
  })
  declare envelope: PluginEventEnvelope

  @column()
  declare status: 'pending' | 'delivered' | 'skipped' | 'stale' | 'failed' | 'dropped'

  @column()
  declare attemptCount: number

  @column()
  declare lastReasonCode: string | null

  @column()
  declare responseKind: 'observation' | 'advisory-draft' | 'action-proposal' | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare deliveredAt: DateTime | null

  static forOrganization(query: ReturnType<typeof PluginEventDelivery.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
