import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { OcrRetentionRecordKind, OcrRetentionCleanupAction } from '@aiproj/types'

/**
 * OCR 保留 tombstone 模型（v3-ocr-result-persistence-and-retention §3.4）。
 *
 * 低敏设计：只存组织/项目/记录身份/哈希/清理原因/策略快照/时间。
 * 不存完整 OCR 文本、provider body、prompt、secret 或绝对路径。
 */
export default class OcrRetentionTombstone extends BaseModel {
  static table = 'ocr_retention_tombstones'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare recordKind: OcrRetentionRecordKind

  @column()
  declare recordId: number

  @column()
  declare sourceKind: string | null

  @column()
  declare sourceHash: string | null

  @column()
  declare contentHash: string | null

  @column()
  declare lifecycleAction: OcrRetentionCleanupAction

  @column()
  declare cleanupReason: string

  @column()
  declare policyHash: string

  @column()
  declare tombstoneHash: string

  @column()
  declare cleanupRunId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
