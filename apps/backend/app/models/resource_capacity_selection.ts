import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import ResourceCapacityScenario from './resource_capacity_scenario.js'
import ResourceCapacitySimulationSnapshot from './resource_capacity_simulation_snapshot.js'

/** 人工选择：绑定 TOCTOU 摘要；fingerprint 组织内唯一承担重放防护。 */
export default class ResourceCapacitySelection extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'scenario_id' })
  declare scenarioId: number

  @column({ columnName: 'simulation_snapshot_id' })
  declare simulationSnapshotId: number

  @column({ columnName: 'selection_fingerprint' })
  declare selectionFingerprint: string

  @column({ columnName: 'bound_baseline_digest' })
  declare boundBaselineDigest: string

  @column({ columnName: 'bound_simulation_digest' })
  declare boundSimulationDigest: string

  @column({ columnName: 'bound_source_signatures_hash' })
  declare boundSourceSignaturesHash: string

  @column({ columnName: 'bound_permission_fingerprint' })
  declare boundPermissionFingerprint: string

  @column({ columnName: 'bound_loop_revision' })
  declare boundLoopRevision: number

  @column({ columnName: 'actor_user_id' })
  declare actorUserId: number

  @column({
    prepare: (value: unknown[]) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : []),
  })
  declare acknowledgedWarningsJson: unknown[]

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => ResourceCapacityScenario, { foreignKey: 'scenarioId' })
  declare scenario: BelongsTo<typeof ResourceCapacityScenario>

  @belongsTo(() => ResourceCapacitySimulationSnapshot, { foreignKey: 'simulationSnapshotId' })
  declare simulationSnapshot: BelongsTo<typeof ResourceCapacitySimulationSnapshot>
}
