import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import type {
  OcrEntityLinkRunStatus,
  OcrEntityLinkStaleSummary,
  OcrTargetKind,
} from '@aiproj/types'
import User from './user.js'
import OcrEntityLinkCandidate from './ocr_entity_link_candidate.js'

export default class OcrEntityLinkRun extends BaseModel {
  static table = 'ocr_entity_link_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare inputSignature: string

  @column()
  declare ruleVersion: string

  @column()
  declare status: OcrEntityLinkRunStatus

  @column()
  declare candidateCount: number

  @column()
  declare confirmedCount: number

  @column({
    prepare: (v: number[]) => JSON.stringify(v),
    consume: (v: unknown): number[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as number[]
    },
  })
  declare sourceExtractionIdsJson: number[]

  @column({
    prepare: (v: OcrTargetKind[]) => JSON.stringify(v),
    consume: (v: unknown): OcrTargetKind[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrTargetKind[]
    },
  })
  declare targetKindsJson: OcrTargetKind[]

  @column({
    prepare: (v: OcrEntityLinkStaleSummary | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): OcrEntityLinkStaleSummary | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as OcrEntityLinkStaleSummary
    },
    serialize: (v: unknown) => v,
  })
  declare staleSummaryJson: OcrEntityLinkStaleSummary | null

  @column()
  declare errorMessage: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  @hasMany(() => OcrEntityLinkCandidate, { foreignKey: 'runId' })
  declare candidates: HasMany<typeof OcrEntityLinkCandidate>
}
