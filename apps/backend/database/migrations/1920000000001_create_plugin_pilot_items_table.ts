import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-plugin-action-preview-boundary —— pilot fixture domain 表。
 *
 * 唯一由核心 pilot adapter（action kind = plugin.pilot.item.create）在确认后写入的
 * 正式表。选择专用低风险 fixture domain 而非复用 PM 主域，保证：
 * - 「正式表全景 zero-diff」断言只允许本表在 confirm 后变化；
 * - 事务回滚 / 审计失败回滚的演示不触碰真实项目数据。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_pilot_items', (table) => {
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
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('SET NULL')

      table.string('title', 200).notNullable()
      table.text('content').notNullable()

      // ── Provenance（来源提案；低敏 ref）──
      table.string('source_proposal_uid', 80).nullable()
      table.index(['organization_id', 'source_proposal_uid'])

      table.integer('created_by').unsigned().nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable('plugin_pilot_items')
  }
}
