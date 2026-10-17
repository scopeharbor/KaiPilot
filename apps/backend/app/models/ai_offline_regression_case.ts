/**
 * v3-ai-quality-console-experiments-real —— AiOfflineRegressionCase 模型。
 * 离线回归案例（expected_contains / expected_pattern 确定性评分规则）。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class AiOfflineRegressionCase extends BaseModel {
  static table = 'ai_offline_regression_cases'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'prompt_key' })
  declare promptKey: string

  @column({ columnName: 'case_key' })
  declare caseKey: string

  @column()
  declare input: string

  @column({ columnName: 'expected_contains' })
  declare expectedContains: string | null

  @column({ columnName: 'expected_pattern' })
  declare expectedPattern: string | null

  @column()
  declare enabled: boolean

  @column.dateTime({ columnName: 'created_at' })
  declare createdAt: DateTime

  @column.dateTime({ columnName: 'updated_at' })
  declare updatedAt: DateTime | null
}
