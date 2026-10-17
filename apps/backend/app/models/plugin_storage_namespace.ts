/**
 * v3-plugin-scoped-storage —— PluginStorageNamespace Model（任务 2.1）。
 *
 * namespace = 插件 × 组织 × scope 的隔离/配额/生命周期单元（design D1/D4）：
 * - 组织隔离：所有查询经 forOrganization helper 自动附加 organization_id（产品红线）；
 * - 生命周期：active / read-only / orphaned / pending-deletion，由安装态派生；
 * - 配额与用量冗余在行内，写入同事务更新；rowVersion 为行级乐观锁；
 * - orphanedAt / retentionUntil 承载卸载保留期语义（卸载不静默删除）。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PluginStorageNamespaceStatus, PluginStorageScope } from '@aiproj/types'

export default class PluginStorageNamespace extends BaseModel {
  public static table = 'plugin_storage_namespaces'

  @column({ isPrimary: true })
  declare id: number

  // ── Server-owned scope ──
  @column()
  declare organizationId: number

  /** organization scope 时为 null。 */
  @column()
  declare projectId: number | null

  // ── Identity ──
  @column()
  declare pluginId: string

  @column()
  declare pluginVersion: string

  /** 绑定安装记录（安装记录卸载为软删除，永不物理删除）。 */
  @column()
  declare installationId: number

  // ── Lifecycle ──
  @column()
  declare scope: PluginStorageScope

  @column()
  declare status: PluginStorageNamespaceStatus

  // ── Quota / usage（写入同事务更新，design D3）──
  @column()
  declare quotaBytes: number

  @column()
  declare usedBytes: number

  @column()
  declare quotaEntries: number

  @column()
  declare usedEntries: number

  // ── Concurrency ──
  @column()
  declare rowVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── Retention（卸载保留期）──
  @column.dateTime()
  declare orphanedAt: DateTime | null

  @column.dateTime()
  declare retentionUntil: DateTime | null

  // ── Cleanup handle 绑定（一次性；confirm 成功后随行删除）──
  @column()
  declare cleanupHandleDigest: string | null

  @column.dateTime()
  declare cleanupHandleExpiresAt: DateTime | null

  /**
   * Scope: 按组织过滤（组织隔离强制入口）。
   */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }

  /**
   * Scope: 按插件过滤（必须与 forOrganization 联用或自行带组织条件）。
   */
  static forPlugin(pluginId: string) {
    return this.query().where('plugin_id', pluginId)
  }

  /**
   * Scope: 只返回给定生命周期状态。
   */
  static withStatus(statuses: readonly PluginStorageNamespaceStatus[]) {
    return this.query().whereIn('status', [...statuses])
  }
}
