import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizEvolutionTrendAnalysisRun from './triz_evolution_trend_analysis_run.js'
import type {
  EvolutionTrendId,
  EvolutionTrendStage,
  TrendSeverity,
  EvolutionTrendDirection,
  EvolutionTrendSourceRef,
  EvolutionTrendWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 进化趋势评分快照模型（v3-triz-evolution-trend-analysis §3.2）。
 *
 * 每条记录是某次运行下一个趋势维度的评分快照（阶段/评分/置信度/严重度/方向）。
 * 组织+项目双隔离；关联 run_id。
 */
export default class TrizEvolutionTrendScore extends BaseModel {
  static table = 'triz_evolution_trend_scores'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare trendKey: string

  @column()
  declare trendId: EvolutionTrendId

  @column()
  declare stage: EvolutionTrendStage

  @column()
  declare score: number

  @column()
  declare confidence: number

  @column()
  declare severity: TrendSeverity

  @column()
  declare direction: EvolutionTrendDirection

  @column({
    prepare: (v: EvolutionTrendSourceRef[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): EvolutionTrendSourceRef[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as EvolutionTrendSourceRef[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceRefsJson: EvolutionTrendSourceRef[]

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
    prepare: (v: Record<string, number | string | null> | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): Record<string, number | string | null> => {
      if (!v) return {}
      if (typeof v === 'string') return JSON.parse(v)
      return v as Record<string, number | string | null>
    },
    serialize: (v: unknown) => v,
  })
  declare metricsJson: Record<string, number | string | null>

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

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizEvolutionTrendAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizEvolutionTrendAnalysisRun>
}
