/**
 * v3-plugin-policy-bundles —— PluginPolicyBundle Model（组织策略包版本）。
 *
 * 组织隔离：查询经 forOrganization 强制附加 organization_id。
 * 不可变性：每个 (organization, bundle, version) 版本行写入后
 * rulesJson/documentDigest 不再修改，演进以新版本行表达（design D3）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PluginPolicyBundleRule } from '@aiproj/types'

/** JSON 字段序列化器（与 plugin_change_request 同型）。 */
const rulesJsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? (JSON.parse(value) as PluginPolicyBundleRule[])
          : value,
    serialize: (value: unknown) => value,
  })

export default class PluginPolicyBundle extends BaseModel {
  public static table = 'plugin_policy_bundles'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope ──
  @column()
  declare organizationId: number

  // ── Bundle identity & provenance ──
  @column()
  declare bundleId: string

  @column()
  declare sourceTemplateId: 'admin-managed' | 'pm-enabled' | 'member-readonly'

  @column()
  declare sourceTemplateVersion: number

  // ── Version content（canonical、不可变）──
  @column()
  declare version: number

  @column()
  declare descriptionZh: string

  @rulesJsonColumn()
  declare rulesJson: PluginPolicyBundleRule[]

  @column()
  declare documentDigest: string

  // ── Lifecycle ──
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  /** Scope: 按组织过滤（组织隔离强制入口）。 */
  static forOrganization(query: ReturnType<typeof this.query>, orgId: number) {
    return query.where('organization_id', orgId)
  }

  /** 取指定版本（跨租访问天然被 organization 过滤拒绝）。 */
  static async findVersion(orgId: number, bundleId: string, version: number) {
    return this.query()
      .where('organization_id', orgId)
      .where('bundle_id', bundleId)
      .where('version', version)
      .first()
  }
}
