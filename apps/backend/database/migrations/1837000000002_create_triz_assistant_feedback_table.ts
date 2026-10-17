import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_assistant_feedback 表：AI-TRIZ 助手反馈记录
 * （v3-ai-triz-assistant §3.1–§3.3）。
 *
 * 只存低敏反馈原因和评论，不存完整 prompt/model output。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_assistant_feedback'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('feedback_id', 64).notNullable().unique()
      table.string('run_id', 64).notNullable()
      table.string('message_id', 64).notNullable()

      table.string('reason', 32).notNullable()
      table.check(
        "reason IN ('helpful','not_helpful','incorrect_route','missing_context','outdated','other')",
      )

      table.string('comment', 1024).nullable()

      table.timestamp('created_at').notNullable()

      // 索引（taf = triz assistant feedback）
      table.index(['run_id'], 'idx_taf_run_id')
      table.index(['organization_id', 'run_id'], 'idx_taf_org_run')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
