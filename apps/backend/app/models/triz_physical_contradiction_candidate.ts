import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizPhysicalContradictionAnalysisRun from './triz_physical_contradiction_analysis_run.js'
import User from './user.js'
import type {
  PhysicalCandidateStatus,
  PhysicalRuleId,
  SeparationAxis,
  ContradictionSeverity,
  ProjectParameterKey,
  PhysicalWarningCode,
  PhysicalCandidateRequirement,
} from '@aiproj/types'

/**
 * TRIZ 物理矛盾候选快照模型（v3-triz-physical-contradiction-analyzer §3.3）。
 *
 * 组织+项目双隔离；只存低敏摘要、hash、refs。
 * requirement_a/b、evidence_refs、principle_refs 等为 JSON 列。
 */
export default class TrizPhysicalContradictionCandidate extends BaseModel {
  static table = 'triz_physical_contradiction_candidates'

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
  declare ruleId: PhysicalRuleId

  @column()
  declare ruleVersion: string

  @column()
  declare status: PhysicalCandidateStatus

  @column()
  declare parameterKey: ProjectParameterKey

  @column({
    prepare: (v: PhysicalCandidateRequirement | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): PhysicalCandidateRequirement => {
      if (!v) return { summary: '', context: '', conditionRefs: [] }
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhysicalCandidateRequirement
    },
    serialize: (v: unknown) => v,
  })
  declare requirementAJson: PhysicalCandidateRequirement

  @column({
    prepare: (v: PhysicalCandidateRequirement | null) => (v ? JSON.stringify(v) : '{}'),
    consume: (v: unknown): PhysicalCandidateRequirement => {
      if (!v) return { summary: '', context: '', conditionRefs: [] }
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhysicalCandidateRequirement
    },
    serialize: (v: unknown) => v,
  })
  declare requirementBJson: PhysicalCandidateRequirement

  @column()
  declare separationAxis: SeparationAxis

  @column()
  declare contextA: string

  @column()
  declare contextB: string

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare conditionRefsJson: string[]

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
      v: Array<{ principleKey: string; name: string; relevance: number; advice: string }> | null,
    ) => (v ? JSON.stringify(v) : '[]'),
    consume: (
      v: unknown,
    ): Array<{ principleKey: string; name: string; relevance: number; advice: string }> => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as Array<{ principleKey: string; name: string; relevance: number; advice: string }>
    },
    serialize: (v: unknown) => v,
  })
  declare principleRefsJson: Array<{
    principleKey: string
    name: string
    relevance: number
    advice: string
  }>

  @column()
  declare rationaleSummary: string

  @column({
    prepare: (v: PhysicalWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): PhysicalWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as PhysicalWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodesJson: PhysicalWarningCode[]

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
  @belongsTo(() => TrizPhysicalContradictionAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizPhysicalContradictionAnalysisRun>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewer: BelongsTo<typeof User>
}
