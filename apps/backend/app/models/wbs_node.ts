import { WbsNodeSchema } from '#database/schema'
import Project from './project.js'
import Task from './task.js'
import { beforeFetch, beforeFind, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

/**
 * WBS 节点模型：以材质化路径保存项目级树结构。
 */
export default class WbsNode extends WbsNodeSchema {
  declare id: number // 与 schema 基类一致；显式声明便于阅读（见 database/schema_rules.ts）

  @column({
    prepare: (value: boolean) => (value ? 1 : 0),
    consume: (value: boolean | number) => Boolean(value),
  })
  declare isLeaf: boolean

  @column({
    prepare: (value: boolean) => (value ? 1 : 0),
    consume: (value: boolean | number) => Boolean(value),
  })
  declare collapsed: boolean

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => WbsNode, { foreignKey: 'parentId' })
  declare parent: BelongsTo<typeof WbsNode>

  @hasMany(() => WbsNode, { foreignKey: 'parentId' })
  declare children: HasMany<typeof WbsNode>

  @belongsTo(() => Task, { foreignKey: 'taskId' })
  declare task: BelongsTo<typeof Task>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof WbsNode>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof WbsNode>) {
    query.whereNull('deleted_at')
  }
}
