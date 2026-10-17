/**
 * v3-ai-quality-cost-console-deferred-p1 —— AiSloThreshold 模型。
 *
 * 组织级 AI SLO 告警阈值持久化（每组织每指标一行，双档同行）。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class AiSloThreshold extends BaseModel {
  static table = 'ai_slo_thresholds'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column()
  declare indicator: string

  @column({ columnName: 'warning_operator' })
  declare warningOperator: string

  @column({ columnName: 'warning_value' })
  declare warningValue: number

  @column({ columnName: 'warning_unit' })
  declare warningUnit: string

  @column({ columnName: 'critical_operator' })
  declare criticalOperator: string

  @column({ columnName: 'critical_value' })
  declare criticalValue: number

  @column({ columnName: 'critical_unit' })
  declare criticalUnit: string

  @column({ columnName: 'window_ms' })
  declare windowMs: number

  @column({ columnName: 'runbook_ref' })
  declare runbookRef: string

  @column({ columnName: 'threshold_source' })
  declare thresholdSource: string

  @column({ columnName: 'created_at' })
  declare createdAt: Date

  @column({ columnName: 'updated_at' })
  declare updatedAt: Date
}
