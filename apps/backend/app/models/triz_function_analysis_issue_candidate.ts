import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import TrizFunctionAnalysisRun from './triz_function_analysis_run.js'
import User from './user.js'
import type {
  FunctionIssueType,
  FunctionIssueSeverity,
  FunctionIssueCandidateStatus,
  FunctionAnalysisWarningCode,
} from '@aiproj/types'

/**
 * TRIZ 功能分析问题候选模型（v3-triz-function-analysis-diagram §3.3）。
 *
 * 组织+项目双隔离；issue_key 保证稳定引用。
 * node_refs/edge_refs/suggested_actions/source_hashes/warning_codes 为 JSON 列。
 */
export default class TrizFunctionAnalysisIssueCandidate extends BaseModel {
  static table = 'triz_function_analysis_issue_candidates'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare runId: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare issueKey: string

  @column()
  declare issueType: FunctionIssueType

  @column()
  declare severity: FunctionIssueSeverity

  @column()
  declare confidence: number

  @column()
  declare impactScore: number

  @column()
  declare candidateStatus: FunctionIssueCandidateStatus

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare nodeRefsJson: string[]

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare edgeRefsJson: string[]

  @column()
  declare rationaleSummary: string

  @column({
    prepare: (v: Array<{ action: string; rationale: string; confidence: number }> | null) =>
      v ? JSON.stringify(v) : '[]',
    consume: (v: unknown): Array<{ action: string; rationale: string; confidence: number }> => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as Array<{ action: string; rationale: string; confidence: number }>
    },
    serialize: (v: unknown) => v,
  })
  declare suggestedActionsJson: Array<{ action: string; rationale: string; confidence: number }>

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
  declare aiExplanationRef: string | null

  @column()
  declare reviewedBy: number | null

  @column.dateTime()
  declare reviewedAt: DateTime | null

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

  @column()
  declare outputHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => TrizFunctionAnalysisRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof TrizFunctionAnalysisRun>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewer: BelongsTo<typeof User>
}
