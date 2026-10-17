/**
 * v3-ai-quality-console-experiments-real —— AiShadowRun 模型。
 * 影子实验单次对比运行记录（双侧输出摘要/时延/成本；低敏：不存完整输出）。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class AiShadowRun extends BaseModel {
  static table = 'ai_shadow_runs'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'experiment_id' })
  declare experimentId: number

  @column({ columnName: 'input_hash' })
  declare inputHash: string | null

  @column({ columnName: 'control_output_summary' })
  declare controlOutputSummary: string | null

  @column({ columnName: 'variant_output_summary' })
  declare variantOutputSummary: string | null

  @column({ columnName: 'control_latency_ms' })
  declare controlLatencyMs: number | null

  @column({ columnName: 'variant_latency_ms' })
  declare variantLatencyMs: number | null

  @column({ columnName: 'control_cost' })
  declare controlCost: number | null

  @column({ columnName: 'variant_cost' })
  declare variantCost: number | null

  @column({ columnName: 'dry_run' })
  declare dryRun: boolean

  @column.dateTime({ columnName: 'created_at' })
  declare createdAt: DateTime
}
