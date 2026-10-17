/**
 * v3-ai-quality-console-experiments-real —— AiShadowExperiment 模型。
 * 影子/AB 实验（control/variant 双侧配置 + 状态机 draft→running→paused→archived）。
 * 组织隔离：全部查询附加 organization_id 过滤。
 *
 * @aiproj/backend
 */

import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import AiShadowRun from './ai_shadow_run.js'

export default class AiShadowExperiment extends BaseModel {
  static table = 'ai_shadow_experiments'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column()
  declare name: string

  @column()
  declare capability: string

  @column({ columnName: 'control_prompt_version_id' })
  declare controlPromptVersionId: number | null

  @column({ columnName: 'control_model' })
  declare controlModel: string | null

  @column({ columnName: 'variant_prompt_version_id' })
  declare variantPromptVersionId: number | null

  @column({ columnName: 'variant_model' })
  declare variantModel: string | null

  /** 信息位（0-100）：规划中的变体流量占比；本期不做真实流量切分。 */
  @column({ columnName: 'traffic_percent' })
  declare trafficPercent: number

  /** draft | running | paused | archived */
  @column()
  declare status: string

  @column({ columnName: 'created_by' })
  declare createdBy: number | null

  @column.dateTime({ columnName: 'created_at' })
  declare createdAt: DateTime

  @column.dateTime({ columnName: 'updated_at' })
  declare updatedAt: DateTime | null

  @hasMany(() => AiShadowRun, { foreignKey: 'experimentId' })
  declare runs: HasMany<typeof AiShadowRun>
}
