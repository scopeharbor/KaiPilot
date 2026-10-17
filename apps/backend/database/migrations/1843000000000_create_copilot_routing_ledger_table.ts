import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-copilot-routing-decision-ledger（任务 3.1–3.4）—— copilot_routing_decisions 表。
 *
 * Copilot 路由决策账本：落库路由层已定义的决策记录形状，补齐组织归属、
 * trace 引用、输入元组 hash 与幂等键，兑现「被用户改道」字段。
 *
 * 列名与 packages/types/src/copilot-routing-ledger.ts 契约一致。
 * 禁存原始用户输入全文（只存归一化意图摘要）。
 *
 * 组织隔离、SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'copilot_routing_decisions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // ── 组织隔离（必填）──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── 路由决策标识 ──
      table.string('record_id', 64).notNullable()
      table.string('catalog_version', 20).notNullable()

      // ── 意图分类 ──
      table.string('intent_class', 20).nullable()
      table.string('sub_intent_id', 80).nullable()

      // ── 归一化意图摘要（有界低敏，非原始输入全文）──
      table.string('intent_summary', 1024).notNullable()

      // ── destination 排序与 confidence ──
      table.json('destination_order').notNullable().defaultTo('[]')
      table.json('confidences').notNullable().defaultTo('[]')

      // ── 澄清与歧义 ──
      table.integer('clarification_round_count').notNullable().defaultTo(0)
      table.boolean('ambiguous').notNullable().defaultTo(false)

      // ── 不可用类别（路由层可见的两类）──
      table.json('unavailability_kinds').notNullable().defaultTo('[]')

      // ── 规则命中与模型兜底 ──
      table.integer('rule_hit_count').notNullable().defaultTo(0)
      table.integer('fallback_count').notNullable().defaultTo(0)

      // ── 路由 scope ──
      table.string('scope', 20).notNullable()

      // ── 改道分类（账本增量字段）──
      table.string('user_destination', 80).nullable()
      table.string('redirect_class', 30).notNullable()
      table.string('attribution_confidence', 20).notNullable()

      // ── 输入元组 hash 与幂等键 ──
      table.string('input_tuple_hash', 64).notNullable()
      table.string('idempotency_key', 64).notNullable()

      // ── trace 引用（未落地时为 null 占位）──
      table.string('trace_id', 64).nullable()

      // ── 时间戳 ──
      table.timestamp('created_at', { useTz: false }).notNullable()

      // ── 索引 ──
      // 组织隔离 + 聚合索引
      table.index(['organization_id', 'intent_class', 'created_at'], 'idx_crd_org_intent_time')
      table.index(['organization_id', 'catalog_version'], 'idx_crd_org_catalog')
      // 输入元组 hash 索引（支撑确定性违规查询）
      table.index(['input_tuple_hash'], 'idx_crd_input_hash')
      // trace 引用索引
      table.index(['trace_id'], 'idx_crd_trace_id')
      // 幂等索引
      table.unique(['idempotency_key'], 'idx_crd_idempotency')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
