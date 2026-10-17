/**
 * v3-ai-quality-console-experiments-real —— AiPromptVersion 模型。
 * Prompt 版本注册表（同 promptKey 至多一个 active，由 PromptVersionService 事务保证）。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class AiPromptVersion extends BaseModel {
  static table = 'ai_prompt_versions'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column({ columnName: 'prompt_key' })
  declare promptKey: string

  @column()
  declare version: number

  @column()
  declare content: string

  /** draft | active | archived */
  @column()
  declare status: string

  @column()
  declare changelog: string | null

  @column({ columnName: 'created_by' })
  declare createdBy: number | null

  @column.dateTime({ columnName: 'created_at' })
  declare createdAt: DateTime

  @column.dateTime({ columnName: 'updated_at' })
  declare updatedAt: DateTime | null
}
