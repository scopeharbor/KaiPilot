/**
 * v3-skill-as-plugin-adapter —— PluginInstallation Model（W2b 安装生命周期）。
 *
 * 组织隔离：forOrganization scope 强制过滤 organization_id。
 * 状态机：installed（未启用）/ enabled（已启用）/ uninstalled（已卸载）。
 * 卸载软删除语义：卸载记录保留句柄与审计，uninstalledAt 记录卸载时间戳。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PluginInstallationStatus, PluginPermissionConfirmationSummary } from '@aiproj/types'

export default class PluginInstallation extends BaseModel {
  public static table = 'plugin_installations'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare pluginId: string

  @column()
  declare version: string

  @column()
  declare releaseId: number

  @column()
  declare status: PluginInstallationStatus

  @column({
    prepare: (value: PluginPermissionConfirmationSummary | null) =>
      value ? JSON.stringify(value) : null,
    consume: (value: string | PluginPermissionConfirmationSummary | null) => {
      if (!value) return null
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as PluginPermissionConfirmationSummary
        } catch {
          return null
        }
      }
      return value
    },
  })
  declare permissionConfirmation: PluginPermissionConfirmationSummary | null

  @column()
  declare packageDigest: string

  @column()
  declare manifestDigest: string

  @column()
  declare compatibilityDigest: string

  @column()
  declare rowVersion: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare uninstalledAt: DateTime | null

  /**
   * Scope: 按组织过滤。
   */
  static forOrganization(query: ReturnType<typeof PluginInstallation.query>, orgId: number) {
    return query.where('organizationId', orgId)
  }

  /**
   * Scope: 只返回未卸载的安装记录 (installed 或 enabled)。
   */
  static active(query: ReturnType<typeof PluginInstallation.query>) {
    return query.whereIn('status', ['installed', 'enabled'])
  }

  /**
   * Scope: 只返回已启用的安装记录。
   */
  static enabled(query: ReturnType<typeof PluginInstallation.query>) {
    return query.where('status', 'enabled')
  }
}
