import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import type { AiModelCapability, AiModelTokenLimitSource } from '@aiproj/types'
import AiConnection from './ai_connection.js'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
  serialize: (v: unknown) => v ?? null,
}

export default class AiConnectionModel extends BaseModel {
  public static table = 'ai_connection_models'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare connectionId: number

  @column()
  declare organizationId: number

  @column()
  declare modelName: string

  @column()
  declare catalogProviderId: string | null

  @column()
  declare catalogModelId: string | null

  @column()
  declare pricingSnapshotId: number | null

  @column(jsonColumn)
  declare catalogMetadata: Record<string, unknown> | null

  @column()
  declare contextWindowTokens: number | null

  @column()
  declare maxInputTokens: number | null

  @column()
  declare maxOutputTokens: number | null

  @column()
  declare tokenLimitSource: AiModelTokenLimitSource | null

  @column(jsonColumn)
  declare capabilities: AiModelCapability[] | null

  @column()
  declare rpmLimit: number | null

  @column()
  declare tpmLimit: number | null

  @column()
  declare isActive: boolean

  @column.dateTime()
  declare lastTestedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => AiConnection, { foreignKey: 'connectionId' })
  declare connection: BelongsTo<typeof AiConnection>
}
