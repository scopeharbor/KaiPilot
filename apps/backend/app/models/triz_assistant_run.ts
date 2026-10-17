import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import TrizAssistantMessage from './triz_assistant_message.js'
import type {
  AiTrizAssistantRunStatus,
  AiTrizAssistantRouteDecision,
  AiTrizAssistantRecommendedAction,
  AiTrizAssistantClarificationPrompt,
  AiTrizAssistantWarningCode,
  AiTrizAssistantCostSummary,
} from '@aiproj/types'

/**
 * AI-TRIZ 助手会话运行模型（v3-ai-triz-assistant §3.2）。
 *
 * 组织+项目双隔离；idempotency_key 保证幂等。
 * 只存低敏摘要/refs/hashes/warning/cost/fallback/review 元数据。
 */
export default class TrizAssistantRun extends BaseModel {
  static table = 'triz_assistant_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare runId: string

  @column()
  declare status: AiTrizAssistantRunStatus

  @column()
  declare intent: string

  @column()
  declare intentSummary: string

  @column({
    prepare: (v: AiTrizAssistantRouteDecision[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): AiTrizAssistantRouteDecision[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as AiTrizAssistantRouteDecision[]
    },
    serialize: (v: unknown) => v,
  })
  declare routeDecisionsJson: AiTrizAssistantRouteDecision[]

  @column({
    prepare: (v: AiTrizAssistantRecommendedAction[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): AiTrizAssistantRecommendedAction[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as AiTrizAssistantRecommendedAction[]
    },
    serialize: (v: unknown) => v,
  })
  declare recommendedActionsJson: AiTrizAssistantRecommendedAction[]

  @column({
    prepare: (v: AiTrizAssistantClarificationPrompt[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): AiTrizAssistantClarificationPrompt[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as AiTrizAssistantClarificationPrompt[]
    },
    serialize: (v: unknown) => v,
  })
  declare clarificationPromptsJson: AiTrizAssistantClarificationPrompt[]

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string | null

  @column()
  declare idempotencyKey: string

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceRefsJson: string[]

  @column({
    prepare: (v: string[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): string[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as string[]
    },
    serialize: (v: unknown) => v,
  })
  declare sourceHashPrefixesJson: string[]

  @column({
    prepare: (v: AiTrizAssistantWarningCode[] | null) => (v ? JSON.stringify(v) : '[]'),
    consume: (v: unknown): AiTrizAssistantWarningCode[] => {
      if (!v) return []
      if (typeof v === 'string') return JSON.parse(v)
      return v as AiTrizAssistantWarningCode[]
    },
    serialize: (v: unknown) => v,
  })
  declare warningCodesJson: AiTrizAssistantWarningCode[]

  @column({
    prepare: (v: AiTrizAssistantCostSummary | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): AiTrizAssistantCostSummary | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v)
      return v as AiTrizAssistantCostSummary
    },
    serialize: (v: unknown) => v,
  })
  declare costSummaryJson: AiTrizAssistantCostSummary | null

  @column()
  declare isFallback: boolean

  @column()
  declare degradedReason: string | null

  @column()
  declare reviewRequired: boolean

  @column()
  declare messageCount: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  // 关系
  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>

  @hasMany(() => TrizAssistantMessage, { foreignKey: 'runDbId' })
  declare messages: HasMany<typeof TrizAssistantMessage>
}
