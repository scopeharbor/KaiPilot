import { DateTime } from 'luxon'
import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import ProjectRecommendationEvent from './project_recommendation_event.js'
import type {
  RecommendationSource,
  RecommendationStatus,
  RecommendationSeverity,
  RecommendationConfidence,
  RecommendationActionType,
  RecommendationTargetRef,
  RecommendationEvidenceRef,
  RecommendationWarning,
  RecommendationAiMetadata,
} from '@aiproj/types'

/**
 * v2-ai-smart-recommendations — ProjectRecommendation model.
 */
export default class ProjectRecommendation extends BaseModel {
  static table = 'project_recommendations'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare sourceType: RecommendationSource

  @column()
  declare sourceId: string

  @column({
    prepare: (value: RecommendationTargetRef) => JSON.stringify(value),
    // SQLite 返回字符串；PostgreSQL 的 json 列驱动已解析，无条件 JSON.parse 会抛错。
    consume: (value: unknown) =>
      (typeof value === 'string' ? JSON.parse(value) : value) as RecommendationTargetRef,
  })
  declare targetRef: RecommendationTargetRef

  @column()
  declare title: string

  @column()
  declare summary: string

  @column()
  declare recommendedAction: string | null

  @column()
  declare actionType: RecommendationActionType

  @column()
  declare severity: RecommendationSeverity

  @column()
  declare priority: number

  @column()
  declare confidence: RecommendationConfidence

  @column()
  declare dedupeKey: string

  @column()
  declare inputSignature: string

  @column()
  declare evidenceHash: string

  @column({
    prepare: (value: RecommendationEvidenceRef[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      (typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null)) as
        RecommendationEvidenceRef[] | null,
  })
  declare evidenceRefs: RecommendationEvidenceRef[] | null

  @column()
  declare status: RecommendationStatus

  @column({
    prepare: (value: RecommendationWarning[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      (typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null)) as
        RecommendationWarning[] | null,
  })
  declare warnings: RecommendationWarning[] | null

  @column({
    prepare: (value: RecommendationAiMetadata | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      (typeof value === 'string'
        ? value
          ? JSON.parse(value)
          : null
        : (value ?? null)) as RecommendationAiMetadata | null,
  })
  declare aiMetadata: RecommendationAiMetadata | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column()
  declare stale: boolean

  @column()
  declare staleReason: string | null

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

  @hasMany(() => ProjectRecommendationEvent, { foreignKey: 'recommendationId' })
  declare events: HasMany<typeof ProjectRecommendationEvent>

  /** 组织隔离查询 helper */
  static scopeByOrg(query: any, organizationId: number) {
    return query.where('organization_id', organizationId)
  }

  /** 项目作用域 + 组织隔离 */
  static scopeByProject(query: any, organizationId: number, projectId: number) {
    return this.scopeByOrg(query, organizationId).where('project_id', projectId)
  }
}
