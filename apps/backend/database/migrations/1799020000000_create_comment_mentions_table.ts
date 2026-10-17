import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-collaboration-comments-mentions —— 评论提及读模型。
 *
 * 每个被提及用户在每条评论中只记录一次（应用层去重）。
 * 冗余 organization_id/project_id 便于强制租户过滤和与我有关筛选。
 *
 * 索引策略：
 * - mentioned_user_id + organization_id → 与我有关查询
 * - comment_id → 评论详情时预加载
 * - mentioned_user_id + comment_id → 唯一约束（去重兜底）
 * - project_id → 项目级活动查询
 */
export default class extends BaseSchema {
  protected tableName = 'comment_mentions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离（冗余）
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 项目上下文（冗余，加速筛选）
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 所属评论
      table
        .bigInteger('comment_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('comments')
        .onDelete('CASCADE')

      // 被提及用户
      table
        .bigInteger('mentioned_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 创建人（@操作者）
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      // 唯一约束：同一评论中同一用户只记录一次
      table.unique(['mentioned_user_id', 'comment_id'], {
        indexName: 'comment_mentions_user_comment_unique',
        // SQLite 不支持 predicate unique，pg 可额外加 WHERE deleted_at IS NULL
      })

      // 索引
      table.index(['mentioned_user_id', 'organization_id'], 'comment_mentions_user_org_index')
      table.index(['comment_id'], 'comment_mentions_comment_id_index')
      table.index(['project_id'], 'comment_mentions_project_id_index')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
