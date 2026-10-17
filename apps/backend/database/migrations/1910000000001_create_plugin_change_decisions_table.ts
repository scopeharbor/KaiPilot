import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_change_decisions', (table) => {
      table.bigIncrements('id')

      // ── Server-owned scope ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── Request reference ──
      table
        .bigInteger('request_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plugin_change_requests')
        .onDelete('CASCADE')

      // ── Decision identity（幂等唯一键派生自 requestId+event+idempotencyKey）──
      table.string('decision_uid', 100).notNullable()

      // ── Event ──
      table.string('event', 20).notNullable()
      table.check(
        "event IN ('requested','previewed','approved','rejected','withdrawn','confirmed','applied','failed','expired')",
      )
      table.string('actor_ref', 64).notNullable()
      table.string('idempotency_key', 120).notNullable()
      table.string('from_state', 30).notNullable()
      table.string('to_state', 30).notNullable()
      table.string('reason_code', 60).nullable()

      // ── Binding对照 ──
      table.string('diff_digest', 32).notNullable()

      // ── Trusted audit receipt（提交门结果回填）──
      table.bigInteger('audit_log_id').nullable()
      table.timestamp('receipt_created_at', { useTz: true }).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()

      // ── Idempotency & indexes ──
      table.unique(['organization_id', 'decision_uid'])
      table.index(['request_id', 'created_at'])
      table.index(['organization_id', 'event'])
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_change_decisions')
  }
}
