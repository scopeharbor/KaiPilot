import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import CrossProjectAllocationDraft from './cross_project_allocation_draft.js'
import Organization from './organization.js'
import Project from './project.js'
import Task from './task.js'
import Resource from './resource.js'

export default class CrossProjectAllocationItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare draftId: number

  @column()
  declare organizationId: number

  @column()
  declare itemType: string

  @column()
  declare itemStatus: string

  @column()
  declare targetProjectId: number

  @column()
  declare targetTaskId: number | null

  @column()
  declare candidateResourceId: number | null

  @column({
    prepare: (value: Record<string, unknown>) => JSON.stringify(value),
    consume: (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare demandSnapshot: Record<string, unknown>

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null),
  })
  declare candidateSnapshot: Record<string, unknown> | null

  @column()
  declare allocationPercent: number

  @column.date()
  declare startDate: DateTime

  @column.date()
  declare endDate: DateTime

  @column({
    prepare: (value: unknown[] | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null),
  })
  declare conflicts: unknown[] | null

  @column()
  declare source: string

  @column()
  declare advisoryOnly: number

  @column()
  declare confirmationRequired: number

  @column()
  declare applied: number

  @column()
  declare sourceSignature: string | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: unknown) =>
      typeof value === 'string' ? (value ? JSON.parse(value) : null) : (value ?? null),
  })
  declare redactionState: Record<string, unknown> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => CrossProjectAllocationDraft, { foreignKey: 'draftId' })
  declare draft: BelongsTo<typeof CrossProjectAllocationDraft>

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => Project, { foreignKey: 'targetProjectId' })
  declare targetProject: BelongsTo<typeof Project>

  @belongsTo(() => Task, { foreignKey: 'targetTaskId' })
  declare targetTask: BelongsTo<typeof Task>

  @belongsTo(() => Resource, { foreignKey: 'candidateResourceId' })
  declare candidateResource: BelongsTo<typeof Resource>
}
