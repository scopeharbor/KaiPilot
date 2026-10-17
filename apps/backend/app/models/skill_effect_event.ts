/**
 * v3-skill-eval-system —— SkillEffectEvent Lucid Model（D9）。
 *
 * 组织级效果事件实体。供 Skill 注入 Compiler Stage 的独立 change 调用。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import CompilerSkill from './compiler_skill.js'

export default class SkillEffectEvent extends BaseModel {
  public static table = 'skill_effect_events'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare skillId: number

  @column()
  declare runId: number | null

  @column()
  declare projectId: number | null

  @column()
  declare activatedAt: string

  @column()
  declare qualityScore: number | null

  @column()
  declare referenceTime: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => CompilerSkill, { foreignKey: 'skillId' })
  declare skill: BelongsTo<typeof CompilerSkill>
}
