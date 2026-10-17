import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ocr_retention_holds 表：V3 OCR 保留治理——管理 hold（封锁清理）。
 *
 * 每条记录代表一个作用于特定 OCR 结果 scope 的 hold。
 * hold 阻止 purge/redaction，但不改变数据可见性。
 * 低敏设计：只存 reason_code（枚举）和有限 note，不存候选文本或 provider payload。
 *
 * v3-ocr-result-persistence-and-retention §3.1
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_retention_holds'

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

      // 作用域
      table.string('scope_kind', 30).notNullable()
      table.check("scope_kind IN ('project','source','job','accepted_extraction')")
      table.string('scope_hash', 64).notNullable()

      // 低敏原因与说明
      table.string('reason_code', 30).notNullable()
      table.check(
        "reason_code IN ('review_in_progress','dispute_resolution','audit_request','administrative','other')",
      )
      table.string('note', 200).nullable()

      // 状态
      table.string('status', 20).notNullable().defaultTo('active')
      table.check("status IN ('active','released')")

      // 操作人
      table
        .bigInteger('set_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.bigInteger('released_by').unsigned().nullable()

      // 时间戳
      table.timestamp('set_at').notNullable()
      table.timestamp('released_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'status'], 'idx_ocrh_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'scope_kind', 'scope_hash'],
        'idx_ocrh_org_project_scope',
      )
      table.index(
        ['organization_id', 'project_id', 'status', 'scope_kind'],
        'idx_ocrh_org_project_status_scope',
      )
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
