import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Copilot session retention tombstone model。
 *
 * 当会话因保留策略被删除时，创建一条 tombstone 记录作为不可逆删除的低敏证据。
 * original_session_id 为被删除会话的 opaque 稳定标识符。
 * tombstone_hash 使用 FNV-1a 哈希，不可逆。
 * message_count 保留低敏的消息计数统计。
 * policy_hash 关联执行删除时所用的策略版本。
 */
export default class CopilotSessionRetentionTombstone extends BaseModel {
  static table = 'copilot_session_retention_tombstones'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare originalSessionId: string

  @column()
  declare tombstoneHash: string

  @column()
  declare messageCount: number

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
}
