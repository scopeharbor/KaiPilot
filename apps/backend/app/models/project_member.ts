import { ProjectMemberSchema } from '#database/schema'
import Project from './project.js'
import ProjectRole from './project_role.js'
import User from './user.js'
import { belongsTo, hasOne } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasOne } from '@adonisjs/lucid/types/relations'

/**
 * 项目成员模型（基于自动生成的 ProjectMemberSchema 基类）。
 */
export default class ProjectMember extends ProjectMemberSchema {
  /**
   * 所属项目。
   */
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  /**
   * 对应用户。
   */
  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  /**
   * 项目角色。
   */
  @hasOne(() => ProjectRole, { foreignKey: 'id', localKey: 'projectRoleId' })
  declare projectRole: HasOne<typeof ProjectRole>
}
