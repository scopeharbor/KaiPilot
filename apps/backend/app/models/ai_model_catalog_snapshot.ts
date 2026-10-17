import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

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

export default class AiModelCatalogSnapshot extends BaseModel {
  public static table = 'ai_model_catalog_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare source: string

  @column()
  declare sourceUrl: string

  @column()
  declare sourceHash: string

  @column(jsonColumn)
  declare payload: Record<string, unknown>

  @column()
  declare providerCount: number

  @column()
  declare modelCount: number

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
