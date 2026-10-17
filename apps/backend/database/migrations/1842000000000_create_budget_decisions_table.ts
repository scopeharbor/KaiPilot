/**
 * v3-unified-ai-budget-and-quota §3.1 — 统一预算决策表。
 *
 * 记录每次 preflight/postflight 决策：
 * 归属维度（org/project/user/capability/surface）、窗口、策略引用、
 * 预估与实际用量、决策结果（allow/warn/block/degrade）、越界原因、幂等键。
 *
 * 低敏：不存 prompt、模型输出、原始载荷、token、secret、Authorization。
 * 与账本 budget_decision_ref 双向可关联。
 */

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class CreateBudgetDecisionsTable extends BaseSchema {
  public static readonly tableName = 'budget_decisions'

  async up() {
    this.schema.createTable(CreateBudgetDecisionsTable.tableName, (table) => {
      table.increments('id').primary()

      // ── 归属维度 ──
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.integer('user_id').unsigned().nullable()
      table.string('capability', 64).notNullable()
      table.string('surface', 64).notNullable()

      // ── 策略引用 ──
      table.json('policy_refs').notNullable().defaultTo('[]')
      table.string('triggering_scope', 32).notNullable()
      table.string('triggering_policy_name', 128).notNullable().defaultTo('')

      // ── 决策 ──
      table.string('decision_type', 16).notNullable() // preflight | postflight
      table.string('outcome', 16).notNullable() // allow | warn | block | degrade
      table.string('reason_code', 64).nullable()
      table.text('reason').nullable()

      // ── 窗口 ──
      table.timestamp('window_start', { useTz: true }).notNullable()
      table.timestamp('window_end', { useTz: true }).notNullable()

      // ── 用量 ──
      table.decimal('estimated_cost', 16, 10).nullable()
      table.decimal('actual_cost', 16, 10).nullable()
      table.integer('estimated_tokens').unsigned().nullable()
      table.integer('actual_tokens').unsigned().nullable()
      table.decimal('accumulated_cost', 16, 10).notNullable().defaultTo(0)
      table.integer('accumulated_tokens').unsigned().notNullable().defaultTo(0)
      table.string('currency', 8).notNullable().defaultTo('CNY')
      table.string('cost_status', 24).nullable()

      // ── 幂等与关联 ──
      table.string('idempotency_key', 128).notNullable()
      table.string('ledger_attempt_ref', 128).nullable()

      // ── 降级 ──
      table.json('degradation').nullable()

      // ── 桥接 ──
      table.json('bridge_ref').nullable()

      // ── 时间 ──
      table.timestamp('decided_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      // ── 索引 ──
      // 组织隔离 + 窗口累计查询
      table.index(
        ['organization_id', 'triggering_scope', 'window_start'],
        'budget_decisions_org_scope_window_idx',
      )
      // 幂等索引：防止同一 attempt 重复扣减
      table.unique(['idempotency_key'], 'budget_decisions_ik_unique')
      // 决策结果查询
      table.index(['outcome'], 'budget_decisions_outcome_idx')
      // 能力面查询
      table.index(['capability'], 'budget_decisions_capability_idx')
      // 时间范围查询
      table.index(['decided_at'], 'budget_decisions_decided_at_idx')
    })
  }

  async down() {
    this.schema.dropTableIfExists(CreateBudgetDecisionsTable.tableName)
  }
}
