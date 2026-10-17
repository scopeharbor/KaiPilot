import { MultiProjectDependencyPreviewSchema } from '#database/schema'
import MultiProjectDependency from './multi_project_dependency.js'
import Organization from './organization.js'
import User from './user.js'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * 跨项目依赖预览快照模型。
 * 支持创建/更新/归档/恢复操作的预览/确认流程。
 */
export default class MultiProjectDependencyPreview extends MultiProjectDependencyPreviewSchema {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => MultiProjectDependency, { foreignKey: 'dependencyId' })
  declare dependency: BelongsTo<typeof MultiProjectDependency>

  @belongsTo(() => User, { foreignKey: 'actorUserId' })
  declare actor: BelongsTo<typeof User>
}
