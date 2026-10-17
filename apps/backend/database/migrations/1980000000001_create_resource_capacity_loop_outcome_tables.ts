import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-resource-capacity-forecasting-closed-loop（任务 3.3）
 *
 * 新增 selections / handoff receipts / observation snapshots / reviews。
 * 红线：
 * - selection fingerprint 与 handoff idempotency hash 唯一约束承担幂等/重放防护；
 * - receipt 不保存下游 confirm/apply 句柄，只有低敏 pending ref 与状态投影；
 * - observation/review 为不可变追加。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('resource_capacity_selections', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')
      table
        .bigInteger('scenario_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_scenarios')
        .onDelete('RESTRICT')
      table
        .bigInteger('simulation_snapshot_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_simulation_snapshots')
        .onDelete('RESTRICT')

      // ── TOCTOU 绑定摘要 ──
      table.string('selection_fingerprint', 64).notNullable()
      table.string('bound_baseline_digest', 64).notNullable()
      table.string('bound_simulation_digest', 64).notNullable()
      table.string('bound_source_signatures_hash', 64).notNullable()
      table.string('bound_permission_fingerprint', 64).notNullable()
      table.integer('bound_loop_revision').notNullable()

      table
        .bigInteger('actor_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table.text('acknowledged_warnings_json', 'longtext').notNullable().defaultTo('[]')
      table.timestamp('expires_at', { useTz: true }).notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()

      // 指纹唯一：同组织内重放返回原记录而非新建。
      table.unique(['organization_id', 'selection_fingerprint'])
      table.index(['organization_id', 'loop_id', 'created_at'])
    })

    this.schema.createTable('resource_capacity_handoff_receipts', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')
      table
        .bigInteger('selection_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_selections')
        .onDelete('RESTRICT')

      table.string('target', 60).notNullable()
      table.check(
        "target IN ('cross-project-allocation-draft','project-resource-suggestion-preview','safe-navigation')",
      )
      // 幂等键哈希（org+fingerprint+target+key），原文不入库。
      table.string('idempotency_hash', 64).notNullable()
      table.string('pending_ref_id', 120).nullable()
      table.string('status', 30).notNullable().defaultTo('pending')
      table.check(
        "status IN ('pending','previewed','confirmed_downstream','applied_downstream','partial','failed','cancelled','expired')",
      )
      table.string('status_reason', 200).nullable()
      table.string('source_signatures_hash', 64).notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      table.unique(['organization_id', 'idempotency_hash'])
      table.index(['organization_id', 'loop_id', 'created_at'])
      table.index(['organization_id', 'selection_id'])
    })

    this.schema.createTable('resource_capacity_observation_snapshots', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')

      table.string('downstream_status', 30).notNullable()
      table.check(
        "downstream_status IN ('pending','previewed','confirmed_downstream','applied_downstream','partial','failed','cancelled','expired')",
      )
      table.boolean('comparable').notNullable()
      table.text('comparability_reasons_json', 'longtext').notNullable().defaultTo('[]')
      table.text('comparisons_json', 'longtext').notNullable()
      table.text('applied_item_refs_json', 'longtext').notNullable().defaultTo('[]')
      table.text('failed_item_refs_json', 'longtext').notNullable().defaultTo('[]')
      table.text('unrelated_change_notes_json', 'longtext').notNullable().defaultTo('[]')
      table.string('observation_digest', 64).notNullable()

      // 不可变快照：只有 created_at。
      table.timestamp('created_at', { useTz: true }).notNullable()

      table.index(['organization_id', 'loop_id', 'created_at'])
    })

    this.schema.createTable('resource_capacity_reviews', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('loop_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_loops')
        .onDelete('CASCADE')
      table
        .bigInteger('observation_snapshot_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('resource_capacity_observation_snapshots')
        .onDelete('RESTRICT')

      table.string('outcome', 20).notNullable()
      table.check("outcome IN ('goal_met','partially_met','not_met','invalidated')")
      // 有界结论文本 ≤500 字符（Validator 校验；审计低敏扫描 fail-closed）。
      table.string('bounded_rationale', 500).notNullable().defaultTo('')
      table
        .bigInteger('actor_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')

      table.timestamp('created_at', { useTz: true }).notNullable()

      table.unique(['organization_id', 'observation_snapshot_id'])
      table.index(['organization_id', 'loop_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('resource_capacity_reviews')
    this.schema.dropTable('resource_capacity_observation_snapshots')
    this.schema.dropTable('resource_capacity_handoff_receipts')
    this.schema.dropTable('resource_capacity_selections')
  }
}
