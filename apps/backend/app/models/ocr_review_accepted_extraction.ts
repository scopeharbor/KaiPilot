import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import type { OcrAcceptedExtractionStatus } from '@aiproj/types'

/**
 * OCR 审查已接受提取模型（v3-ocr-review-confirmation-flow §3.3）。
 *
 * 组织+项目双隔离 + append-only + supersede 语义。
 * source_hash + candidate_hash + selected_text_hash 保证确定性可追踪。
 * page_refs 为 JSON 列。
 */
export default class OcrReviewAcceptedExtraction extends BaseModel {
  static table = 'ocr_review_accepted_extractions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare reviewerId: number

  @column()
  declare sourceKind: 'attachment' | 'document' | 'unknown'

  @column()
  declare sourceId: number | null

  @column()
  declare jobId: number | null

  @column()
  declare candidateId: number | null

  @column()
  declare sourceHash: string

  @column()
  declare candidateHash: string

  @column()
  declare selectedTextHash: string

  @column()
  declare selectedText: string

  @column({
    prepare: (v: number[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): number[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as number[]
    },
    serialize: (v: unknown) => v,
  })
  declare pageRefsJson: number[]

  @column()
  declare reviewNote: string | null

  @column()
  declare status: OcrAcceptedExtractionStatus

  @column()
  declare supersededById: number | null

  @column()
  declare confirmationHash: string | null

  @column.dateTime()
  declare confirmedAt: DateTime

  @column.dateTime()
  declare supersededAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── 保留生命周期元数据（v3-ocr-result-persistence-and-retention §3.5） ──
  @column()
  declare retentionLifecycle: string | null

  @column()
  declare retentionSensitivity: string | null

  @column.dateTime()
  declare retentionEligibleAt: DateTime | null

  @column.dateTime()
  declare purgedAt: DateTime | null

  @column.dateTime()
  declare redactedAt: DateTime | null

  @column()
  declare tombstoneId: number | null

  @column()
  declare retentionPolicyHash: string | null

  // 关系
  @belongsTo(() => User, { foreignKey: 'reviewerId' })
  declare reviewer: BelongsTo<typeof User>
}
