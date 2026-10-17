import { BaseModel } from '@adonisjs/lucid/orm'
import { column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import Organization from './organization.js'
import ResourceCapacitySelection from './resource_capacity_selection.js'

/**
 * 低敏 handoff receipt：闭环拥有 receipt，目标 draft/preview 由下游能力拥有。
 * 不保存 confirm/apply token；writesApplied 恒 false 由 Service 层保证。
 */
export default class ResourceCapacityHandoffReceipt extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column({ columnName: 'loop_id' })
  declare loopId: number

  @column({ columnName: 'selection_id' })
  declare selectionId: number

  /** 封闭三类目标（迁移 CHECK 约束）。 */
  @column()
  declare target: string

  /** 幂等键哈希（org+selectionFingerprint+target+key），组织内唯一。 */
  @column({ columnName: 'idempotency_hash' })
  declare idempotencyHash: string

  @column({ columnName: 'pending_ref_id' })
  declare pendingRefId: string | null

  /** 下游状态投影：confirmed_downstream ≠ loop applied。 */
  @column()
  declare status: string

  @column({ columnName: 'status_reason' })
  declare statusReason: string | null

  @column({ columnName: 'source_signatures_hash' })
  declare sourceSignaturesHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => ResourceCapacitySelection, { foreignKey: 'selectionId' })
  declare selection: BelongsTo<typeof ResourceCapacitySelection>
}
