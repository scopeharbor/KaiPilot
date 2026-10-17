import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  PmoRecommendationSource,
  PmoRecommendationStatus,
  PmoAiStatus,
  RecommendationActionType,
  RecommendationSeverity,
  PmoPriorityContext,
  PmoSourceSignal,
  RecommendationEvidenceRef,
  PmoRecommendationWarning,
  RecommendationAiMetadata,
} from '@aiproj/types'

/**
 * JSON 列读取：SQLite 返回字符串，PostgreSQL 的 json 列驱动已解析为对象。
 * 原先一律 `JSON.parse`，在 PG 上遇到对象会抛 `"[object Object]" is not valid JSON`，
 * 刷新推荐整条 500（开发库实测）。
 */
function consumeJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

function consumeNullableJson<T>(value: unknown): T | null {
  if (value === null || value === undefined || value === '') return null
  return consumeJson<T>(value)
}

/**
 * v3-pmo-ai-priority-recommendations — PmoAiPriorityRecommendation model.
 *
 * PMO 组织级推荐记录，复用项目级推荐的生命周期语义，
 * 但携带 PMO 特有的优先级上下文、来源信号和 AI 状态元数据。
 */
export default class PmoAiPriorityRecommendation extends BaseModel {
  static table = 'pmo_ai_priority_recommendations'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare sourceType: PmoRecommendationSource

  @column()
  declare sourceId: string

  @column()
  declare title: string

  @column()
  declare summary: string

  @column()
  declare suggestedAction: string | null

  @column()
  declare actionType: RecommendationActionType

  @column()
  declare severity: RecommendationSeverity

  @column({
    prepare: (value: PmoPriorityContext) => JSON.stringify(value),
    consume: (value: unknown) => consumeJson<PmoPriorityContext>(value),
  })
  declare priorityContext: PmoPriorityContext

  @column({
    prepare: (value: PmoSourceSignal[]) => JSON.stringify(value),
    consume: (value: unknown) => consumeJson<PmoSourceSignal[]>(value),
  })
  declare sourceSignals: PmoSourceSignal[]

  @column({
    prepare: (value: RecommendationEvidenceRef[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) => consumeNullableJson<RecommendationEvidenceRef[]>(value),
  })
  declare evidenceRefs: RecommendationEvidenceRef[] | null

  @column()
  declare status: PmoRecommendationStatus

  @column({
    prepare: (value: PmoRecommendationWarning[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) => consumeNullableJson<PmoRecommendationWarning[]>(value),
  })
  declare warnings: PmoRecommendationWarning[] | null

  @column({
    prepare: (value: RecommendationAiMetadata | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) => consumeNullableJson<RecommendationAiMetadata>(value),
  })
  declare aiMetadata: RecommendationAiMetadata | null

  @column()
  declare aiStatus: PmoAiStatus

  @column()
  declare dedupeKey: string

  @column()
  declare inputSignature: string

  @column()
  declare candidateVersion: string

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column()
  declare stale: boolean

  @column()
  declare staleReason: string | null

  @column.dateTime()
  declare snoozedUntil: DateTime | null

  @column()
  declare reviewReason: string | null

  @column()
  declare createdBy: number

  @column()
  declare handledBy: number | null

  @column.dateTime()
  declare handledAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // -----------------------------------------------------------------------
  // Scopes
  // -----------------------------------------------------------------------

  /** 组织隔离查询 helper。 */
  static scopeByOrg(query: any, organizationId: number) {
    return query.where('organization_id', organizationId)
  }

  /** 组合作用域：组织 + 项目。 */
  static scopeByOrgProject(query: any, organizationId: number, projectId: number) {
    return this.scopeByOrg(query, organizationId).where('project_id', projectId)
  }
}
