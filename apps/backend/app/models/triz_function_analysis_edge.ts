import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizFunctionAnalysisRun from './triz_function_analysis_run.js'
import type { FunctionEdgeType, FunctionAnalysisWarningCode } from '@aiproj/types'

/**
 * TRIZ 功能分析功能边模型（v3-triz-function-analysis-diagram §3.3）。
 *
 * 组织+项目双隔离；edge_key 保证稳定引用。
 * evidence_refs/source_hashes/warning_codes 为 JSON 列。
 */
export default class TrizFunctionAnalysisEdge extends BaseModel {
  static table = 'triz_function_analysis_edges'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare edgeKey: string

  @column()
  declare fromNodeKey: string

  @column()
  declare toNodeKey: string

  @column()
  declare functionType: FunctionEdgeType

  @column()
  declare label: string

  @column()
  declare strength: number

  @column()
  declare confidence: number

  @column({
    prepare: (
      v: Array<{
        sourceType: string
        sourceId: number
        lowSensitiveTitle: string
        hash: string
      }> | null,
    ) => (v ? JSON.stringify(v) : '[]'),
    consume: (
      v: unknown,
    ): Array<{ sourceType: string; sourceId: number; lowSensitiveTitle: string; hash: string }> => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as Array<{
        sourceType: string
        sourceId: number
        lowSensitiveTitle: string
        hash: string
      }>
    },
    serialize: (v: unknown) => v,
  })
  declare evidenceRefsJson: Array<{
    sourceType: string
    sourceId: number
    lowSensitiveTitle: string
    hash: string
  }>

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
    prepare: (v: FunctionAnalysisWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): FunctionAnalysisWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as FunctionAnalysisWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodesJson: FunctionAnalysisWarningCode[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizFunctionAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizFunctionAnalysisRun>
}
