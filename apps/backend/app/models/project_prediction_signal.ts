import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ProjectPredictionSnapshot from './project_prediction_snapshot.js'
import type {
  PredictionSignalType,
  PredictionSeverity,
  PredictionConfidenceBand,
  PredictionEvidenceRef,
} from '@aiproj/types'

/**
 * v2-ai-risk-progress-prediction — ProjectPredictionSignal model.
 */
export default class ProjectPredictionSignal extends BaseModel {
  static table = 'project_prediction_signals'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare snapshotId: number

  @column()
  declare signalType: PredictionSignalType

  @column()
  declare severity: PredictionSeverity

  @column()
  declare score: number

  @column()
  declare confidenceBand: PredictionConfidenceBand

  @column()
  declare confidenceLower: number | null

  @column()
  declare confidenceUpper: number | null

  @column()
  declare ruleId: string

  @column()
  declare ruleVersion: string

  @column()
  declare description: string

  @column({
    prepare: (value: PredictionEvidenceRef[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) =>
      value ? (JSON.parse(value) as PredictionEvidenceRef[]) : null,
  })
  declare evidenceRefs: PredictionEvidenceRef[] | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => ProjectPredictionSnapshot, { foreignKey: 'snapshotId' })
  declare snapshot: BelongsTo<typeof ProjectPredictionSnapshot>
}
