import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import TrizPmPhaseSnapshot from './triz_pm_phase_snapshot.js'
import type { PhaseRunStatus, PhaseWarning, PhaseAiCostSummary } from '@aiproj/types'

/**
 * TRIZ-PM 阶段整合分析运行模型（v3-triz-pm-phase-integration §3.5）。
 *
 * 组织+项目双隔离；input_signature + idempotency_key 保证幂等。
 * source_summary/warning_summary/cost_summary 为 JSON 列。
 */
export default class TrizPmPhaseIntegrationRun extends BaseModel {
  static table = 'triz_pm_phase_integration_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare status: PhaseRunStatus

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string | null

  @column()
  declare idempotencyKey: string

  @column({
    prepare: (v: Record<string, { count: number; hash: string }> | null) =>
      v ? JSON.stringify(v) : '{}',
    consume: (v: unknown): Record<string, { count: number; hash: string }> => {
      if (!v) return {}
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, { count: number; hash: string }>
    },
    serialize: (v: unknown) => v,
  })
  declare sourceSummaryJson: Record<string, { count: number; hash: string }>

  @column({
    prepare: (v: PhaseWarning[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): PhaseWarning[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhaseWarning[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningSummaryJson: PhaseWarning[]

  @column({
    prepare: (v: PhaseAiCostSummary | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): PhaseAiCostSummary | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhaseAiCostSummary
    },
    serialize: (v: unknown) => v,
  })
  declare costSummaryJson: PhaseAiCostSummary | null

  @column()
  declare phaseCount: number

  @column()
  declare blockedPhaseCount: number

  @column()
  declare stalePhaseCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  // 关系
  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  @hasMany(() => TrizPmPhaseSnapshot, { foreignKey: 'runId' })
  declare snapshots: HasMany<typeof TrizPmPhaseSnapshot>
}
