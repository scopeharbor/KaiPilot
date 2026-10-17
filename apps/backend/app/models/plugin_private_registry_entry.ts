/**
 * v3-plugin-private-registry-lifecycle —— PluginPrivateRegistryEntry Model（task 3.5）。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * 只表达数据与关联，不放业务状态迁移或授权逻辑。
 */
import { BaseModel, column, hasOne } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasOne } from '@adonisjs/lucid/types/relations'
import PluginPrivateRegistryRelease from './plugin_private_registry_release.js'

export default class PluginPrivateRegistryEntry extends BaseModel {
  public static table = 'plugin_private_registry_entries'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare pluginIdentity: string

  @column()
  declare pluginName: string

  @column()
  declare recommendedReleaseId: number | null

  @column()
  declare recommendedVersion: string | null

  @column()
  declare rowVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasOne(() => PluginPrivateRegistryRelease, {
    foreignKey: 'id',
    localKey: 'recommendedReleaseId',
  })
  declare recommendedRelease: HasOne<typeof PluginPrivateRegistryRelease>

  /**
   * Scope: only return entries for a given organization.
   */
  static forOrganization(
    query: ReturnType<typeof PluginPrivateRegistryEntry.query>,
    orgId: number,
  ) {
    return query.where('organizationId', orgId)
  }
}
