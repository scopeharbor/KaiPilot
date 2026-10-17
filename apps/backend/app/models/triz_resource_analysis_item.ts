import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizResourceAnalysisRun from './triz_resource_analysis_run.js'
import type {
  ResourceKind,
  SystemScope,
  ResourceOrigin,
  AvailabilityLevel,
  UtilizationState,
  ResourceSourceRef,
  ResourceWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 资源分析资源快照模型（v3-triz-resource-analyzer §3.2）。
 *
 * 每条记录是一个资源快照条目——资源分类、可用性、利用状态与低敏来源引用。
 * 组织+项目双隔离；关联 run_id。
 */
export default class TrizResourceAnalysisItem extends BaseModel {
  static table = 'triz_resource_analysis_items'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare resourceKey: string

  @column()
  declare label: string

  @column()
  declare resourceKind: ResourceKind

  @column()
  declare systemScope: SystemScope

  @column()
  declare origin: ResourceOrigin

  @column()
  declare availability: AvailabilityLevel

  @column()
  declare utilizationState: UtilizationState

  @column()
  declare utilizationRate: number | null

  @column()
  declare accessibility: number | null

  @column()
  declare costRating: string | null

  @column()
  declare capacity: string | null

  @column({
    prepare: (v: ResourceSourceRef[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): ResourceSourceRef[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as ResourceSourceRef[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceRefsJson: ResourceSourceRef[]

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
    prepare: (v: ResourceWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): ResourceWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as ResourceWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare constraintCodesJson: ResourceWarningCode[]

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

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizResourceAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizResourceAnalysisRun>
}
