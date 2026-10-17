import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ObservabilityCleanupJob — 清理作业状态。
 *
 * D5：清理作业失败必须可见并可查。
 * 每个组织+数据类别一条记录，记录最近执行状态。
 */
export default class ObservabilityCleanupJob extends BaseModel {
  static table = 'observability_cleanup_jobs'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'data_class' })
  declare dataClass: string

  @column()
  declare status: string

  @column({ columnName: 'last_run_at' })
  declare lastRunAt: Date | null

  @column({ columnName: 'last_run_duration_ms' })
  declare lastRunDurationMs: number | null

  @column({ columnName: 'records_processed_total' })
  declare recordsProcessedTotal: number

  @column({ columnName: 'records_failed_total' })
  declare recordsFailedTotal: number

  @column({ columnName: 'consecutive_failures' })
  declare consecutiveFailures: number

  @column({ columnName: 'last_failure_reason' })
  declare lastFailureReason: string | null

  @column({ columnName: 'created_at' })
  declare createdAt: Date

  @column({ columnName: 'updated_at' })
  declare updatedAt: Date | null
}
