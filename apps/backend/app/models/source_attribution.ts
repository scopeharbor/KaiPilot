/**
 * v2-traceability-source-attribution —— SourceAttribution Model（task 2.1）。
 *
 * 组织隔离：forOrganization helper 自动附加 organization_id。
 * 只存可审查摘要和 refs，不存完整 artifact payload。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class SourceAttribution extends BaseModel {
  public static table = 'source_attributions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare compilerRunId: number

  @column()
  declare draftSessionId: number | null

  @column()
  declare stageId: string

  @column()
  declare stageAttemptId: string | null

  @column()
  declare entityId: string | null

  @column()
  declare fieldPath: string | null

  @column(jsonColumn)
  declare sourceRefs: Array<{
    refId: string
    artifactKind: string
    version: number
    summaryLevel: string
    label?: string
    organizationId: number
    compilerRunId?: number
    stageId?: string
  }>

  @column(jsonColumn)
  declare validationRefs: Array<{
    refId: string
    artifactKind: string
    version: number
    summaryLevel: string
    label?: string
    organizationId: number
  }>

  // ── 生成方式 ──
  @column()
  declare generatedByKind: string

  @column()
  declare generatedByProvider: string | null

  @column()
  declare generatedByModel: string | null

  @column(jsonColumn)
  declare tokenSummary: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null

  @column(jsonColumn)
  declare costSummary: { currency?: string; estimatedCost?: number } | null

  @column()
  declare ruleId: string | null

  @column()
  declare ruleName: string | null

  // ── 摘要与置信度 ──
  @column()
  declare summary: string

  @column()
  declare confidence: number

  @column(jsonColumn)
  declare assumptions: string[]

  @column(jsonColumn)
  declare evidenceSnippets: Array<{
    refId: string
    label?: string
    snippet: string
    charOffset?: number
    charLength?: number
    contentHash?: string
  }>

  @column()
  declare contentHash: string

  // ── 人工确认 ──
  @column()
  declare humanReviewStatus: string

  @column()
  declare humanReviewedBy: number | null

  @column.dateTime()
  declare humanReviewedAt: DateTime | null

  // ── Unanchored ──
  @column()
  declare unanchored: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  /** 组织隔离查询 helper。 */
  static forOrganization(orgId: number) {
    return this.query().where('organization_id', orgId)
  }

  /** 按 compiler run 查询。 */
  static forCompilerRun(orgId: number, runId: number) {
    return this.forOrganization(orgId).where('compiler_run_id', runId)
  }

  /** 按实体查询。 */
  static forEntity(orgId: number, entityId: string) {
    return this.forOrganization(orgId).where('entity_id', entityId)
  }
}
