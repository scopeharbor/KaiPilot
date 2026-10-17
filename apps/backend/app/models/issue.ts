/**
 * v3-chart-gallery-data-foundation —— Issue Model（W1.4）。
 *
 * 议题与缺陷追踪实体：缺陷 / 阻塞 / 技术债 / 流程问题的闭环管理载体，
 * 同时是质量控制图与帕累托分析（issue_type / issue_severity）的数据源。
 *
 * - 状态机：open → in_progress → resolved / closed / rejected；
 *   resolved 需回填 root_cause / resolution（服务层守卫）并打 resolved_at
 * - reportedBy 为登记人（RESTRICT），assignee 为处理人（可空）
 * - code 项目内唯一（如 ISS-001）；软删除 + 组织隔离
 */
import { BaseModel, beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import Task from './task.js'
import User from './user.js'

/** 议题分类枚举 */
export type IssueType = 'bug' | 'blocker' | 'technical' | 'process' | 'other'

/** 四级严重度枚举 */
export type IssueSeverity = 'critical' | 'major' | 'minor' | 'trivial'

/** 议题优先级枚举 */
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low'

/** 议题状态机枚举 */
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected'

export default class Issue extends BaseModel {
  public static table = 'issues'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** 关联任务（任务删除后置空）。 */
  @column()
  declare relatedTaskId: number | null

  /** 登记人（物理删除受限）。 */
  @column()
  declare reportedBy: number

  /** 处理人（可空）。 */
  @column()
  declare assigneeId: number | null

  /** 项目内业务编号（如 ISS-001）。 */
  @column()
  declare code: string

  @column()
  declare title: string

  @column()
  declare description: string | null

  @column()
  declare type: IssueType

  @column()
  declare severity: IssueSeverity

  @column()
  declare priority: IssuePriority

  @column()
  declare status: IssueStatus

  /** 根本原因分析（resolve 时服务层强制回填）。 */
  @column()
  declare rootCause: string | null

  /** 解决方案与措施。 */
  @column()
  declare resolution: string | null

  @column.dateTime()
  declare resolvedAt: DateTime | null

  @column.dateTime()
  declare closedAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── 关联 ──
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => Task, { foreignKey: 'relatedTaskId' })
  declare relatedTask: BelongsTo<typeof Task>

  @belongsTo(() => User, { foreignKey: 'reportedBy' })
  declare reporter: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'assigneeId' })
  declare assignee: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof Issue>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof Issue>) {
    query.whereNull('deleted_at')
  }
}
