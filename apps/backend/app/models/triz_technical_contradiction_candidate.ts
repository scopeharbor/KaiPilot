import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizTechnicalContradictionAnalysisRun from './triz_technical_contradiction_analysis_run.js'
import User from './user.js'
import type {
  TechnicalCandidateStatus,
  ContradictionSeverity,
  ProjectParameterKey,
  TechnicalWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 技术矛盾候选快照模型（v3-triz-technical-contradiction-analyzer §3.3）。
 *
 * 组织+项目双隔离；只存低敏摘要、hash、refs。
 * 技术矛盾特有：improving/worsening 参数对 + 方向描述。
 * evidence_refs、principle_refs 等为 JSON 列。
 */
export default class TrizTechnicalContradictionCandidate extends BaseModel {
  static table = 'triz_technical_contradiction_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare candidateKey: string

  @column()
  declare ruleId: string

  @column()
  declare ruleVersion: string

  @column()
  declare status: TechnicalCandidateStatus

  @column()
  declare improvingParameterKey: ProjectParameterKey

  @column()
  declare worseningParameterKey: ProjectParameterKey

  @column()
  declare improvingDirection: string

  @column()
  declare worseningDirection: string

  @column()
  declare title: string

  @column()
  declare severity: ContradictionSeverity

  @column()
  declare confidence: number

  @column()
  declare impactScore: number

  @column({
    prepare: (
      v: Array<{ entityType: string; entityId: number; lowSensitiveTitle: string }> | null,
    ) => (v ? JSON.stringify(v) : '[]'),
    consume: (
      v: unknown,
    ): Array<{ entityType: string; entityId: number; lowSensitiveTitle: string }> => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as Array<{ entityType: string; entityId: number; lowSensitiveTitle: string }>
    },
    serialize: (v: unknown) => v,
  })
  declare evidenceRefsJson: Array<{
    entityType: string
    entityId: number
    lowSensitiveTitle: string
  }>

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare affectedScopeJson: string[]

  @column({
    prepare: (
      v: Array<{ principleId: string; name: string; relevance: number; advice: string }> | null,
    ) => (v ? JSON.stringify(v) : '[]'),
    consume: (
      v: unknown,
    ): Array<{ principleId: string; name: string; relevance: number; advice: string }> => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as Array<{ principleId: string; name: string; relevance: number; advice: string }>
    },
    serialize: (v: unknown) => v,
  })
  declare principleRefsJson: Array<{
    principleId: string
    name: string
    relevance: number
    advice: string
  }>

  @column()
  declare rationaleSummary: string

  @column({
    prepare: (v: TechnicalWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): TechnicalWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as TechnicalWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodesJson: TechnicalWarningCode[]

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

  @column()
  declare outputHash: string

  @column()
  declare aiExplanationRef: string | null

  @column()
  declare reviewedBy: number | null

  @column.dateTime()
  declare reviewedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizTechnicalContradictionAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizTechnicalContradictionAnalysisRun>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewer: BelongsTo<typeof User>
}
