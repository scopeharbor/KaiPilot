import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizFunctionAnalysisRun from './triz_function_analysis_run.js'
import type {
  ComponentNodeType,
  ComponentScope,
  NodeStatus,
  FunctionAnalysisWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 功能分析组件节点模型（v3-triz-function-analysis-diagram §3.3）。
 *
 * 组织+项目双隔离；node_key 保证稳定引用。
 * source_refs/source_hashes/metrics/position/warning_codes 为 JSON 列。
 */
export default class TrizFunctionAnalysisNode extends BaseModel {
  static table = 'triz_function_analysis_nodes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare nodeKey: string

  @column()
  declare label: string

  @column()
  declare componentType: ComponentNodeType

  @column()
  declare scope: ComponentScope

  @column()
  declare nodeStatus: NodeStatus

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
  declare sourceRefsJson: Array<{
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
    prepare: (v: { inDegree: number; outDegree: number; totalWeight: number } | null) =>
      v ? JSON.stringify(v) : '{}',
    consume: (v: unknown): { inDegree: number; outDegree: number; totalWeight: number } => {
      if (!v) return { inDegree: 0, outDegree: 0, totalWeight: 0 }
      if (typeof v === 'string') return JSON.parse(v)
      return v as { inDegree: number; outDegree: number; totalWeight: number }
    },
    serialize: (v: unknown) => v,
  })
  declare metricsJson: { inDegree: number; outDegree: number; totalWeight: number }

  @column({
    prepare: (v: { x: number; y: number } | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): { x: number; y: number } | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as { x: number; y: number }
    },
    serialize: (v: unknown) => v,
  })
  declare positionJson: { x: number; y: number } | null

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
