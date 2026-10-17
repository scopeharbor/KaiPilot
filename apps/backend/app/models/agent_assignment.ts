/**
 * Agent 分配记录模型（v3-copilot-agent-as-assignee）。
 *
 * 记录 AI Agent 被分配执行任务的生命周期：pending → completed / overdue / failed。
 * 不携带 prompt/modelOutput/token/secret 等敏感数据。
 *
 * 关系：
 * - task：被分配的任务
 * - project：所属项目
 * - organization：所属组织
 * - assignedBy：分配操作者（真人用户）
 * - draft：关联的 AI 草案（完成时可选关联）
 */

import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Task from './task.js'
import Project from './project.js'
import Organization from './organization.js'
import User from './user.js'

export default class AgentAssignment extends BaseModel {
  static table = 'agent_assignments'

  @column({ isPrimary: true })
  declare id: number

  /** 被分配的任务 ID */
  @column()
  declare taskId: number

  /** 所属项目 ID */
  @column()
  declare projectId: number

  /** 所属组织 ID */
  @column()
  declare organizationId: number

  /** 负责人类型（user | agent） */
  @column()
  declare assigneeType: string

  /** 分配操作者（真人用户 ID） */
  @column()
  declare assignedBy: number

  /** 截止时间 */
  @column.dateTime({ serializeAs: null })
  declare dueTime: DateTime

  /** 分配状态：pending / completed / overdue / failed */
  @column()
  declare status: string

  /** 关联的草案 ID（完成时可选） */
  @column()
  declare draftId: number | null

  /** 备注 */
  @column()
  declare notes: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ---------------------------------------------------------------------------
  // 关系
  // ---------------------------------------------------------------------------

  /** 被分配的任务 */
  @belongsTo(() => Task, { foreignKey: 'taskId' })
  declare task: BelongsTo<typeof Task>

  /** 所属项目 */
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  /** 所属组织 */
  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  /** 分配操作者 */
  @belongsTo(() => User, { foreignKey: 'assignedBy' })
  declare assigner: BelongsTo<typeof User>
}
