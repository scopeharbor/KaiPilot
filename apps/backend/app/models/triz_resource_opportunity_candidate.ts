import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizResourceAnalysisRun from './triz_resource_analysis_run.js'
import User from './user.js'
import type {
  ResourceOpportunityStatus,
  OpportunityType,
  OpportunitySeverity,
  ResourceSourceRef,
  ResourceWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 资源机会候选快照模型（v3-triz-resource-analyzer §3.2）。
 *
 * 每条记录是一个未利用资源机会候选——确定性规则识别、稳定评分、审查导向。
 * 组织+项目双隔离；关联 run_id。
 * 不自动写入正式资源或任务事实。
 */
export default class TrizResourceOpportunityCandidate extends BaseModel {
  static table = 'triz_resource_opportunity_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare opportunityKey: string

  @column()
  declare opportunityType: OpportunityType

  @column()
  declare ruleId: string

  @column()
  declare status: ResourceOpportunityStatus

  @column()
  declare severity: OpportunitySeverity

  @column()
  declare confidence: number

  @column()
  declare impactScore: number

  @column()
  declare title: string

  @column()
  declare rationaleSummary: string

  @column({
    prepare: (v: ResourceSourceRef[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): ResourceSourceRef[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as ResourceSourceRef[]
    },
    serialize: (v: unknown) => v,
  })
  declare resourceRefsJson: ResourceSourceRef[]

  @column({
    prepare: (v: ResourceSourceRef[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): ResourceSourceRef[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as ResourceSourceRef[]
    },
    serialize: (v: unknown) => v,
  })
  declare targetRefsJson: ResourceSourceRef[]

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare suggestedActionsJson: string[]

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
    prepare: (v: ResourceWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): ResourceWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as ResourceWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodesJson: ResourceWarningCode[]

  @column({
    prepare: (v: unknown) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): Record<string, unknown> | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, unknown> | null
    },
    serialize: (v: unknown) => v,
  })
  declare aiExplanationRefJson: Record<string, unknown> | null

  @column()
  declare outputHash: string

  @column()
  declare reviewedBy: number | null

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizResourceAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizResourceAnalysisRun>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewer: BelongsTo<typeof User>
}
