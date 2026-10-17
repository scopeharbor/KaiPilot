import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrStructuredFieldType,
  OcrTypedFieldValue,
  OcrExtractionWarning,
  OcrExtractionProvenanceKind,
  OcrExtractionCandidateStatus,
  OcrExtractionConfidenceLevel,
} from '@aiproj/types'
import OcrStructuredExtractionRun from './ocr_structured_extraction_run.js'

export default class OcrStructuredExtractionFieldCandidate extends BaseModel {
  static table = 'ocr_structured_extraction_field_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare sectionKey: string

  @column()
  declare fieldKey: string

  @column()
  declare fieldType: OcrStructuredFieldType

  @column()
  declare raw: string

  @column({
    prepare: (v: OcrTypedFieldValue | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): OcrTypedFieldValue | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrTypedFieldValue
    },
    serialize: (v: unknown) => v,
  })
  declare valueJson: OcrTypedFieldValue | null

  @column()
  declare confidence: OcrExtractionConfidenceLevel

  @column()
  declare confidenceScore: number

  @column()
  declare spanPageIndex: number | null

  @column()
  declare spanCharStart: number | null

  @column()
  declare spanCharEnd: number | null

  @column()
  declare sourceSpanHash: string

  @column()
  declare candidateHash: string

  @column({
    prepare: (v: OcrExtractionWarning[] | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): OcrExtractionWarning[] | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrExtractionWarning[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningsJson: OcrExtractionWarning[] | null

  @column()
  declare provenance: OcrExtractionProvenanceKind

  @column()
  declare status: OcrExtractionCandidateStatus

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => OcrStructuredExtractionRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof OcrStructuredExtractionRun>
}
