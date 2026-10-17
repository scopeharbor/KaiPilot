import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ObservabilityAggregate — 观察数据聚合固化记录。
 *
 * D2：过期前先落聚合再删明细。聚合记录按月/按类别固化，
 * 保留历史趋势而收缩敏感面。
 * aggregate_hash 确定性保证同一快照产出同一聚合。
 */
export default class ObservabilityAggregate extends BaseModel {
  static table = 'observability_aggregates'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'data_class' })
  declare dataClass: string

  @column()
  declare tier: string

  @column({ columnName: 'period_start' })
  declare periodStart: Date

  @column({ columnName: 'period_end' })
  declare periodEnd: Date

  @column({ columnName: 'record_count' })
  declare recordCount: number

  @column({ columnName: 'aggregate_hash' })
  declare aggregateHash: string

  @column({ columnName: 'prohibited_fields_json' })
  declare prohibitedFieldsJson: string

  @column({ columnName: 'materialized_at' })
  declare materializedAt: Date

  @column({ columnName: 'created_at' })
  declare createdAt: Date
}
