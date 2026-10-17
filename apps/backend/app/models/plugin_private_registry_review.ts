/**
 * v3-plugin-private-registry-lifecycle —— PluginPrivateRegistryReview Model（task 3.5）。
 *
 * 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id。
 * 只表达数据与关联，不放 maker-checker 业务逻辑。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import PluginPrivateRegistryRelease from './plugin_private_registry_release.js'

export default class PluginPrivateRegistryReview extends BaseModel {
  public static table = 'plugin_private_registry_reviews'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare releaseId: number

  @column()
  declare organizationId: number

  @column()
  declare cycleNumber: number

  @column()
  declare submitterRef: string

  @column()
  declare reviewerRef: string | null

  @column()
  declare decision: string

  @column()
  declare reasonCode: string | null

  @column()
  declare sourceHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare resolvedAt: DateTime | null

  @belongsTo(() => PluginPrivateRegistryRelease, {
    foreignKey: 'releaseId',
  })
  declare release: BelongsTo<typeof PluginPrivateRegistryRelease>

  /**
   * Scope: only return reviews for a given organization.
   */
  static forOrganization(
    query: ReturnType<typeof PluginPrivateRegistryReview.query>,
    orgId: number,
  ) {
    return query.where('organizationId', orgId)
  }
}
