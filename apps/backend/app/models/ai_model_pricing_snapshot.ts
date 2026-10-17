import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { AiModelCatalogCost, AiModelCatalogLimit } from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
  serialize: (v: unknown) => v ?? null,
}

const booleanColumn = {
  prepare: (v: unknown) => Boolean(v),
  consume: (v: unknown) => Boolean(v),
  serialize: (v: unknown) => Boolean(v),
}

export default class AiModelPricingSnapshot extends BaseModel {
  public static table = 'ai_model_pricing_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare snapshotKey: string

  @column()
  declare source: string

  @column()
  declare sourceHash: string

  @column()
  declare providerId: string

  @column()
  declare providerName: string

  @column()
  declare modelId: string

  @column()
  declare modelName: string

  @column()
  declare currency: string

  @column()
  declare pricingUnit: string

  @column(jsonColumn)
  declare cost: AiModelCatalogCost | null

  @column(jsonColumn)
  declare limits: AiModelCatalogLimit | null

  @column(jsonColumn)
  declare modalities: { input: string[]; output: string[] } | null

  @column(jsonColumn)
  declare rawProvider: Record<string, unknown> | null

  @column(jsonColumn)
  declare rawModel: Record<string, unknown> | null

  @column.dateTime()
  declare fetchedAt: DateTime

  @column.dateTime()
  declare expiresAt: DateTime

  @column(booleanColumn)
  declare stale: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
