/**
 * v3-ai-quality-cost-admin-console —— 为 `unified_ai_invocation_ledger` 补
 * `(organization_id, occurred_at)` 索引。
 *
 * 背景：`cost_usage_reader`（及概览聚合）按 `organization_id` + `occurred_at` 范围
 * 过滤（窗口中各调用记录），但建表迁移只定义了 `(organization_id, created_at)`。
 * 查询列与索引不匹配 → organization 扫描走全表过滤，100 万条账本下概览 p95 无法
 * 满足 < 1000ms（design.md 性能风险项：不达标先补索引迁移）。
 *
 * @aiproj/backend
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'unified_ai_invocation_ledger'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.index(['organization_id', 'occurred_at'], 'ledger_org_occurred_idx')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex(['organization_id', 'occurred_at'], 'ledger_org_occurred_idx')
    })
  }
}
