import { ProjectRoleSchema } from '#database/schema'
import Project from './project.js'
import ProjectMember from './project_member.js'
import { belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/**
 * 项目角色模型（基于自动生成的 ProjectRoleSchema 基类）。
 *
 * `permissions` 为 JSON 数组列：Lucid 不自动序列化，用 prepare/consume 做
 * 对象 ↔ JSON 字符串 marshalling（否则 SQLite 绑定数组会报错，且读回时无法 Array.isArray 判定）。
 */
export default class ProjectRole extends ProjectRoleSchema {
  /**
   * 所属项目。
   */
  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  /**
   * 拥有该角色的成员列表。
   */
  @hasMany(() => ProjectMember, { foreignKey: 'projectRoleId' })
  declare members: HasMany<typeof ProjectMember>

  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })
  declare permissions: string[] | null
}
