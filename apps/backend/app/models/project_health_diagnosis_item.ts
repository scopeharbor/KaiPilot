import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ProjectHealthDiagnosis from './project_health_diagnosis.js'
import type { HealthDimension, HealthSeverity, HealthRuleId } from '@aiproj/types'

/**
 * 健康诊断维度信号明细（v2-ai-project-health-diagnosis D1）。
 * 每条记录对应一个维度的信号条目。
 */
export default class ProjectHealthDiagnosisItem extends BaseModel {
  static table = 'project_health_diagnosis_items'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare diagnosisId: number

  @column()
  declare dimension: HealthDimension

  @column()
  declare ruleId: HealthRuleId

  @column()
  declare severity: HealthSeverity

  @column()
  declare scoreImpact: number

  @column()
  declare evidence: string | null

  @column()
  declare sourceType: string | null

  @column()
  declare sourceId: number | null

  @column()
  declare suggestedAction: string | null

  @column()
  declare requiresReview: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @belongsTo(() => ProjectHealthDiagnosis, { foreignKey: 'diagnosisId' })
  declare diagnosis: BelongsTo<typeof ProjectHealthDiagnosis>
}
