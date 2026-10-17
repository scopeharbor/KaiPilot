import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizEvolutionTrendAnalysisRun from './triz_evolution_trend_analysis_run.js'
import type {
  HistoryComparisonMode,
  EvolutionTrendDelta,
  EvolutionTrendRiskDeltaSummary,
  EvolutionTrendSourceHashComparison,
} from '@aiproj/types'

/**
 * TRIZ 进化趋势历史对比快照模型（v3-triz-evolution-trend-analysis §3.2）。
 *
 * 每条记录是一次「当前 run vs 授权 baseline run」的有界低敏对比结果。
 * 组织+项目双隔离；关联 run_id。
 * 历史样本不足时预测抑制，不编造未来趋势点。
 */
export default class TrizEvolutionTrendHistorySnapshot extends BaseModel {
  static table = 'triz_evolution_trend_history_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare baselineRunId: number | null

  @column()
  declare comparisonMode: HistoryComparisonMode

  @column({
    prepare: (v: EvolutionTrendDelta[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): EvolutionTrendDelta[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as EvolutionTrendDelta[]
    },
    serialize: (v: unknown) => v,
  })
  declare trendDeltaJson: EvolutionTrendDelta[]

  @column({
    prepare: (v: EvolutionTrendRiskDeltaSummary | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): EvolutionTrendRiskDeltaSummary => {
      if (!v) return {} as EvolutionTrendRiskDeltaSummary
      if (typeof v === 'string') return JSON.parse(v)
      return v as EvolutionTrendRiskDeltaSummary
    },
    serialize: (v: unknown) => v,
  })
  declare riskDeltaJson: EvolutionTrendRiskDeltaSummary

  @column({
    prepare: (v: EvolutionTrendSourceHashComparison | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): EvolutionTrendSourceHashComparison => {
      if (!v) return { matched: [], changed: [], added: [], removed: [] }
      if (typeof v === 'string') return JSON.parse(v)
      return v as EvolutionTrendSourceHashComparison
    },
    serialize: (v: unknown) => v,
  })
  declare sourceHashesJson: EvolutionTrendSourceHashComparison

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizEvolutionTrendAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizEvolutionTrendAnalysisRun>
}
