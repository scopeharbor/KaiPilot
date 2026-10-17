import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import ResourceCapacityObservationSnapshot from './resource_capacity_observation_snapshot.js'

/** 人工复核结论：每个 observation snapshot 至多一条 review（组织内唯一）。 */
export default class ResourceCapacityReview extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'observation_snapshot_id' })
  declare observationSnapshotId: number

  /** goal_met / partially_met / not_met / invalidated（迁移 CHECK 约束）。 */
  @column()
  declare outcome: string

  /** 有界结论 ≤500 字符；入库前过审计低敏扫描。 */
  @column({ columnName: 'bounded_rationale' })
  declare boundedRationale: string

  @column({ columnName: 'actor_user_id' })
  declare actorUserId: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => ResourceCapacityObservationSnapshot, { foreignKey: 'observationSnapshotId' })
  declare observationSnapshot: BelongsTo<typeof ResourceCapacityObservationSnapshot>
}
