import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  CodeGenerationStageId,
  CodeGenerationToolId,
} from '@aiproj/types/compiler-code-generation'
import CompilerCodegenCandidateRun from './compiler_codegen_candidate_run.js'

/**
 * 单个 34 阶段 stage 的候选完成记录。
 *
 * 只存 refs / 工具 id / 摘要 / reason code；不存 prompt、原始模型输出、
 * token、密钥或授权头（契约 validateCodeGenerationToolResult 已在写入前拦截）。
 */
export default class CompilerCodegenStageRecord extends BaseModel {
  static table = 'compiler_codegen_stage_records'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare runtimeSessionId: string

  @column()
  declare stageId: CodeGenerationStageId

  @column()
  declare stageOrder: number

  @column()
  declare status: 'completed'

  @column()
  declare contractVersion: string

  @column()
  declare contextScope: string

  @column()
  declare reasonCode: string

  @column({
    prepare: (v: string[]) => JSON.stringify(v ?? []),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
  })
  declare artifactRefsJson: string[]

  @column({
    prepare: (v: string[]) => JSON.stringify(v ?? []),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
  })
  declare observationRefsJson: string[]

  @column({
    prepare: (v: string[]) => JSON.stringify(v ?? []),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
  })
  declare toolCallIdsJson: string[]

  @column({
    prepare: (v: CodeGenerationToolId[]) => JSON.stringify(v ?? []),
    consume: (v: unknown): CodeGenerationToolId[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as CodeGenerationToolId[]
    },
  })
  declare visibleToolIdsJson: CodeGenerationToolId[]

  @column()
  declare summary: string

  @column.dateTime()
  declare completedAt: DateTime

  @belongsTo(() => CompilerCodegenCandidateRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof CompilerCodegenCandidateRun>
}
