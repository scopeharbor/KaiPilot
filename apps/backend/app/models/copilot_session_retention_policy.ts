import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Copilot session retention policy model。
 *
 * 每条记录代表一个作用域（组织或组织+项目）的保留策略覆盖。
 * retention_days 控制会话保留天数（1–3650）。
 * enabled 为 false 时该作用域的保留逻辑不生效。
 * policy_hash 允许确定性检测策略变更。
 */
export default class CopilotSessionRetentionPolicy extends BaseModel {
  static table = 'copilot_session_retention_policies'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare retentionDays: number

  @column()
  declare enabled: boolean

  @column()
  declare policyHash: string

  @column()
  declare source: 'organization' | 'project'

  @column()
  declare updatedBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── Scopes（组织隔离约定）─────────────────────────────────────────────

  /**
   * 组织隔离过滤（所有查询必须调用）。
   */
  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  /**
   * 按项目过滤。
   */
  static scopeByProject(query: any, projectId: number) {
    query.where('project_id', projectId)
  }
}
