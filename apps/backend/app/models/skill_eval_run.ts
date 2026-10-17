/**
 * v3-skill-eval-system —— SkillEvalRun Lucid Model（D9）。
 *
 * 组织级评测运行实体。JSON 列以 text 存。
 */
import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Organization from './organization.js'
import User from './user.js'
import CompilerSkill from './compiler_skill.js'
import type { BenchmarkInput, ActivationDecision } from '@aiproj/types'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class SkillEvalRun extends BaseModel {
  public static table = 'skill_eval_runs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare skillId: number

  @column()
  declare benchmarkSource: 'L3' | 'fixture'

  @column(jsonColumn)
  declare inputs: BenchmarkInput[] | null

  @column(jsonColumn)
  declare activationDecisions: ActivationDecision[] | null

  @column(jsonColumn)
  declare coverageHits: number[] | null

  @column()
  declare totalInputs: number

  @column()
  declare coverageRate: number

  @column()
  declare droppedConflictsCount: number

  @column()
  declare droppedDuplicatesCount: number

  @column()
  declare evidenceDigest: string

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
