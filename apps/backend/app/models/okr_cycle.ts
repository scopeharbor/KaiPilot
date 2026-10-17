import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import OkrObjective from './okr_objective.js'

export default class OkrCycle extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare startDate: string

  @column()
  declare endDate: string

  @column()
  declare status: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @column.dateTime()
  declare deletedAt: DateTime | null

  // 列名是 cycle_id（属性 cycleId），不是 Lucid 默认推导的 okr_cycle_id，必须显式指定 foreignKey
  @hasMany(() => OkrObjective, { foreignKey: 'cycleId' })
  declare objectives: HasMany<typeof OkrObjective>

  @beforeFind()
  @beforeFetch()
  static excludeSoftDeleted(query: ModelQueryBuilderContract<typeof OkrCycle>) {
    // @ts-ignore
    if (!(query as unknown as { __withTrashed?: boolean }).__withTrashed) {
      query.whereNull('deleted_at')
    }
  }

  static queryWithTrashed() {
    const qb = this.query() as unknown as { __withTrashed: boolean } & ModelQueryBuilderContract<
      typeof OkrCycle
    >
    qb.__withTrashed = true
    return qb as unknown as ModelQueryBuilderContract<typeof OkrCycle>
  }

  static queryOnlyTrashed() {
    const qb = this.queryWithTrashed()
    qb.whereNotNull('deleted_at')
    return qb
  }
}
