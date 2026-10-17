import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import type {
  CodeGenerationHumanReviewPacket,
  CodeGenerationToolProvider,
} from '@aiproj/types/compiler-code-generation'
import User from './user.js'
import CompilerCodegenStageRecord from './compiler_codegen_stage_record.js'

/**
 * 34 阶段代码生成候选运行状态机。
 *
 * 刻意不存在 applied / approved 状态：本能力只产候选元数据，
 * 把候选转正的人工确认流程属后续独立 change（红线 1）。
 */
export type CompilerCodegenRunStatus =
  'pending' | 'running' | 'candidate_ready_pending_review' | 'halted'

/** 真实模型编译属授权门，当前唯一可达模式为 fixture。 */
export type CompilerCodegenExecutionMode = 'fixture'

export default class CompilerCodegenCandidateRun extends BaseModel {
  static table = 'compiler_codegen_candidate_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare createdBy: number

  @column()
  declare runtimeSessionId: string

  @column()
  declare catalogVersion: string

  @column()
  declare provider: CodeGenerationToolProvider

  @column()
  declare executionMode: CompilerCodegenExecutionMode

  @column()
  declare status: CompilerCodegenRunStatus

  @column()
  declare stageCount: number

  @column()
  declare completedStageCount: number

  @column()
  declare currentStageId: string | null

  @column()
  declare failureStageId: string | null

  @column()
  declare failureReasonCode: string | null

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
  })
  declare failureViolationsJson: string[]

  @column({
    prepare: (v: CodeGenerationHumanReviewPacket | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): CodeGenerationHumanReviewPacket | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as CodeGenerationHumanReviewPacket
    },
    serialize: (v: unknown) => v,
  })
  declare reviewPacketJson: CodeGenerationHumanReviewPacket | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @hasMany(() => CompilerCodegenStageRecord, { foreignKey: 'runId' })
  declare stageRecords: HasMany<typeof CompilerCodegenStageRecord>
}
