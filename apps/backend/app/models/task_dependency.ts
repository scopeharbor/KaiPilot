import { TaskDependencySchema } from '#database/schema'
import Task from './task.js'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/** 任务间有向依赖；关联关系按设计物理删除，不使用软删除。 */
export default class TaskDependency extends TaskDependencySchema {
  @belongsTo(() => Task, { foreignKey: 'predecessorId' })
  declare predecessor: BelongsTo<typeof Task>

  @belongsTo(() => Task, { foreignKey: 'successorId' })
  declare successor: BelongsTo<typeof Task>
}
