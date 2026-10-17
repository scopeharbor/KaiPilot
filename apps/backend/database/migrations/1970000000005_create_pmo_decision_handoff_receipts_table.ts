import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-decision-intelligence-workbench —— pmo_decision_handoff_receipts（tasks 3.1）。
 *
 * 受控 handoff 回执：闭集 target + 幂等键；同键同 payload 返回既有 receipt，
 * 同键异 payload 冲突拒绝；pending/failed 状态与重试由服务层管理。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_decision_handoff_receipts', (table) => {
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

      // ── Handoff identity ──
      table.string('target', 40).notNullable()
      table.string('idempotency_key', 32).notNullable()
      table.string('request_hash', 32).notNullable()
      table.string('result_hash', 32).nullable()

      // ── State ──
      table.string('status', 20).notNullable().defaultTo('pending')
      table.string('pending_target_ref', 200).nullable()
      table.string('fail_reason_code', 60).nullable()

      table.bigInteger('actor_id').unsigned().notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // ── Idempotency：组织 + case + target + 幂等键唯一 ──
      table.unique(['organization_id', 'case_id', 'target', 'idempotency_key'])
      table.index(['organization_id', 'case_id'])
      table.index(['organization_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable('pmo_decision_handoff_receipts')
  }
}
