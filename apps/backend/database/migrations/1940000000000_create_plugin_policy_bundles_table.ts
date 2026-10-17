import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-plugin-policy-bundles —— 组织策略包版本表（任务 2.3）。
 *
 * 只存组织副本；内置模板随宿主代码发布、只读（design D3）。
 * 每行一个 (organization, bundle, version) 版本：写入后 rules/digest 不可变
 * （immutable digest），演进以新版本行表达。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_policy_bundles', (table) => {
      table.bigIncrements('id')

      // ── Server-owned scope ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── Bundle identity & provenance ──
      table.string('bundle_id', 64).notNullable()
      table.string('source_template_id', 40).notNullable()
      table.check("source_template_id IN ('admin-managed','pm-enabled','member-readonly')")
      table.integer('source_template_version').notNullable()

      // ── Version content（canonical、不可变）──
      table.integer('version').notNullable()
      table.text('description_zh').notNullable()
      table.text('rules_json').notNullable()
      table.string('document_digest', 32).notNullable()

      // ── Lifecycle ──
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      // ── Idempotency & indexes ──
      table.unique(['organization_id', 'bundle_id', 'version'])
      table.index(['organization_id', 'bundle_id'])
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_policy_bundles')
  }
}
