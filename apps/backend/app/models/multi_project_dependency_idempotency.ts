import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class MultiProjectDependencyIdempotency extends BaseModel {
  static table = 'multi_project_dependency_idempotency'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare actorId: number

  @column()
  declare operation: string

  @column()
  declare idempotencyKeyHash: string

  @column()
  declare confirmationHash: string

  @column()
  declare previewId: string

  @column()
  declare dependencyId: string | null

  @column()
  declare originalResult: object | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
