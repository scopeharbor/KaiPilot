import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizEvolutionTrendAnalysisRun from './triz_evolution_trend_analysis_run.js'
import User from './user.js'
import type {
  TrendRiskType,
  EvolutionTrendId,
  TrendRiskStatus,
  TrendSeverity,
  EvolutionTrendSourceRef,
  EvolutionTrendWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 进化趋势风险候选快照模型（v3-triz-evolution-trend-analysis §3.2）。
 *
 * 每条记录是一个趋势风险预警候选——确定性规则识别、稳定评分、审查导向。
 * 组织+项目双隔离；关联 run_id。
 * 不自动写入正式风险登记项。
 */
export default class TrizEvolutionTrendRiskCandidate extends BaseModel {
  static table = 'triz_evolution_trend_risk_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare riskKey: string

  @column()
  declare trendId: EvolutionTrendId

  @column()
  declare riskType: TrendRiskType

  @column()
  declare ruleId: string

  @column()
  declare status: TrendRiskStatus

  @column()
  declare severity: TrendSeverity

  @column()
  declare confidence: number

  @column()
  declare impactScore: number

  @column()
  declare title: string

  @column()
  declare rationaleSummary: string

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare trendRefsJson: string[]

  @column({
    prepare: (v: EvolutionTrendSourceRef[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): EvolutionTrendSourceRef[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as EvolutionTrendSourceRef[]
    },
    serialize: (v: unknown) => v,
  })
  declare targetRefsJson: EvolutionTrendSourceRef[]

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
    prepare: (v: EvolutionTrendWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): EvolutionTrendWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as EvolutionTrendWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodesJson: EvolutionTrendWarningCode[]

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
  @belongsTo(() => TrizEvolutionTrendAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizEvolutionTrendAnalysisRun>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewer: BelongsTo<typeof User>
}
