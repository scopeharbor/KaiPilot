import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 B, task 5.1）—— routing_rules 表。
 *
 * 经治理落库的用户编排路由规则。与代码 DEFAULT_RULES 经同一 #validateAndRegister 闸门，
 * 保持确定性/版本化/仅引用已声明 stage/低敏 reason code/不读敏感 payload。
 *
 * 组织隔离、SQLite + PG 兼容、可回滚（down 删表即回到仅代码 DEFAULT_RULES 的现状行为）。
 * 唯一约束：org + rule_id + version（同一组织内规则 id+version 唯一）。
 * 规则变更 MUST NOT 改变已开始 run 的绑定 decision（resume 复用原 decision）。
 */
export default class extends BaseSchema {
  protected tableName = 'routing_rules'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // ── 组织隔离 ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── 规则标识与版本 ──
      table.string('rule_id', 80).notNullable()
      table.integer('version_major').notNullable()
      table.integer('version_minor').notNullable().defaultTo(0)
      table.string('compatible_min', 20).notNullable().defaultTo('1.0')
      table.string('compatible_max', 20).notNullable().defaultTo('2.0')

      // ── 低敏规则体（仅枚举/refs，无 prompt/output/secret） ──
      table.json('scenario_kinds').notNullable()
      table.json('allowed_stage_ids').notNullable().defaultTo('[]')
      table.json('allowed_skipped_stage_ids').notNullable().defaultTo('[]')
      table.string('reason_code', 40).notNullable()
      table.boolean('is_default').notNullable().defaultTo(false)
      table.boolean('enabled').notNullable().defaultTo(true)

      // ── 审计 ──
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // ── 唯一约束 + 索引 ──
      table.unique(
        ['organization_id', 'rule_id', 'version_major', 'version_minor'],
        'idx_rrules_org_rule_version_unique',
      )
      table.index(['organization_id', 'enabled'], 'idx_rrules_org_enabled')
      table.index(['organization_id', 'rule_id'], 'idx_rrules_org_rule')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
