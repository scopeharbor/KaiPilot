import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_change_requests', (table) => {
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

      // ── Request identity ──
      table.string('request_uid', 80).notNullable()

      // ── Kind & state machine ──
      table.string('kind', 30).notNullable()
      table.check("kind IN ('install','permission-upgrade','version-upgrade')")
      table.string('state', 30).notNullable().defaultTo('draft')
      table.check(
        "state IN ('draft','pending-approval','approved','rejected','awaiting-confirmation','applied','withdrawn','expired','failed')",
      )

      // ── Target ──
      table.string('plugin_id', 200).notNullable()
      table.string('requested_by', 64).notNullable()
      table.string('target_revision', 120).notNullable()

      // ── Immutable before/after summary（低敏 canonical diff，不含 manifest 原文）──
      table.text('diff_json').notNullable()
      table.string('diff_digest', 32).notNullable()
      table.string('permission_digest', 32).notNullable()
      table.string('compatibility_digest', 32).notNullable()

      // ── Approval policy（创建时固化）──
      table.boolean('approval_required').notNullable().defaultTo(false)
      table.string('approved_by', 64).nullable()

      // ── Active confirm handle（同一时刻至多一个有效句柄；绑定字段可由行内数据重建）──
      table.string('handle_digest', 32).nullable()
      table.string('handle_actor_ref', 64).nullable()
      table.timestamp('handle_expires_at', { useTz: true }).nullable()

      // ── Concurrency & lifecycle ──
      table.integer('row_version').notNullable().defaultTo(1)
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      // ── Idempotency & indexes ──
      table.unique(['organization_id', 'request_uid'])
      table.index(['organization_id', 'state'])
      table.index(['organization_id', 'plugin_id'])
      table.index(['organization_id', 'created_at'])
      table.index(['organization_id', 'expires_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_change_requests')
  }
}
