/**
 * v2-project-compiler-foundation —— CompilerRun Model（tasks 3.4）。
 *
 * 组织隔离：所有查询经 `forOrganization` helper 自动附加 organization_id。
 */
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import CompilerStageEvent from './compiler_stage_event.js'
import CompilerArtifact from './compiler_artifact.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class CompilerRun extends BaseModel {
  public static table = 'compiler_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare requestedByUserId: number

  @column()
  declare status: string

  /** v3-copilot-agent-workflow-orchestration：区分编译 run 与 Copilot 编排 run。 */
  @column()
  declare runType: string

  @column()
  declare currentPhase: string | null

  @column()
  declare currentStage: string | null

  @column(jsonColumn)
  declare input: Record<string, unknown>

  @column(jsonColumn)
  declare error: Record<string, unknown> | null

  @column()
  declare idempotencyKey: string | null

  @column()
  declare inputHash: string | null

  @column(jsonColumn)
  declare templateSnapshot: Record<string, unknown> | null

  @column()
  declare templateSelectionDigest: string | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => CompilerStageEvent, { foreignKey: 'compilerRunId' })
  declare events: HasMany<typeof CompilerStageEvent>

  @hasMany(() => CompilerArtifact, { foreignKey: 'compilerRunId' })
  declare artifacts: HasMany<typeof CompilerArtifact>

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
