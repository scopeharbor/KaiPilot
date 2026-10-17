import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-decision-intelligence-workbench —— pmo_decision_options（tasks 3.1）。
 *
 * 候选方案：每 case 2–5 个 active option 由服务层边界保证；假设/约束/
 * 受影响项目 refs 以有界 JSON 存储；revision 用于 review fingerprint 绑定。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_decision_options', (table) => {
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

      // ── Option identity ──
      table.string('label', 120).notNullable()
      table.json('assumptions').notNullable().defaultTo(JSON.stringify([]))
      table.json('constraints').notNullable().defaultTo(JSON.stringify([]))
      table.json('affected_project_refs').notNullable().defaultTo(JSON.stringify([]))
      table.string('proposed_outcome_category', 60).notNullable()
      table.json('evidence_refs').notNullable().defaultTo(JSON.stringify([]))
      table.integer('revision').notNullable().defaultTo(1)
      table.boolean('active').notNullable().defaultTo(true)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      table.index(['organization_id', 'case_id'])
      table.index(['organization_id', 'case_id', 'active'])
    })
  }

  async down() {
    this.schema.dropTable('pmo_decision_options')
  }
}
