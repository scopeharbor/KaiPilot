import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-plugin-policy-bundles —— 组织策略激活状态表（任务 2.3）。
 *
 * 每组织至多一行（UNIQUE organization_id）：指向当前生效的 bundle/version，
 * status=active/disabled，revision 随每次激活变化递增（缓存失效判据），
 * row_version 乐观锁保护并发激活。禁用后 security gate 回退到既有逐项授权边界，
 * 不使用 allow-all fallback。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_policy_bundle_activations', (table) => {
      table.bigIncrements('id')

      // ── Server-owned scope（每组织唯一）──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table.unique(['organization_id'])

      // ── Activation target ──
      table.string('bundle_id', 64).notNullable()
      table.integer('active_version').notNullable()
      table.string('status', 12).notNullable().defaultTo('active')
      table.check("status IN ('active','disabled')")

      // ── Concurrency & audit ──
      table.integer('revision').notNullable().defaultTo(1)
      table.integer('row_version').notNullable().defaultTo(1)
      table.string('activated_by', 64).notNullable()
      table.timestamp('activated_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.index(['organization_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_policy_bundle_activations')
  }
}
