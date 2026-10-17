import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-decision-intelligence-workbench —— pmo_decision_cases（tasks 3.1）。
 *
 * 决策议题：组织隔离的单一决策问题，闭集状态机（draft → collecting-evidence →
 * ready-for-review → under-review → decided|deferred|superseded），row revision
 * 乐观锁；supersession 双向 refs 由服务层事务写入。迁移只建表/索引，不改既有数据。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_decision_cases', (table) => {
      table.bigIncrements('id')

      // ── Tenant scope ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── Case identity & lifecycle ──
      table.string('title', 200).notNullable()
      table.string('decision_question', 500).notNullable()
      table.string('scope_summary', 300).notNullable().defaultTo('')
      table.bigInteger('owner_id').unsigned().notNullable()
      table.timestamp('due_date', { useTz: true }).nullable()
      table.string('status', 30).notNullable().defaultTo('draft')
      table.integer('revision').notNullable().defaultTo(1)

      // ── Supersession 双向 refs ──
      table.bigInteger('supersedes_case_id').unsigned().nullable()
      table.bigInteger('superseded_by_case_id').unsigned().nullable()

      // ── Actors ──
      table.bigInteger('created_by').unsigned().notNullable()
      table.bigInteger('updated_by').unsigned().notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // ── Queue query indexes：状态/owner/due 筛选与稳定排序 ──
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'owner_id'])
      table.index(['organization_id', 'due_date'])
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('pmo_decision_cases')
  }
}
