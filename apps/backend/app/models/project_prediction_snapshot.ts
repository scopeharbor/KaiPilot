import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ProjectPredictionSignal from './project_prediction_signal.js'
import type {
  PredictionSnapshotStatus,
  PredictionWindow,
  PredictionDataWarning,
  PredictionAiExplanation,
} from '@aiproj/types'

/**
 * v2-ai-risk-progress-prediction — ProjectPredictionSnapshot model.
 */
export default class ProjectPredictionSnapshot extends BaseModel {
  static table = 'project_prediction_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare window: PredictionWindow

  @column()
  declare status: PredictionSnapshotStatus

  @column()
  declare ruleVersion: string

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string

  @column()
  declare sourceHash: string

  @column({
    prepare: (value: PredictionDataWarning[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) =>
      value ? (JSON.parse(value) as PredictionDataWarning[]) : null,
  })
  declare warnings: PredictionDataWarning[] | null

  @column({
    prepare: (value: PredictionAiExplanation | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | null) =>
      value ? (JSON.parse(value) as PredictionAiExplanation) : null,
  })
  declare aiExplanation: PredictionAiExplanation | null

  @column()
  declare confirmationStatus: string

  @column()
  declare confirmedBy: number | null

  @column.dateTime()
  declare confirmedAt: DateTime | null

  @column()
  declare confirmedNotes: string | null

  @column()
  declare dismissedBy: number | null

  @column.dateTime()
  declare dismissedAt: DateTime | null

  @column()
  declare dismissReason: string | null

  @column()
  declare stale: boolean

  @column()
  declare staleReason: string | null

  @column()
  declare generatedBy: number

  @column.dateTime()
  declare generatedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @hasMany(() => ProjectPredictionSignal, { foreignKey: 'snapshotId' })
  declare signals: HasMany<typeof ProjectPredictionSignal>
}
