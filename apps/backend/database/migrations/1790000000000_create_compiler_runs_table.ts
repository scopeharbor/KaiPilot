/**
 * v2-project-compiler-foundation —— CompilerRun 表（tasks 3.1）。
 *
 * 组织级隔离：organization_id 必填 + 可索引。
 * SQLite 兼容 + PG 兼容（JSON 列、无 SQLite 专有语法）。
 * 红线 1：本表只存编译运行态元数据，不存 V1 正式业务数据。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('compiler_runs', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('requested_by_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.string('status', 20).notNullable().defaultTo('pending')
      table.check(
        "status IN ('pending','running','paused','completed','failed','cancelled','needs_human_review')",
      )

      table.string('current_phase', 30).nullable()
      table.string('current_stage', 60).nullable()

      table.json('input').notNullable()
      table.json('error').nullable()

      table.timestamp('started_at').nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['requested_by_user_id'])
    })
  }

  async down() {
    this.schema.dropTable('compiler_runs')
  }
}
