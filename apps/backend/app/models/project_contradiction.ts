import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ChangeRequest from './change_request.js'
import User from './user.js'
import type {
  ContradictionType,
  ContradictionStatus,
  ContradictionSeverity,
  ContradictionRuleId,
  ProjectParameterKey,
  InventivePrincipleId,
  ContradictionEvidence,
  SuggestedPrinciple,
  ContradictionAiExplanation,
} from '@aiproj/types'

/**
 * TRIZ 矛盾记录模型（v2-triz-contradiction-model-foundation D5/D6）。
 *
 * technical 用 improving/worsening 参数对；physical 用 parameter + requirementA/B。
 * evidence/suggestedPrinciples/aiExplanation 为 JSON 列。组织 + 项目双隔离由查询 scope 强制。
 */
export default class ProjectContradiction extends BaseModel {
  static table = 'project_contradictions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** 记录稳定身份（确定性派生） */
  @column()
  declare key: string

  /** 逻辑矛盾去重键（同项目按 type+rule+参数对/对立要求合并） */
  @column()
  declare dedupeKey: string

  @column()
  declare type: ContradictionType

  @column()
  declare ruleId: ContradictionRuleId

  @column()
  declare ruleVersion: string

  @column()
  declare improvingParameterKey: ProjectParameterKey | null

  @column()
  declare worseningParameterKey: ProjectParameterKey | null

  @column()
  declare improvingDirection: string | null

  @column()
  declare worseningDirection: string | null

  @column()
  declare parameterKey: ProjectParameterKey | null

  @column()
  declare requirementA: string | null

  @column()
  declare requirementB: string | null

  @column()
  declare severity: ContradictionSeverity

  @column()
  declare confidence: number

  @column()
  declare title: string

  @column({
    prepare: (v: ContradictionEvidence[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): ContradictionEvidence[] => {
      if (!v) return []
      if (typeof v === 'string') {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? (parsed as ContradictionEvidence[]) : []
      }
      return Array.isArray(v) ? (v as ContradictionEvidence[]) : []
    },
    serialize: (v: unknown) => v,
  })
  declare evidence: ContradictionEvidence[]

  @column({
    prepare: (v: SuggestedPrinciple[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): SuggestedPrinciple[] => {
      if (!v) return []
      if (typeof v === 'string') {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? (parsed as SuggestedPrinciple[]) : []
      }
      return Array.isArray(v) ? (v as SuggestedPrinciple[]) : []
    },
    serialize: (v: unknown) => v,
  })
  declare suggestedPrinciples: SuggestedPrinciple[]

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string | null

  @column()
  declare status: ContradictionStatus

  @column({
    consume: (value: boolean | number) => Boolean(value),
  })
  declare stale: boolean

  @column()
  declare staleReason: string | null

  @column()
  declare relatedChangeRequestId: number | null

  @column()
  declare confirmedBy: number | null

  @column.dateTime()
  declare confirmedAt: DateTime | null

  @column()
  declare dismissedBy: number | null

  @column.dateTime()
  declare dismissedAt: DateTime | null

  @column()
  declare dismissReason: string | null

  @column({
    prepare: (v: ContradictionAiExplanation | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): ContradictionAiExplanation | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as ContradictionAiExplanation
      return v as ContradictionAiExplanation
    },
    serialize: (v: unknown) => v,
  })
  declare aiExplanation: ContradictionAiExplanation | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => ChangeRequest, { foreignKey: 'relatedChangeRequestId' })
  declare relatedChangeRequest: BelongsTo<typeof ChangeRequest>

  @belongsTo(() => User, { foreignKey: 'confirmedBy' })
  declare confirmer: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'dismissedBy' })
  declare dismissor: BelongsTo<typeof User>
}

/** 后端局部补类型：原理目录与参数目录的稳定 key 字面量（避免在模型层重复枚举）。 */
export type { InventivePrincipleId, ProjectParameterKey }
