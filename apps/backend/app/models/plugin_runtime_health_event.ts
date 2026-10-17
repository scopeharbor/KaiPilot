import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  PluginRuntimeHealthCircuitState,
  PluginRuntimeHealthDurationBucket,
  PluginRuntimeHealthOutcome,
  PluginRuntimeHealthQuotaKind,
  PluginRuntimeHealthReasonCode,
} from '@aiproj/types'

export default class PluginRuntimeHealthEvent extends BaseModel {
  public static table = 'plugin_runtime_health_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare installationId: number

  @column()
  declare pluginId: string

  @column()
  declare pluginVersion: string | null

  @column()
  declare contributionKey: string | null

  @column()
  declare seamKey: string | null

  @column()
  declare outcome: PluginRuntimeHealthOutcome

  @column()
  declare reasonCode: PluginRuntimeHealthReasonCode

  @column()
  declare quotaKind: PluginRuntimeHealthQuotaKind

  @column()
  declare durationBucket: PluginRuntimeHealthDurationBucket

  @column()
  declare latencyMs: number | null

  @column()
  declare circuitState: PluginRuntimeHealthCircuitState

  @column()
  declare invocationId: string

  @column.dateTime()
  declare occurredAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column()
  declare rowVersion: number

  static forOrganization(query: ReturnType<typeof PluginRuntimeHealthEvent.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
