import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizPmPhaseIntegrationRun from './triz_pm_phase_integration_run.js'
import User from './user.js'
import type {
  PmPhaseId,
  PhaseActionKind,
  PhaseActionStatus,
  PhaseHandoffTarget,
} from '@aiproj/types'

/**
 * TRIZ-PM 阶段审查动作/Handoff 元数据模型（v3-triz-pm-phase-integration §3.5）。
 *
 * 每条记录是一次人工审查动作或 handoff preview 的轻量记录。
 * source_hashes/confirmation_metadata 为 JSON 列。
 */
export default class TrizPmPhaseAction extends BaseModel {
  static table = 'triz_pm_phase_actions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare phaseId: PmPhaseId

  @column()
  declare recommendationId: string

  @column()
  declare actionKind: PhaseActionKind

  @column()
  declare handoffTarget: PhaseHandoffTarget | null

  @column()
  declare idempotencyKey: string

  @column()
  declare status: PhaseActionStatus

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
    prepare: (v: Record<string, unknown> | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): Record<string, unknown> | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, unknown>
    },
    serialize: (v: unknown) => v,
  })
  declare confirmationMetadataJson: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizPmPhaseIntegrationRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizPmPhaseIntegrationRun>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
