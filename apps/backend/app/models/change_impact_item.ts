import { BaseModel, column } from '@adonisjs/lucid/orm'
import {
  type ChangeImpactDimension,
  type ChangeImpactSeverity,
  type PropagationPathEntry,
  type ImpactRuleId,
} from '@aiproj/types'

/**
 * 影响分析受影响项明细模型（v2-change-management-impact-analysis D1）。
 * 每条对应一个受影响实体及其传播路径、严重度评分。
 */
export default class ChangeImpactItem extends BaseModel {
  static table = 'change_impact_items'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare analysisId: number

  @column()
  declare entityType: string

  @column()
  declare entityId: number

  @column()
  declare dimension: ChangeImpactDimension

  @column()
  declare severity: ChangeImpactSeverity

  @column()
  declare score: number

  @column({
    prepare: (v: PropagationPathEntry[] | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): PropagationPathEntry[] | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as PropagationPathEntry[]
      return v as PropagationPathEntry[]
    },
    serialize: (v: unknown) => v,
  })
  declare propagationPath: PropagationPathEntry[] | null

  @column()
  declare depth: number

  @column()
  declare ruleId: ImpactRuleId

  @column()
  declare evidence: string | null

  @column()
  declare requiresReview: boolean

  @column()
  declare isVisible: boolean
}
