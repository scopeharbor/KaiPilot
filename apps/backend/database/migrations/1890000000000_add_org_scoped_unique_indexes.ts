import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-backend-type-debt-closure —— 补齐 DatabaseIsolationCatalog 声明的组织范围唯一键。
 *
 * 背景：catalog 的 uniqueScopeKeys 治理声明要求这些表存在 (organization_id, key)
 * 复合唯一索引（迁移守卫 3.3 正向强制）；而既有迁移里实际生效的只是全局唯一键
 * （F10 修复后才有）。全局唯一在语义上更强，但与 catalog 声明不一致会让守卫失败、
 * 治理意图落空。本迁移按 catalog 声明补齐复合唯一索引。
 *
 * 数据安全：全局唯一键（session_id/message_id/record_id/…）已保证键全局唯一，
 * 因此复合 (organization_id, key) 必然无重复，创建唯一索引不会失败。
 */
export default class extends BaseSchema {
  // [table, columns]——与 DatabaseIsolationCatalog.uniqueScopeKeys 逐项对应
  private readonly additions: ReadonlyArray<readonly [string, readonly string[], string]> = [
    [
      'plugin_private_registry_entries',
      ['organization_id', 'plugin_identity'],
      'uq_ppre_entries_org_identity',
    ],
    [
      'plugin_private_registry_releases',
      ['organization_id', 'plugin_identity', 'version'],
      'uq_ppre_releases_org_identity_version',
    ],
    [
      'plugin_private_registry_operations',
      ['organization_id', 'idempotency_key'],
      'uq_ppre_operations_org_idem',
    ],
    ['copilot_sessions', ['organization_id', 'session_id'], 'uq_copilot_sessions_org_session'],
    ['copilot_messages', ['organization_id', 'message_id'], 'uq_copilot_messages_org_message'],
    [
      'copilot_routing_decisions',
      ['organization_id', 'record_id'],
      'uq_routing_decisions_org_record',
    ],
    // copilot_suggestion_inbox 不在此列：其真实唯一键 (organization_id, project_id, dedupe_key_json)
    // 在 1844000000000 迁移中已存在，此前是 catalog 声明了不存在的 suggestion_id 列（已改 catalog 对齐）。
    [
      'unified_ai_invocation_ledger',
      ['organization_id', 'idempotency_key'],
      'uq_invocation_ledger_org_idem',
    ],
    [
      'unified_ai_feedback_events',
      ['organization_id', 'idempotency_key'],
      'uq_feedback_events_org_idem',
    ],
    ['evaluation_scores', ['organization_id', 'idempotency_key'], 'uq_evaluation_scores_org_idem'],
    ['ai_trace_spans', ['organization_id', 'span_id'], 'uq_trace_spans_org_span'],
    ['budget_decisions', ['organization_id', 'idempotency_key'], 'uq_budget_decisions_org_idem'],
    ['rate_limit_decisions', ['organization_id', 'idempotency_key'], 'uq_rate_limit_org_idem'],
  ]

  async up() {
    for (const [tableName, columns, indexName] of this.additions) {
      this.schema.alterTable(tableName, (table) => {
        table.unique([...columns], { indexName })
      })
    }
  }

  async down() {
    for (const [tableName, , indexName] of this.additions) {
      this.schema.alterTable(tableName, (table) => {
        table.dropUnique([], indexName)
      })
    }
  }
}
