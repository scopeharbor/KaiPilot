/**
 * v3-skill-eval-system —— SkillEvalReport Lucid Model（D9）。
 *
 * 组织级质量评估报告实体。JSON 列以 text 存，应用层 prepare/consume 解析。
 * 所有查询强制附加 organization_id 过滤。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'
import CompilerSkill from './compiler_skill.js'
import type { DimensionScore, AiAssistAdvisory } from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class SkillEvalReport extends BaseModel {
  public static table = 'skill_eval_reports'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare skillId: number

  @column()
  declare score: number

  @column(jsonColumn)
  declare dimensionScores: DimensionScore[] | null

  @column(jsonColumn)
  declare issues: string[] | null

  @column(jsonColumn)
  declare aiAdvisory: AiAssistAdvisory | null

  @column()
  declare suggestedTransition: string | null

  @column()
  declare referenceTime: string

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => CompilerSkill, { foreignKey: 'skillId' })
  declare skill: BelongsTo<typeof CompilerSkill>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>
}
