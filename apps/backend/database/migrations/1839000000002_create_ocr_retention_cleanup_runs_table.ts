import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ocr_retention_cleanup_runs 表：V3 OCR 保留治理——清理执行记录。
 *
 * 每条记录代表一次 cleanup 执行（preview 阶段不写此表）。
 * run_key 保证幂等；preview_hash + policy_hash 保证可验证。
 * 低敏设计：只存计数、哈希和状态，不存被清理的文本或 provider payload。
 *
 * v3-ocr-result-persistence-and-retention §3.1
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_retention_cleanup_runs'

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

      // 幂等键
      table.string('run_key', 128).notNullable()

      // 状态
      table.string('status', 20).notNullable().defaultTo('completed')
      table.check("status IN ('previewed','completed','failed','stale_blocked')")

      // 可验证哈希
      table.string('preview_hash', 64).notNullable()
      table.string('policy_hash', 64).notNullable()

      // 计数摘要（低敏）
      table.integer('expired_count').unsigned().notNullable().defaultTo(0)
      table.integer('redacted_count').unsigned().notNullable().defaultTo(0)
      table.integer('purged_count').unsigned().notNullable().defaultTo(0)
      table.integer('tombstone_count').unsigned().notNullable().defaultTo(0)
      table.integer('blocked_count').unsigned().notNullable().defaultTo(0)

      // 操作人
      table
        .bigInteger('executed_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 失败原因（低敏）
      table.string('failure_reason', 500).nullable()

      // 时间戳
      table.timestamp('started_at').notNullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('created_at').notNullable()

      // 索引
      table.unique(['organization_id', 'project_id', 'run_key'], 'idx_ocrr_org_project_run_key')
      table.index(['organization_id', 'project_id', 'status'], 'idx_ocrr_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'preview_hash'],
        'idx_ocrr_org_project_preview_hash',
      )
      table.index(['started_at'], 'idx_ocrr_started_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
