/**
 * v3-plugin-private-registry-lifecycle —— PluginPrivateRegistryOperation Model（task 3.5）。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * 只表达数据，不放崩溃恢复或补偿逻辑。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import PluginPrivateRegistryRelease from './plugin_private_registry_release.js'

export default class PluginPrivateRegistryOperation extends BaseModel {
  public static table = 'plugin_private_registry_operations'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare operationType: string

  @column()
  declare idempotencyKey: string

  @column()
  declare targetReleaseId: number | null

  @column()
  declare status: string

  @column()
  declare previewSourceHash: string

  @column()
  declare impactSummary: string | null

  @column()
  declare errorCode: string | null

  @column()
  declare reasonCode: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => PluginPrivateRegistryRelease, {
    foreignKey: 'targetReleaseId',
  })
  declare targetRelease: BelongsTo<typeof PluginPrivateRegistryRelease>

  /**
   * Scope: only return operations for a given organization.
   */
  static forOrganization(
    query: ReturnType<typeof PluginPrivateRegistryOperation.query>,
    orgId: number,
  ) {
    return query.where('organizationId', orgId)
  }

  /**
   * Scope: only return non-terminal operations (for recovery).
   */
  static nonTerminal(query: ReturnType<typeof PluginPrivateRegistryOperation.query>) {
    return query.whereNotIn('status', ['committed', 'compensated'])
  }
}
