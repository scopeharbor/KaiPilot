import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import OkrCascadePlan from './okr_cascade_plan.js'
import OkrObjective from './okr_objective.js'

export default class OkrCascadePlanItem extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare planId: number

  @column()
  declare organizationId: number

  @column()
  declare candidateObjective: string // JSON: OkrAiDraftObjective

  @column()
  declare status: string // pending / confirmed / rejected / skipped

  @column()
  declare coverageGap: boolean

  @column()
  declare conflictWarning: string | null

  @column()
  declare rejectionReason: string | null

  @column()
  declare confirmedObjectiveId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => OkrCascadePlan, { foreignKey: 'planId' })
  declare plan: BelongsTo<typeof OkrCascadePlan>

  @belongsTo(() => OkrObjective, { foreignKey: 'confirmedObjectiveId' })
  declare confirmedObjective: BelongsTo<typeof OkrObjective>
}
