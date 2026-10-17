/**
 * v2-5-compiler-config-management-api —— CompilerConfigProfile Lucid Model（design D1/D2）。
 *
 * 组织级、版本化 Compiler Config Profile 实体。
 * 三类配置以 text 存 JSON，应用层解析。
 */
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class CompilerConfigProfile extends BaseModel {
  static table = 'compiler_config_profiles'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare version: number

  @column()
  declare isActive: boolean

  @column()
  declare featureToggles: string

  @column()
  declare budgetPolicies: string

  @column({ serialize: (v: string | null) => v })
  declare cachePolicy: string | null

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ── 组织隔离查询 ──

  /**
   * 组织作用域查询。
   */
  static forOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  /**
   * 获取组织当前生效的 active profile。
   */
  static activeForOrganization(organizationId: number) {
    return this.query()
      .where('organization_id', organizationId)
      .where('is_active', true)
      .orderBy('version', 'desc')
      .first()
  }

  /**
   * 解析 featureToggles JSON。
   */
  get parsedFeatureToggles(): Record<string, boolean> {
    try {
      return JSON.parse(this.featureToggles)
    } catch {
      return {}
    }
  }

  /**
   * 解析 budgetPolicies JSON。
   */
  get parsedBudgetPolicies(): Record<string, unknown>[] {
    try {
      return JSON.parse(this.budgetPolicies)
    } catch {
      return []
    }
  }

  /**
   * 解析 cachePolicy JSON。
   */
  get parsedCachePolicy(): Record<string, unknown> | null {
    if (!this.cachePolicy) return null
    try {
      return JSON.parse(this.cachePolicy)
    } catch {
      return null
    }
  }
}
