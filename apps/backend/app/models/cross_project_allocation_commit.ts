import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import CrossProjectAllocationDraft from './cross_project_allocation_draft.js'
import Organization from './organization.js'
import User from './user.js'

export default class CrossProjectAllocationCommit extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare draftId: number

  @column()
  declare organizationId: number

  @column()
  declare actorId: number

  @column({
    prepare: (value: number[]) => JSON.stringify(value),
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare visibleTargetProjectIds: number[]

  @column({
    prepare: (value: string[]) => JSON.stringify(value),
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare itemIds: string[]

  @column()
  declare previewHash: string

  @column()
  declare queryShapeHash: string | null

  @column({
    prepare: (value: unknown[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null),
  })
  declare warnings: unknown[] | null

  @column()
  declare idempotencyKeyHash: string

  @column()
  declare status: string

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null),
  })
  declare applyResult: Record<string, unknown> | null

  @column({
    prepare: (value: unknown[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null),
  })
  declare auditReferences: unknown[] | null

  @column.dateTime()
  declare confirmedAt: DateTime

  @column.dateTime()
  declare appliedAt: DateTime | null

  @belongsTo(() => CrossProjectAllocationDraft, { foreignKey: 'draftId' })
  declare draft: BelongsTo<typeof CrossProjectAllocationDraft>

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'actorId' })
  declare actor: BelongsTo<typeof User>
}
