/**
 * v3-chart-gallery-data-foundation —— Requirement Model（W1.4）。
 *
 * 需求实体：支撑「业务需求 → 任务/工作包 → 验收标准 → 验证状态」RTM 追溯链路。
 *
 * - acceptanceCriteria：结构化验收条目 JSON `[{ id, statement, status }]`
 * - code 项目内唯一（REQ-001 风格）；软删除 + 组织隔离
 * - 与任务的关联经 requirement_tasks 双向外键表（hasMany RequirementTask）
 */
import { BaseModel, beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import RequirementTask from './requirement_task.js'
import User from './user.js'

/** 需求分类枚举 */
export type RequirementCategory = 'business' | 'user' | 'functional' | 'non_functional' | 'other'

/** 需求优先级枚举 */
export type RequirementPriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'

/** 需求状态枚举 */
export type RequirementStatus = 'draft' | 'approved' | 'in_progress' | 'completed' | 'cancelled'

/** 单项验收准则验证状态 */
export type AcceptanceCriterionStatus = 'pending' | 'passed' | 'failed'

/** 结构化验收条目 */
export interface AcceptanceCriterion {
  id: string
  statement: string
  status: AcceptanceCriterionStatus
}

const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class Requirement extends BaseModel {
  public static table = 'requirements'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** 项目内业务编号（如 REQ-001）。 */
  @column()
  declare code: string

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare category: RequirementCategory

  @column()
  declare priority: RequirementPriority

  @column()
  declare status: RequirementStatus

  /** 结构化验收条目数组（JSON）。 */
  @column(jsonColumn)
  declare acceptanceCriteria: AcceptanceCriterion[]

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

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>

  /** 需求-任务关联记录（RTM 矩阵联表入口）。 */
  @hasMany(() => RequirementTask, { foreignKey: 'requirementId' })
  declare requirementTasks: HasMany<typeof RequirementTask>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Requirement>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Requirement>) {
    query.whereNull('deleted_at')
  }
}
