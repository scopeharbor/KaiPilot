import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import type { ResourceAnalysisRunStatus, ResourceAnalysisCost } from '@aiproj/types'

/**
 * TRIZ 资源分析运行模型（v3-triz-resource-analyzer §3.2）。
 *
 * 组织+项目双隔离；input_signature + idempotency_key 保证幂等。
 * source_summary/warning_summary/cost_summary 为 JSON 列。
 */
export default class TrizResourceAnalysisRun extends BaseModel {
  static table = 'triz_resource_analysis_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare status: ResourceAnalysisRunStatus

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string | null

  @column()
  declare ruleVersion: string

  @column()
  declare taxonomyVersion: string

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
    prepare: (v: Array<{ code: string; message: string }> | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): Array<{ code: string; message: string }> => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as Array<{ code: string; message: string }>
    },
    serialize: (v: unknown) => v,
  })
  declare warningSummaryJson: Array<{ code: string; message: string }>

  @column()
  declare resourceCount: number

  @column()
  declare opportunityCount: number

  @column({
    prepare: (v: ResourceAnalysisCost | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): ResourceAnalysisCost | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as ResourceAnalysisCost
    },
    serialize: (v: unknown) => v,
  })
  declare costSummaryJson: ResourceAnalysisCost | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime()
  declare archivedAt: DateTime | null

  // 关系
  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
