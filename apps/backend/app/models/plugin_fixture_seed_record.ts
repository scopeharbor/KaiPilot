/**
 * v3-plugin-fixture-market-seed —— PluginFixtureSeedRecord Model。
 *
 * 组织隔离的最小 seed state（catalog version + created refs）。不可变引用层：
 * 不承载业务逻辑；release/installation 的真实状态以各自表为准（本表非 authority）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PluginFixtureSeedRecord extends BaseModel {
  public static table = 'plugin_fixture_seed_records'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare catalogId: string

  @column()
  declare catalogVersion: string

  @column()
  declare catalogDigest: string

  @column()
  declare itemId: string

  @column()
  declare pluginIdentity: string

  @column()
  declare version: string

  @column()
  declare releaseId: number | null

  @column()
  declare installationId: number | null

  @column()
  declare itemDigest: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离 scope。 */
  static forOrganization(query: ReturnType<typeof PluginFixtureSeedRecord.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }
}
