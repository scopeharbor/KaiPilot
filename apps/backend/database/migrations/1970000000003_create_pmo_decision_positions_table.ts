import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-decision-intelligence-workbench —— pmo_decision_positions（tasks 3.1）。
 *
 * 参与者立场：stance + 有界 note（≤500 字符）；审计只保存 note hash/预览摘要，
 * 不复制正文；case 决定后 position 不可篡改（服务层保证）。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_decision_positions', (table) => {
      table.bigIncrements('id')

      // ── Tenant scope & parent chain ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('case_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('pmo_decision_cases')
        .onDelete('CASCADE')
      table.bigInteger('participant_id').unsigned().notNullable()

      // ── Position identity ──
      table.string('stance', 20).notNullable()
      table.string('note', 500).nullable()
      table.string('note_hash', 32).nullable()
      table.integer('revision').notNullable().defaultTo(1)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // ── 一人一 case 一条有效立场 ──
      table.unique(['organization_id', 'case_id', 'participant_id'])
      table.index(['organization_id', 'case_id'])
    })
  }

  async down() {
    this.schema.dropTable('pmo_decision_positions')
  }
}
