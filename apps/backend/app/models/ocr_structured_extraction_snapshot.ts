import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type { OcrTypedFieldValue, OcrTableRowCandidate } from '@aiproj/types'
import OcrStructuredExtractionProfile from './ocr_structured_extraction_profile.js'

export default class OcrStructuredExtractionSnapshot extends BaseModel {
  static table = 'ocr_structured_extraction_snapshots'

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
  declare profileRef: string | null

  @column()
  declare profileSource: 'builtin' | 'organization' | 'plugin'

  @column()
  declare profilePayloadDigest: string | null

  @column()
  declare pluginVersion: string | null

  @column()
  declare profileVersion: number

  @column()
  declare sourceHash: string

  @column()
  declare snapshotHash: string

  @column({
    prepare: (v: Record<string, OcrTypedFieldValue | null> | null) =>
      v ? JSON.stringify(v) : null,
    consume: (v: unknown): Record<string, OcrTypedFieldValue | null> | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, OcrTypedFieldValue | null>
    },
    serialize: (v: unknown) => v,
  })
  declare fieldValuesJson: Record<string, OcrTypedFieldValue | null> | null

  @column({
    prepare: (v: Record<string, OcrTableRowCandidate[]> | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): Record<string, OcrTableRowCandidate[]> | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, OcrTableRowCandidate[]>
    },
    serialize: (v: unknown) => v,
  })
  declare tableValuesJson: Record<string, OcrTableRowCandidate[]> | null

  @column({
    prepare: (v: string[]) => JSON.stringify(v),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceSpanHashesJson: string[]

  @column({
    prepare: (v: string[]) => JSON.stringify(v),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare candidateHashesJson: string[]

  @column()
  declare previewHash: string

  @column()
  declare reviewerId: number

  @column()
  declare reviewNote: string | null

  @column()
  declare status: 'current' | 'superseded'

  @column()
  declare supersededById: number | null

  @column()
  declare fieldCount: number

  @column()
  declare tableCount: number

  @column.dateTime()
  declare confirmedAt: DateTime

  @column.dateTime()
  declare supersededAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => OcrStructuredExtractionProfile, { foreignKey: 'profileId' })
  declare profile: BelongsTo<typeof OcrStructuredExtractionProfile>
}
