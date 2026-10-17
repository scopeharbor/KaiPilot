import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import ResourceCapacityBaselineSnapshot from './resource_capacity_baseline_snapshot.js'

/** What-if 情景：封闭 overlay 数组 + 当前 baseline 绑定 + row_version 乐观锁。 */
export default class ResourceCapacityScenario extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'baseline_snapshot_id' })
  declare baselineSnapshotId: number

  @column()
  declare name: string

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare overlaysJson: unknown[]

  @column({ columnName: 'row_version' })
  declare rowVersion: number

  @column()
  declare active: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => ResourceCapacityBaselineSnapshot, { foreignKey: 'baselineSnapshotId' })
  declare baseline: BelongsTo<typeof ResourceCapacityBaselineSnapshot>
}
