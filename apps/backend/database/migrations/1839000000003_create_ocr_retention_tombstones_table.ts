import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * ocr_retention_tombstones 表：V3 OCR 保留治理——低敏 tombstone（清理后的可追溯痕迹）。
 *
 * 被 purge 的 OCR 记录在此留下低敏痕迹。
 * 每条 tombstone 只存组织/项目/记录身份/哈希/清理原因/策略快照/时间，
 * 不存完整 OCR 文本、provider body、prompt、secret 或绝对路径。
 *
 * v3-ocr-result-persistence-and-retention §3.1
 */
export default class extends BaseSchema {
  protected tableName = 'ocr_retention_tombstones'

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

      // 原始记录身份
      table.string('record_kind', 30).notNullable()
      table.bigInteger('record_id').unsigned().notNullable()

      // 低敏来源标识
      table.string('source_kind', 30).nullable()
      table.string('source_hash', 64).nullable()
      table.string('content_hash', 64).nullable()

      // 清理动作与原因
      table.string('lifecycle_action', 20).notNullable()
      table.string('cleanup_reason', 200).notNullable()

      // 策略快照
      table.string('policy_hash', 64).notNullable()

      // tombstone 自身哈希（确定性）
      table.string('tombstone_hash', 64).notNullable()

      // 关联清理运行
      table.bigInteger('cleanup_run_id').unsigned().nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()

      // 索引
      table.index(['organization_id', 'project_id'], 'idx_ocrt_org_project')
      table.index(
        ['organization_id', 'project_id', 'record_kind', 'record_id'],
        'idx_ocrt_org_project_record',
      )
      table.index(['source_hash'], 'idx_ocrt_source_hash')
      table.index(['cleanup_run_id'], 'idx_ocrt_cleanup_run')
      table.index(['tombstone_hash'], 'idx_ocrt_tombstone_hash')
      table.index(['created_at'], 'idx_ocrt_created_at')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
