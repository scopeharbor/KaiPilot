/**
 * v3-plugin-permission-audit-and-observation —— Plugin Permission Decisions 表
 * （task 3.1）。
 *
 * Append-only 决策账本：存储结构化、低敏的插件权限决策 envelope。
 * 与既有 audit_logs 同事务双写，通过 audit_log_id receipt 保持一致。
 *
 * 红线：
 * - 只存低敏引用（hash/ref/digest），不存 manifest/grant/包/正文/secret/token/URL
 * - server-owned scope 列仅用于过滤与访问控制，不进入 payload
 * - append-only：禁止 update/delete 作为普通业务操作
 *
 * SQLite 兼容 + PG 兼容。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_permission_decisions', (table) => {
      table.bigIncrements('id')

      // ── Server-owned scope（仅用于过滤与访问控制，不进入 payload） ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.bigInteger('project_id').unsigned().nullable()

      // ── Decision identity ──
      table.string('decision_id', 200).notNullable()
      table.string('input_fingerprint', 200).notNullable()

      // ── Mode / Operation / Outcome ──
      table.string('mode', 30).notNullable()
      table.check("mode IN ('host-administration','plugin-runtime')")

      table.string('operation', 50).notNullable()
      table.check(
        "operation IN ('register-install','enable','disable','upgrade','uninstall','resolve-query','execute','command-proposal','ui-slot','skill-adapter','compiler-contribution')",
      )

      table.string('outcome', 20).notNullable()
      table.check("outcome IN ('allowed','denied')")

      // ── Reasons ──
      table.string('primary_reason', 80).notNullable()
      table.json('reason_codes').notNullable() // string[] — 封闭 reason code 列表

      // ── Low-sensitive refs ──
      table.json('permission_refs').nullable() // string[]
      table.string('seam_ref', 200).nullable()
      table.string('manifest_digest_ref', 200).nullable()
      table.string('grant_digest_ref', 200).nullable()
      table.string('install_ref', 200).nullable()

      // ── Scope / Actor / Plugin hash refs（低敏不可逆） ──
      table.string('actor_ref_hash', 200).notNullable()
      table.string('plugin_ref_hash', 200).nullable()
      table.string('contribution_ref_hash', 200).nullable()

      // ── Correlation / Idempotency ──
      table.string('correlation_ref', 200).nullable()
      table.string('idempotency_ref', 200).nullable()

      // ── Audit receipt ──
      table.bigInteger('audit_log_id').unsigned().nullable()
      table.string('audit_schema_version', 20).nullable()

      // ── Metadata ──
      table.string('latency_bucket', 30).nullable()
      table.string('schema_version', 10).notNullable().defaultTo('1')

      // ── Timestamps ──
      table.timestamp('created_at').notNullable()

      // ── Constraints ──
      table.unique(['organization_id', 'decision_id'])
      table.index(['organization_id', 'created_at'])
      table.index(['organization_id', 'outcome', 'created_at'])
      table.index(['organization_id', 'operation', 'created_at'])
      table.index(['organization_id', 'correlation_ref'])
      table.index(['organization_id', 'primary_reason', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_permission_decisions')
  }
}
