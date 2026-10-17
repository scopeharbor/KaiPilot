import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Copilot session retention deletion record model。
 *
 * 记录每次会话删除操作的完整审计信息。
 * session_id 为原始会话标识符，session_db_id 为数据库主键。
 * trigger_reason 标识删除触发原因：retention_expired / user_requested / organization_requested。
 * tombstone_id 可选关联 tombstone 记录（FK）。
 * policy_hash 关联执行删除时所用的策略版本。
 */
export default class CopilotSessionRetentionDeletionRecord extends BaseModel {
  static table = 'copilot_session_retention_deletion_records'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare sessionId: string

  @column()
  declare sessionDbId: number

  @column()
  declare triggerReason: 'retention_expired' | 'user_requested' | 'organization_requested'

  @column.dateTime()
  declare deletedAt: DateTime

  @column()
  declare messageCount: number

  @column()
  declare tombstoneId: number | null

  @column()
  declare policyHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  // ── Scopes（组织隔离约定）─────────────────────────────────────────────

  /**
   * 组织隔离过滤（所有查询必须调用）。
   */
  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  /**
   * 按触发原因过滤。
   */
  static scopeByTriggerReason(
    query: any,
    reason: 'retention_expired' | 'user_requested' | 'organization_requested',
  ) {
    query.where('trigger_reason', reason)
  }
}
