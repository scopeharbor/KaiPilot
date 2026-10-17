import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  OcrEntityMentionType,
  OcrEntityLinkCandidateStatus,
  OcrEntityLinkWarningCode,
  OcrEntityLinkTargetSuggestion,
} from '@aiproj/types'
import OcrEntityLinkRun from './ocr_entity_link_run.js'

export default class OcrEntityLinkCandidate extends BaseModel {
  static table = 'ocr_entity_link_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare runId: number

  @column()
  declare extractionId: number

  @column({
    prepare: (v: number[]) => JSON.stringify(v),
    consume: (v: unknown): number[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as number[]
    },
  })
  declare pageRefsJson: number[]

  @column()
  declare spanStart: number

  @column()
  declare spanEnd: number

  @column()
  declare mentionType: OcrEntityMentionType

  @column()
  declare normalizedLabel: string

  @column()
  declare selectedTextHash: string

  @column()
  declare spanHash: string

  @column()
  declare confidence: number

  @column()
  declare status: OcrEntityLinkCandidateStatus

  @column({
    prepare: (v: OcrEntityLinkTargetSuggestion | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): OcrEntityLinkTargetSuggestion | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrEntityLinkTargetSuggestion
    },
    serialize: (v: unknown) => v,
  })
  declare targetSuggestionJson: OcrEntityLinkTargetSuggestion | null

  @column({
    prepare: (v: OcrEntityLinkWarningCode[]) => JSON.stringify(v),
    consume: (v: unknown): OcrEntityLinkWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrEntityLinkWarningCode[]
    },
  })
  declare warningsJson: OcrEntityLinkWarningCode[]

  @column()
  declare candidateKey: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => OcrEntityLinkRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof OcrEntityLinkRun>
}
