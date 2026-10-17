import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import ResourceCapacityLoop from './resource_capacity_loop.js'

/** 不可变 canonical baseline 快照：只追加、不改写；superseded 走 supersededById 链。 */
export default class ResourceCapacityBaselineSnapshot extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'schema_version' })
  declare schemaVersion: string

  @column({
    prepare: (value: Record<string, unknown>) => JSON.stringify(value),
    consume: (value: string) => (value ? JSON.parse(value) : null),
  })
  declare packetJson: Record<string, unknown>

  @column({ columnName: 'baseline_digest' })
  declare baselineDigest: string

  @column({ columnName: 'permission_fingerprint' })
  declare permissionFingerprint: string

  @column({ columnName: 'source_signatures_hash' })
  declare sourceSignaturesHash: string

  @column({ columnName: 'ready_for_simulation' })
  declare readyForSimulation: boolean

  @column({ columnName: 'superseded_by_id' })
  declare supersededById: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => ResourceCapacityLoop, { foreignKey: 'loopId' })
  declare loop: BelongsTo<typeof ResourceCapacityLoop>
}
