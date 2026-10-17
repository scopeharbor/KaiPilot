/**
 * v2-context-compiler-artifact-store —— CompilerArtifact Model（tasks 2.1/2.3）。
 *
 * 组织隔离：所有查询经 organization_id 过滤。
 * 支持按 kind/version 查询最新的 artifact 快照。
 * 新增 kind: contract, context_packet, model_output, validation_feedback, artifact_summary
 * 新增 envelope 字段: artifactId, content_hash, idempotency_key, summary_level
 */
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import CompilerRun from './compiler_run.js'

export type ArtifactKind =
  | 'contract'
  | 'pdm'
  | 'manifest'
  | 'ledger'
  | 'stage_output'
  | 'checkpoint'
  | 'context_packet'
  | 'model_output'
  | 'validation_feedback'
  | 'artifact_summary'
  // v2-compiler-observability-cost-controls 新增
  | 'observability_event'
  | 'cost_event'
  | 'budget_decision'
  | 'budget_policy'
  // v2-triz-compiler-analysis-layer
  | 'triz_analysis_artifact'
  // v2-triz-ai-clarification-cards
  | 'triz_clarification_artifact'
  // v3-skill-compiler-integration
  | 'skill_activation_decision'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export type ArtifactPayload = Record<string, unknown>

export default class CompilerArtifact extends BaseModel {
  public static table = 'compiler_artifacts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare compilerRunId: number

  @column()
  declare organizationId: number

  @column()
  declare kind: ArtifactKind

  @column()
  declare stageId: string | null

  @column({ columnName: 'artifactId' })
  declare artifactId: string | null

  @column()
  declare version: number

  @column()
  declare contentHash: string | null

  @column()
  declare idempotencyKey: string | null

  @column()
  declare summaryLevel: string | null

  @column(jsonColumn)
  declare payload: ArtifactPayload

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => CompilerRun, { foreignKey: 'compilerRunId' })
  declare run: BelongsTo<typeof CompilerRun>

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }

  /** 查询某 kind 的最新 version。 */
  static latestForKind(runId: number, kind: string) {
    return this.query()
      .where('compiler_run_id', runId)
      .where('kind', kind)
      .orderBy('version', 'desc')
      .first()
  }

  /**
   * 按 idempotency key 查询。
   */
  static byIdempotencyKey(runId: number, key: string) {
    return this.query().where('compiler_run_id', runId).where('idempotency_key', key).first()
  }

  /**
   * 按 artifactId 查询指定 version。
   */
  static byArtifactId(runId: number, orgId: number, artifactId: string, version: number) {
    return this.query()
      .where('compiler_run_id', runId)
      .where('organization_id', orgId)
      .where('artifactId', artifactId)
      .where('version', version)
      .first()
  }
}
