/**
 * v3-chart-gallery-data-foundation —— ProjectStakeholder Model（W1.4）。
 *
 * 利害关系人登记表实体：登记内部 / 外部干系人并评估权力、利益、态度与应对策略，
 * 支撑权力-利益四象限聚合视图（manage_closely / keep_satisfied /
 * keep_informed / monitor）。
 *
 * - user 可选绑定（内部用户），外部人员为 NULL——干系人不强绑登录用户
 * - contactInfo 联系方式 JSON（邮箱 / 电话 / IM 等），默认 '{}'
 */
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'

/** 干系人内外属性 */
export type StakeholderType = 'internal' | 'external'

/** 权力 / 利益评估档位 */
export type StakeholderLevel = 'low' | 'medium' | 'high'

/** 干系人态度 */
export type StakeholderAttitude = 'supportive' | 'neutral' | 'resistant' | 'leading'

/** 权力-利益应对策略（四象限桶） */
export type StakeholderStrategy = 'manage_closely' | 'keep_satisfied' | 'keep_informed' | 'monitor'

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class ProjectStakeholder extends BaseModel {
  public static table = 'project_stakeholders'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** 可选的内部用户绑定（外部干系人为 NULL）。 */
  @column()
  declare userId: number | null

  @column()
  declare name: string

  @column()
  declare organizationName: string | null

  @column()
  declare roleTitle: string | null

  @column()
  declare stakeholderType: StakeholderType

  @column()
  declare powerLevel: StakeholderLevel

  @column()
  declare interestLevel: StakeholderLevel

  @column()
  declare attitude: StakeholderAttitude

  @column()
  declare expectations: string | null

  @column()
  declare managementStrategy: StakeholderStrategy

  /** 联系方式 JSON（邮箱 / 电话 / IM 等）。 */
  @column(jsonColumn)
  declare contactInfo: Record<string, string> | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── 关联 ──
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  /** 可选的内部用户（外部干系人为 null）。 */
  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof ProjectStakeholder>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof ProjectStakeholder>) {
    query.whereNull('deleted_at')
  }
}
