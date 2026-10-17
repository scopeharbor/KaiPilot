import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-plugin-action-preview-boundary —— 插件写入动作提案存储。
 *
 * 一个 proposal 行承载完整生命周期：proposed → previewed → (rejected|discarded|applied|stale)。
 * - 一次性确认句柄：handle_value + handle_consumed_at；CAS 消费（row_version）。
 * - 幂等：idempotency_key 由服务端派生并绑定句柄；applied_receipt_json 支撑重放返回同一结果。
 * - 低敏：input_payload/source_refs/preview_json 只存契约允许的封闭字段，禁止 raw prompt/tool 输出。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_action_proposals', (table) => {
      table.bigIncrements('id')

      // ── Server-owned scope ──
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

      // ── Proposal identity ──
      table.string('proposal_uid', 80).notNullable()
      table.string('schema_version', 40).notNullable()
      table.string('action_kind', 80).notNullable()
      table.check("action_kind IN ('plugin.pilot.item.create')")

      // ── Lifecycle state ──
      table.string('status', 30).notNullable().defaultTo('proposed')
      table.check("status IN ('proposed','previewed','rejected','discarded','applied','stale')")

      // ── Bounded canonical input & source refs（低敏封闭字段）──
      table.text('input_payload').notNullable()
      table.text('source_refs').notNullable()
      table.integer('proposed_by').unsigned().nullable()

      // ── Preview（最新一次；重新预览覆盖）──
      table.text('preview_json').nullable()
      table.string('preview_digest', 32).nullable()
      table.timestamp('preview_expires_at', { useTz: true }).nullable()
      table.string('target_revision', 120).nullable()

      // ── Idempotency（服务端派生）──
      table.string('idempotency_key', 64).nullable()
      table.index(['organization_id', 'idempotency_key'])

      // ── One-time confirm handle ──
      table.string('handle_value', 64).nullable()
      table.index(['organization_id', 'handle_value'])
      table.integer('handle_actor_user_id').unsigned().nullable()
      table.timestamp('handle_expires_at', { useTz: true }).nullable()
      table.timestamp('handle_consumed_at', { useTz: true }).nullable()

      // ── Result（applied 后固化，支撑幂等重放同一 receipt）──
      table.string('result_status', 30).nullable()
      table.check(
        "result_status IN ('applied','modified','rejected','discarded','stale_blocked','permission_denied','dry_run_failed','partial_failure','idempotent_replay','expired') OR result_status IS NULL",
      )
      table.text('applied_receipt_json').nullable()
      table.timestamp('applied_at', { useTz: true }).nullable()

      // ── Concurrency & lifecycle ──
      table.integer('row_version').notNullable().defaultTo(1)
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      // ── Indexes ──
      table.unique(['organization_id', 'proposal_uid'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_action_proposals')
  }
}
