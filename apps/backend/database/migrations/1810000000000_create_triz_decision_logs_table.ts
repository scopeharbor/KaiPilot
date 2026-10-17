import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_decision_logs 表：V2 TRIZ 决策日志（v2-triz-decision-log-traceability §2.1 P0）。
 *
 * 用于结构化记录 TRIZ 采纳、驳回、部分采纳、修改后采纳、请求补充说明和废止等人工决策。
 * 追加式——更正通过 supersedes_decision_log_id 链式引用旧记录。
 * 只存低敏摘要、hash、refs，不完整 prompt/输出/证据。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_decision_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // ── 组织/项目归属（双隔离） ──────────────────────────────
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

      // ── 决策类型与状态 ──────────────────────────────────────
      table.string('decision_type', 30).notNullable()
      table.check(
        "decision_type IN ('adopt','reject','partial_accept','modified_accept','clarification_requested','supersede')",
      )
      table.string('decision_status', 20).notNullable().defaultTo('active')
      table.check("decision_status IN ('active','superseded','archived')")

      // ── 决策主题 refs JSON ──────────────────────────────────
      table.json('subject_refs').notNullable().defaultTo('[]')
      // 来源 refs JSON（adopt/partial/modified 决策必需）
      table.json('source_refs').notNullable().defaultTo('[]')
      // artifact hashes JSON
      table.json('artifact_hashes').notNullable().defaultTo('[]')

      // ── 低敏理由 ────────────────────────────────────────────
      table.text('reason_summary').notNullable().defaultTo('')
      table.string('reason_hash', 64).notNullable()
      table.text('alternative_summary').nullable()

      // ── 追加式修订 ──────────────────────────────────────────
      table
        .bigInteger('supersedes_decision_log_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('triz_decision_logs')
        .onDelete('SET NULL')

      // ── 决策人 ──────────────────────────────────────────────
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // ── 时间戳 ──────────────────────────────────────────────
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // ── 索引 ────────────────────────────────────────────────
      table.index(
        ['organization_id', 'project_id', 'decision_status'],
        'idx_tdl_org_project_status',
      )
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_tdl_org_project_created')
      table.index(['created_by'], 'idx_tdl_created_by')
      table.index(['supersedes_decision_log_id'], 'idx_tdl_supersedes')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
