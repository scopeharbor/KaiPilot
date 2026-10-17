import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-decision-intelligence-workbench —— pmo_decision_evidence_snapshots（tasks 3.1）。
 *
 * 不可变证据快照：完成后永不原地修改；canonical bounded payload + digest 去重
 * （相同语义可去重引用）；被 outcome 引用的 snapshot 在可追溯期内不可删除。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('pmo_decision_evidence_snapshots', (table) => {
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

      // ── Snapshot identity ──
      table.integer('snapshot_revision').notNullable()
      table.string('snapshot_hash', 32).notNullable()
      table.string('readiness', 20).notNullable()

      // ── Canonical bounded content ──
      table.json('payload').notNullable()
      table.json('source_states').notNullable().defaultTo(JSON.stringify([]))
      table.json('warning_codes').notNullable().defaultTo(JSON.stringify([]))
      table.boolean('truncated').notNullable().defaultTo(false)

      table.timestamp('collected_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()

      // ── Dedup & history indexes ──
      // （unique/index 自动名 76/79 字节，PG 63-byte 截断后撞名 → 显式短名，
      //   v3-docker-compose-runtime-foundation 第七轮审计）
      table.unique(['organization_id', 'case_id', 'snapshot_hash'], 'uq_pdes_org_case_hash')
      table.index(['organization_id', 'case_id', 'snapshot_revision'], 'idx_pdes_org_case_revision')
      table.index(['organization_id', 'collected_at'])
    })
  }

  async down() {
    this.schema.dropTable('pmo_decision_evidence_snapshots')
  }
}
