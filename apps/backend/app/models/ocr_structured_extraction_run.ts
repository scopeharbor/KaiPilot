import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrExtractionRunStatus,
  OcrExtractionProvenanceKind,
  OcrExtractionWarningSummary,
  OcrProfileProjection,
} from '@aiproj/types'
import OcrStructuredExtractionProfile from './ocr_structured_extraction_profile.js'
import OcrStructuredExtractionProfileVersion from './ocr_structured_extraction_profile_version.js'

export default class OcrStructuredExtractionRun extends BaseModel {
  static table = 'ocr_structured_extraction_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare extractionId: number

  @column()
  declare profileId: number | null

  @column()
  declare profileVersionId: number | null

  @column()
  declare profileRef: string | null

  @column()
  declare profileSource: 'builtin' | 'organization' | 'plugin'

  @column()
  declare profilePayloadDigest: string | null

  @column({
    prepare: (value: OcrProfileProjection | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown): OcrProfileProjection | null => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : (value as OcrProfileProjection)
    },
    serialize: (value: unknown) => value,
  })
  declare profileSnapshotJson: OcrProfileProjection | null

  @column()
  declare profileName: string

  @column()
  declare profileVersion: number

  @column()
  declare status: OcrExtractionRunStatus

  @column()
  declare provenance: OcrExtractionProvenanceKind

  @column()
  declare sourceHash: string

  @column()
  declare inputSignature: string

  @column()
  declare idempotencyKey: string

  @column()
  declare totalFieldCandidates: number

  @column()
  declare totalTableCandidates: number

  @column()
  declare warningCount: number

  @column()
  declare errorCount: number

  @column({
    prepare: (v: OcrExtractionWarningSummary | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): OcrExtractionWarningSummary | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrExtractionWarningSummary
    },
    serialize: (v: unknown) => v,
  })
  declare warningSummaryJson: OcrExtractionWarningSummary | null

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => OcrStructuredExtractionProfile, { foreignKey: 'profileId' })
  declare profile: BelongsTo<typeof OcrStructuredExtractionProfile>

  // 关系名不能叫 profileVersion：同表已有 profile_version 整数列，重名会遮蔽列声明
  @belongsTo(() => OcrStructuredExtractionProfileVersion, { foreignKey: 'profileVersionId' })
  declare profileVersionRef: BelongsTo<typeof OcrStructuredExtractionProfileVersion>
}
