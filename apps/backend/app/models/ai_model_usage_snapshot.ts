import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { AiModelContextLimitSnapshot, AiModelUsageTokenSnapshot } from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
  serialize: (v: unknown) => v ?? null,
}

export default class AiModelUsageSnapshot extends BaseModel {
  public static table = 'ai_model_usage_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare connectionId: number | null

  @column()
  declare connectionModelId: number | null

  @column()
  declare pricingSnapshotId: number | null

  @column()
  declare provider: string

  @column()
  declare model: string

  @column()
  declare catalogProviderId: string | null

  @column()
  declare catalogModelId: string | null

  @column(jsonColumn)
  declare usage: AiModelUsageTokenSnapshot | null

  @column(jsonColumn)
  declare contextLimits: AiModelContextLimitSnapshot | null

  @column()
  declare estimatedCost: number | null

  @column()
  declare currency: string

  @column()
  declare latencyMs: number | null

  @column()
  declare errorCategory: string | null

  @column.dateTime()
  declare occurredAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
