import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrTableRowCandidate,
  OcrExtractionWarning,
  OcrExtractionProvenanceKind,
  OcrExtractionCandidateStatus,
  OcrExtractionConfidenceLevel,
} from '@aiproj/types'
import OcrStructuredExtractionRun from './ocr_structured_extraction_run.js'

export default class OcrStructuredExtractionTableCandidate extends BaseModel {
  static table = 'ocr_structured_extraction_table_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare tableKey: string

  @column()
  declare columnCount: number

  @column({
    prepare: (v: OcrTableRowCandidate[]) => JSON.stringify(v),
    consume: (v: unknown): OcrTableRowCandidate[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrTableRowCandidate[]
    },
    serialize: (v: unknown) => v,
  })
  declare rowsJson: OcrTableRowCandidate[]

  @column()
  declare maxRows: number

  @column()
  declare confidence: OcrExtractionConfidenceLevel

  @column()
  declare confidenceScore: number

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
