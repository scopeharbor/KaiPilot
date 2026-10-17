/**
 * v3-plugin-policy-bundles —— PluginPolicyBundleActivation Model（组织激活状态）。
 *
 * 每组织至多一行（UNIQUE organization_id）；status active/disabled；
 * revision 随每次激活变化递增（security gate 缓存失效判据）；
 * row_version 乐观锁保护并发激活（任务 2.4 并发更新测试的落点）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PluginPolicyBundleActivation extends BaseModel {
  public static table = 'plugin_policy_bundle_activations'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope（每组织唯一）──
  @column()
  declare organizationId: number

  // ── Activation target ──
  @column()
  declare bundleId: string

  @column()
  declare activeVersion: number

  @column()
  declare status: 'active' | 'disabled'

  // ── Concurrency & audit ──
  @column()
  declare revision: number

  @column()
  declare rowVersion: number

  @column()
  declare activatedBy: string

  @column.dateTime()
  declare activatedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 取组织当前激活行（无策略行 = 未启用组织策略 → gate 回退逐项授权）。 */
  static async findForOrganization(orgId: number) {
    return this.query().where('organization_id', orgId).first()
  }
}
