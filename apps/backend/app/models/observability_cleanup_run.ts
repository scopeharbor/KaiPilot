import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ObservabilityCleanupRun — 清理执行记录。
 *
 * 每次执行一条记录，run_key 保证幂等。
 * 低敏设计：只存计数、哈希和状态。
 */
export default class ObservabilityCleanupRun extends BaseModel {
  static table = 'observability_cleanup_runs'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'job_id' })
  declare jobId: number

  @column({ columnName: 'data_class' })
  declare dataClass: string

  @column({ columnName: 'run_key' })
  declare runKey: string

  @column()
  declare status: string

  @column({ columnName: 'records_eligible' })
  declare recordsEligible: number

  @column({ columnName: 'records_deleted' })
  declare recordsDeleted: number

  @column({ columnName: 'records_failed' })
  declare recordsFailed: number

  @column({ columnName: 'aggregates_created' })
  declare aggregatesCreated: number

  @column({ columnName: 'aggregate_failed' })
  declare aggregateFailed: boolean

  @column({ columnName: 'failure_reason' })
  declare failureReason: string | null

  @column({ columnName: 'started_at' })
  declare startedAt: Date

  @column({ columnName: 'completed_at' })
  declare completedAt: Date | null

  @column({ columnName: 'created_at' })
  declare createdAt: Date
}
