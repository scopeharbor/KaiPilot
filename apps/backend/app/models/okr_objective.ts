import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import OkrCycle from './okr_cycle.js'
import OkrKeyResult from './okr_key_result.js'
import OkrAlignment from './okr_alignment.js'
import OkrEvidenceLink from './okr_evidence_link.js'

export default class OkrObjective extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare cycleId: number | null

  @column()
  declare projectId: number | null

  @column()
  declare ownerId: number | null

  @column()
  declare scope: string

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare status: string

  @column()
  declare weight: number

  @column()
  declare progress: number

  @column()
  declare confidence: string

  @column()
  declare startDate: string | null

  @column()
  declare endDate: string | null

  @column()
  declare metricVersion: string

  @column.dateTime()
  declare calculatedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  // 同上：外键属性是 cycleId，Lucid 默认会去找 okrCycleId 而报「column missing」
  @belongsTo(() => OkrCycle, { foreignKey: 'cycleId' })
  declare cycle: BelongsTo<typeof OkrCycle>

  @hasMany(() => OkrKeyResult, { foreignKey: 'objectiveId' })
  declare keyResults: HasMany<typeof OkrKeyResult>

  @hasMany(() => OkrAlignment, { foreignKey: 'childObjectiveId' })
  declare childAlignments: HasMany<typeof OkrAlignment>

  @hasMany(() => OkrAlignment, { foreignKey: 'parentObjectiveId' })
  declare parentAlignments: HasMany<typeof OkrAlignment>

  @hasMany(() => OkrEvidenceLink, { foreignKey: 'targetId' })
  declare evidenceLinks: HasMany<typeof OkrEvidenceLink>

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrObjective>) {
    // @ts-ignore
    if (!(query as unknown as { __withTrashed?: boolean }).__withTrashed) {
      query.whereNull('deleted_at')
    }
  }

  static queryWithTrashed() {
    const qb = this.query() as unknown as { __withTrashed: boolean } & ModelQueryBuilderContract<
      typeof OkrObjective
    >
    qb.__withTrashed = true
    return qb as unknown as ModelQueryBuilderContract<typeof OkrObjective>
  }

  static queryOnlyTrashed() {
    const qb = this.queryWithTrashed()
    qb.whereNotNull('deleted_at')
    return qb
  }
}
