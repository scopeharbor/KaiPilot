import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizPmPhaseIntegrationRun from './triz_pm_phase_integration_run.js'
import type {
  PmPhaseId,
  PhaseReadinessState,
  PmSourceRef,
  PhaseGapDiagnostic,
  PhaseRecommendation,
  PhaseWarning,
  PhaseReviewMetadata,
} from '@aiproj/types'

/**
 * TRIZ-PM 阶段整合快照模型（v3-triz-pm-phase-integration §3.5）。
 *
 * 每条记录是一个 PM 阶段的低敏审查快照。
 * source_refs/source_hashes/gaps/recommendations/warnings/review_metadata 为 JSON 列。
 */
export default class TrizPmPhaseSnapshot extends BaseModel {
  static table = 'triz_pm_phase_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare snapshotId: string

  @column()
  declare phaseId: PmPhaseId

  @column()
  declare phaseLabel: string

  @column({
    prepare: (v: PmSourceRef[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): PmSourceRef[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as PmSourceRef[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceRefsJson: PmSourceRef[]

  @column({
    prepare: (v: Record<string, string> | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): Record<string, string> => {
      if (!v) return {}
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, string>
    },
    serialize: (v: unknown) => v,
  })
  declare sourceHashesJson: Record<string, string>

  @column({
    prepare: (v: PhaseGapDiagnostic[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): PhaseGapDiagnostic[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhaseGapDiagnostic[]
    },
    serialize: (v: unknown) => v,
  })
  declare gapsJson: PhaseGapDiagnostic[]

  @column({
    prepare: (v: PhaseRecommendation[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): PhaseRecommendation[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhaseRecommendation[]
    },
    serialize: (v: unknown) => v,
  })
  declare recommendationsJson: PhaseRecommendation[]

  @column({
    prepare: (v: PhaseWarning[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): PhaseWarning[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhaseWarning[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningsJson: PhaseWarning[]

  @column()
  declare readiness: PhaseReadinessState

  @column({
    consume: (v: unknown) => (v === null ? false : Boolean(v)),
    prepare: (v: boolean) => (v ? 1 : 0),
  })
  declare stale: boolean

  @column()
  declare methodologyHint: string | null

  @column({
    prepare: (v: PhaseReviewMetadata | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): PhaseReviewMetadata | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhaseReviewMetadata
    },
    serialize: (v: unknown) => v,
  })
  declare reviewMetadataJson: PhaseReviewMetadata | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizPmPhaseIntegrationRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizPmPhaseIntegrationRun>
}
