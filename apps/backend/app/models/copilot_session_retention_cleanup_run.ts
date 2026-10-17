import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * Copilot session retention cleanup run model。
 *
 * 记录每次清理作业的执行状态与统计信息。
 * run_key 为幂等键，防止重复执行。
 * status 标识作业状态：running / completed / failed。
 * expired_count / tombstone_count / blocked_count 为本次运行的统计摘要。
 * executed_by 为触发清理的用户 ID（null 表示系统自动触发）。
 * failure_reason 在 status=failed 时记录失败原因。
 */
export default class CopilotSessionRetentionCleanupRun extends BaseModel {
  static table = 'copilot_session_retention_cleanup_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare runKey: string

  @column()
  declare status: 'running' | 'completed' | 'failed'

  @column()
  declare policyHash: string

  @column({ columnName: 'expired_count' })
  declare expiredCount: number

  @column({ columnName: 'tombstone_count' })
  declare tombstoneCount: number

  @column({ columnName: 'blocked_count' })
  declare blockedCount: number

  @column()
  declare executedBy: number | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column()
  declare failureReason: string | null

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
