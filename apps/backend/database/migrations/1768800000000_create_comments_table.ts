import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * comments 表：通用评论系统，多实体类型 + 嵌套回复（sec7.2.3）。
 * - entity_type 枚举六种评论对象（多态，无严格外键）
 * - parent_id 自引用实现一级嵌套回复（SET NULL，保留被回复评论）
 * - project_id → projects ON DELETE CASCADE（项目级评论列表）
 * 软删除（sec7.5，保留评论占位显示「已删除」）。
 */
export default class extends BaseSchema {
  protected tableName = 'comments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 多态关联（V1 basic-comments 改用 task_id，entity_type/entity_id 保留但可空）
      table.string('entity_type', 30).nullable()
      table.bigInteger('entity_id').unsigned().nullable()

      // 项目上下文（加速项目级评论列表查询）
      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 评论作者
      table
        .bigInteger('author_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 自引用嵌套回复
      table
        .bigInteger('parent_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('comments')
        .onDelete('SET NULL')

      // 富文本结构化内容
      table.json('content_json').nullable()
      table.text('content').nullable()
      // 内部评论（仅项目成员可见，区分对客 / 对内）
      table.boolean('is_internal').notNullable().defaultTo(false)
      // 编辑时间（NULL 表示从未编辑）
      table.timestamp('edited_at').nullable()

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：实体评论查询、项目评论列表（sec7.5）
      table.index(['entity_type', 'entity_id'])
      table.index(['project_id'])
      table.index(['parent_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
