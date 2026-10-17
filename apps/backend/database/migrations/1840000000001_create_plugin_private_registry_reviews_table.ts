/**
 * v3-plugin-private-registry-lifecycle —— Plugin Private Registry Reviews & Operations 表
 * （task 3.3）。
 *
 * reviews: maker-checker 审批周期，submitter/reviewer 为 actor ref hash。
 * operations: 幂等命令/回滚操作，用于崩溃恢复与 replay 拒绝。
 * SQLite 兼容 + PG 兼容。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // ---- Reviews ----
    this.schema.createTable('plugin_private_registry_reviews', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('release_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plugin_private_registry_releases')
        .onDelete('CASCADE')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.integer('cycle_number').notNullable().defaultTo(1)

      // Actor reference hashes (low-sensitive, not raw user IDs)
      table.string('submitter_ref', 200).notNullable()
      table.string('reviewer_ref', 200).nullable()

      // Decision: pending → approved | rejected
      table.string('decision', 20).notNullable().defaultTo('pending')
      table.check("decision IN ('pending','approved','rejected')")

      // Low-sensitive reason code
      table.string('reason_code', 100).nullable()

      // Source hash for stale detection
      table.string('source_hash', 64).notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('resolved_at').nullable()

      // 每个 release 的 review cycle 单调递增
      table.unique(['release_id', 'cycle_number'])
      table.index(['organization_id', 'release_id'])
      table.index(['organization_id', 'decision'])
    })

    // ---- Operations ----
    this.schema.createTable('plugin_private_registry_operations', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('operation_type', 50).notNullable()
      table.check(
        "operation_type IN ('submit','approve','reject','deprecate','undeprecate','withdraw','restore-request','rollback')",
      )

      // Idempotency key (unique within org)
      table.string('idempotency_key', 200).notNullable()

      table
        .bigInteger('target_release_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('plugin_private_registry_releases')
        .onDelete('SET NULL')

      // Status
      table.string('status', 30).notNullable().defaultTo('pending')
      table.check(
        "status IN ('pending','confirmed','applying','committed','failed','degraded','compensated')",
      )

      // Preview source hash for stale detection
      table.string('preview_source_hash', 64).notNullable()

      // Low-sensitive impact summary (JSON)
      table.json('impact_summary').nullable()

      // Error/reason codes
      table.string('error_code', 100).nullable()
      table.string('reason_code', 100).nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 幂等键唯一
      table.unique(['organization_id', 'idempotency_key'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'target_release_id'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_private_registry_operations')
    this.schema.dropTable('plugin_private_registry_reviews')
  }
}
