import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import ResourceCapacityLoop from './resource_capacity_loop.js'

/** 执行后同口径观察快照：不可变追加；comparability=false 时观测值一律为空。 */
export default class ResourceCapacityObservationSnapshot extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'downstream_status' })
  declare downstreamStatus: string

  @column()
  declare comparable: boolean

  @column({
    columnName: 'comparability_reasons_json',
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare comparabilityReasonsJson: unknown[]

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare comparisonsJson: unknown[]

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare appliedItemRefsJson: unknown[]

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare failedItemRefsJson: unknown[]

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare unrelatedChangeNotesJson: unknown[]

  @column({ columnName: 'observation_digest' })
  declare observationDigest: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => ResourceCapacityLoop, { foreignKey: 'loopId' })
  declare loop: BelongsTo<typeof ResourceCapacityLoop>
}
