import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrRetentionCleanupRunStatus } from '@aiproj/types'
import User from './user.js'

/**
 * OCR 保留清理运行模型（v3-ocr-result-persistence-and-retention §3.4）。
 *
 * run_key 保证幂等；preview_hash + policy_hash 保证可验证。
 * 只存计数摘要——不存被清理的文本或 provider payload。
 */
export default class OcrRetentionCleanupRun extends BaseModel {
  static table = 'ocr_retention_cleanup_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare runKey: string

  @column()
  declare status: OcrRetentionCleanupRunStatus

  @column()
  declare previewHash: string

  @column()
  declare policyHash: string

  @column()
  declare expiredCount: number

  @column()
  declare redactedCount: number

  @column()
  declare purgedCount: number

  @column()
  declare tombstoneCount: number

  @column()
  declare blockedCount: number

  @column()
  declare executedBy: number

  @column()
  declare failureReason: string | null

  @column.dateTime()
  declare startedAt: DateTime

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'executedBy' })
  declare executor: BelongsTo<typeof User>
}
