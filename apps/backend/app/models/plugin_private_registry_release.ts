/**
 * v3-plugin-private-registry-lifecycle —— PluginPrivateRegistryRelease Model（task 3.5）。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * 不可变引用，不放业务逻辑。
 */
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import PluginPrivateRegistryReview from './plugin_private_registry_review.js'

export default class PluginPrivateRegistryRelease extends BaseModel {
  public static table = 'plugin_private_registry_releases'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare pluginIdentity: string

  @column()
  declare version: string

  @column()
  declare packageDigest: string

  @column()
  declare manifestDigest: string

  @column()
  declare compatibilityDigest: string

  @column()
  declare upstreamReceiptRef: string

  @column()
  declare status: string

  @column()
  declare metadata: string | null

  @column()
  declare rowVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => PluginPrivateRegistryReview, {
    foreignKey: 'releaseId',
  })
  declare reviews: HasMany<typeof PluginPrivateRegistryReview>

  /**
   * Scope: only return releases for a given organization.
   */
  static forOrganization(
    query: ReturnType<typeof PluginPrivateRegistryRelease.query>,
    orgId: number,
  ) {
    return query.where('organizationId', orgId)
  }

  /**
   * Scope: only return releases with a given status.
   */
  static withStatus(query: ReturnType<typeof PluginPrivateRegistryRelease.query>, status: string) {
    return query.where('status', status)
  }
}
