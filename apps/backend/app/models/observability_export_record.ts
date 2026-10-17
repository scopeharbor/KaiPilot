import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ObservabilityExportRecord — 导出记录。
 *
 * D8：导出只导出该组织自己的数据，且导出本身要审计。
 */
export default class ObservabilityExportRecord extends BaseModel {
  static table = 'observability_export_records'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'requested_by' })
  declare requestedBy: number

  @column({ columnName: 'data_classes_json' })
  declare dataClassesJson: string

  @column({ columnName: 'record_count' })
  declare recordCount: number

  @column({ columnName: 'export_format' })
  declare exportFormat: string

  @column({ columnName: 'export_hash' })
  declare exportHash: string

  @column({ columnName: 'exported_at' })
  declare exportedAt: Date

  @column({ columnName: 'created_at' })
  declare createdAt: Date
}
