import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  PluginRuntimeHealthCircuitState,
  PluginRuntimeHealthReasonCode,
  PluginRuntimeHealthStatus,
  PluginRuntimeHealthWarningCode,
} from '@aiproj/types'

export default class PluginRuntimeHealthSnapshot extends BaseModel {
  public static table = 'plugin_runtime_health_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare installationId: number

  @column()
  declare pluginId: string

  @column()
  declare contributionKey: string | null

  @column()
  declare status: PluginRuntimeHealthStatus

  @column()
  declare reasonCode: PluginRuntimeHealthReasonCode

  @column()
  declare circuitState: PluginRuntimeHealthCircuitState

  @column.dateTime()
  declare firstSeenAt: DateTime

  @column.dateTime()
  declare lastSeenAt: DateTime

  @column.dateTime()
  declare lastSuccessAt: DateTime | null

  @column.dateTime()
  declare lastFailureAt: DateTime | null

  @column.dateTime()
  declare recoveredAt: DateTime | null

  @column()
  declare totalSuccess: number

  @column()
  declare totalCrash: number

  @column()
  declare totalTimeout: number

  @column()
  declare totalQuota: number

  @column()
  declare totalPermissionDenied: number

  @column()
  declare totalIncompatible: number

  @column()
  declare totalIsolationFailed: number

  @column()
  declare consecutiveFailures: number

  @column()
  declare isStale: boolean

  @column({
    prepare: (value: PluginRuntimeHealthWarningCode[] | null) =>
      value ? JSON.stringify(value) : null,
    consume: (value: string | PluginRuntimeHealthWarningCode[] | null) => {
      if (!value) return []
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as PluginRuntimeHealthWarningCode[]
        } catch {
          return []
        }
      }
      return value
    },
  })
  declare warningCodes: PluginRuntimeHealthWarningCode[]

  @column()
  declare rowVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  static forOrganization(
    query: ReturnType<typeof PluginRuntimeHealthSnapshot.query>,
    orgId: number,
  ) {
    return query.where('organizationId', orgId)
  }
}
