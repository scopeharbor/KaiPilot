/**
 * v2-project-compiler-foundation —— CompilerStageEvent Model（tasks 3.4）。
 *
 * 组织隔离：所有查询经 organization_id 过滤。
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CompilerRun from './compiler_run.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class CompilerStageEvent extends BaseModel {
  public static table = 'compiler_stage_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare compilerRunId: number

  @column()
  declare organizationId: number

  @column()
  declare stageId: string

  @column()
  declare phase: string

  @column()
  declare status: string

  @column()
  declare entityId: string | null

  @column()
  declare attemptNumber: number | null

  @column()
  declare modelMode: string | null

  @column()
  declare tokenBudget: number | null

  @column()
  declare validationSummary: string | null

  @column.dateTime()
  declare startedAt: DateTime | null

  @column.dateTime()
  declare endedAt: DateTime | null

  @column()
  declare durationMs: number | null

  @column()
  declare llmCalls: number

  @column()
  declare llmCost: number

  @column(jsonColumn)
  declare error: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => CompilerRun, { foreignKey: 'compilerRunId' })
  declare run: BelongsTo<typeof CompilerRun>

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }
}
