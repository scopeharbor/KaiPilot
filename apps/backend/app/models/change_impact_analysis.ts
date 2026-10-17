import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ChangeRequest from './change_request.js'
import User from './user.js'
import {
  type ChangeImpactAnalysisStatus,
  type ChangeImpactSummary,
  type ChangeImpactWarning,
  type MissingInput,
  type AnalysisScope,
  type AiExplanation,
} from '@aiproj/types'

/**
 * 变更影响分析快照模型（v2-change-management-impact-analysis D1）。
 * 创建/刷新时写入新记录，旧记录保留。
 */
export default class ChangeImpactAnalysis extends BaseModel {
  static table = 'change_impact_analyses'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare changeRequestId: number

  @column()
  declare ruleVersion: string

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string | null

  @column()
  declare status: ChangeImpactAnalysisStatus

  @column()
  declare staleReason: string | null

  @column({
    prepare: (v: AnalysisScope | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): AnalysisScope | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as AnalysisScope
      return v as AnalysisScope
    },
    serialize: (v: unknown) => v,
  })
  declare scope: AnalysisScope | null

  @column({
    prepare: (v: ChangeImpactSummary | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): ChangeImpactSummary | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as ChangeImpactSummary
      return v as ChangeImpactSummary
    },
    serialize: (v: unknown) => v,
  })
  declare summary: ChangeImpactSummary | null

  @column({
    prepare: (v: ChangeImpactWarning[] | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): ChangeImpactWarning[] | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as ChangeImpactWarning[]
      return v as ChangeImpactWarning[]
    },
    serialize: (v: unknown) => v,
  })
  declare warnings: ChangeImpactWarning[] | null

  @column({
    prepare: (v: MissingInput[] | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): MissingInput[] | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as MissingInput[]
      return v as MissingInput[]
    },
    serialize: (v: unknown) => v,
  })
  declare missingInputs: MissingInput[] | null

  @column({
    prepare: (v: AiExplanation | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): AiExplanation | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as AiExplanation
      return v as AiExplanation
    },
    serialize: (v: unknown) => v,
  })
  declare aiExplanation: AiExplanation | null

  @column()
  declare confirmedBy: number | null

  @column.dateTime()
  declare confirmedAt: DateTime | null

  @column()
  declare confirmReason: string | null

  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => ChangeRequest, { foreignKey: 'changeRequestId' })
  declare changeRequest: BelongsTo<typeof ChangeRequest>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'confirmedBy' })
  declare confirmer: BelongsTo<typeof User>
}
