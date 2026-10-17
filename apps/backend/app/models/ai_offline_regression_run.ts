/**
 * v3-ai-quality-console-experiments-real —— AiOfflineRegressionRun 模型。
 * 离线回归运行记录（dry_run=true 为确定性样本演示，false 为真实网关调用）。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class AiOfflineRegressionRun extends BaseModel {
  static table = 'ai_offline_regression_runs'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'prompt_key' })
  declare promptKey: string

  @column({ columnName: 'prompt_version_id' })
  declare promptVersionId: number | null

  @column()
  declare model: string | null

  /** running | succeeded | failed */
  @column()
  declare status: string

  @column({ columnName: 'dry_run' })
  declare dryRun: boolean

  @column()
  declare total: number

  @column()
  declare passed: number

  @column()
  declare failed: number

  @column({ columnName: 'pass_rate' })
  declare passRate: number | null

  @column({ columnName: 'duration_ms' })
  declare durationMs: number | null

  @column({ columnName: 'created_by' })
  declare createdBy: number | null

  @column.dateTime({ columnName: 'created_at' })
  declare createdAt: DateTime
}
