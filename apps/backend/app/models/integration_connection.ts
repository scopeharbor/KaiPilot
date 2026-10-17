import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class IntegrationConnection extends BaseModel {
  static table = 'integration_connections'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare userId: number

  @column()
  declare provider: string

  @column()
  declare status: string

  @column()
  declare externalAccountId: string | null

  @column()
  declare externalAccountEmail: string | null

  @column({
    prepare: (value: string[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value) => {
      if (!value) return null
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
  declare scopesJson: string[] | null

  @column()
  declare accessTokenEncrypted: string | null

  @column()
  declare refreshTokenEncrypted: string | null

  @column()
  declare tokenType: string | null

  @column.dateTime()
  declare expiresAt: DateTime | null

  @column.dateTime()
  declare connectedAt: DateTime | null

  @column.dateTime()
  declare disconnectedAt: DateTime | null

  @column.dateTime()
  declare lastCheckedAt: DateTime | null

  @column()
  declare lastError: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
