import { MultiProjectDependencySchema } from '#database/schema'
import Organization from './organization.js'
import Project from './project.js'
import Milestone from './milestone.js'
import Task from './task.js'
import User from './user.js'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * 组织级跨项目依赖事实模型。
 * 独立于 task_dependencies，支持 project/milestone/task/external 四种端点类型。
 */
export default class MultiProjectDependency extends MultiProjectDependencySchema {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => Project, { foreignKey: 'providerProjectId' })
  declare providerProject: BelongsTo<typeof Project>

  @belongsTo(() => Milestone, { foreignKey: 'providerMilestoneId' })
  declare providerMilestone: BelongsTo<typeof Milestone>

  @belongsTo(() => Task, { foreignKey: 'providerTaskId' })
  declare providerTask: BelongsTo<typeof Task>

  @belongsTo(() => Project, { foreignKey: 'consumerProjectId' })
  declare consumerProject: BelongsTo<typeof Project>

  @belongsTo(() => Milestone, { foreignKey: 'consumerMilestoneId' })
  declare consumerMilestone: BelongsTo<typeof Milestone>

  @belongsTo(() => Task, { foreignKey: 'consumerTaskId' })
  declare consumerTask: BelongsTo<typeof Task>

  @belongsTo(() => User, { foreignKey: 'ownerUserId' })
  declare owner: BelongsTo<typeof User>
}
