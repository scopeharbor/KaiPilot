import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-decision-intelligence-workbench —— pmo_decision_outcomes（tasks 3.1）。
 *
 * 人工结论：五类动作（approve/reject/defer/request-more-evidence/supersede）；
 * 绑定 selected option、snapshot hash、review fingerprint 与 outcome digest；
 * rationale 正文仅存本业务表（长度有界），审计只保存 digest/hash/状态。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_decision_outcomes', (table) => {
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

      // ── Outcome identity ──
      table.string('action', 30).notNullable()
      table.bigInteger('selected_option_id').unsigned().nullable()
      table.bigInteger('superseded_by_case_id').unsigned().nullable()

      // ── Review binding（TOCTOU 门）──
      table.string('snapshot_hash', 32).notNullable()
      table.string('review_fingerprint', 32).notNullable()
      table.string('outcome_digest', 32).notNullable()

      // ── Human rationale（业务表内保留，不进审计）──
      table.string('rationale', 2000).nullable()
      table.json('acknowledged_warnings').notNullable().defaultTo(JSON.stringify([]))

      table.bigInteger('actor_id').unsigned().notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // ── 同一 case 的幂等结论：同一 outcome digest 只允许一条 ──
      table.unique(['organization_id', 'case_id', 'outcome_digest'])
      table.index(['organization_id', 'case_id'])
      table.index(['organization_id', 'actor_id'])
    })
  }

  async down() {
    this.schema.dropTable('pmo_decision_outcomes')
  }
}
