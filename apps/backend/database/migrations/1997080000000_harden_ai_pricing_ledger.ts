import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * 定价归属可解释性 + 热路径索引。
 * approximate/matched_by 让用量页能区分精确价与近似价；三组索引避免模型回算扫描整本账。
 */
export default class extends BaseSchema {
  protected tableName = 'unified_ai_invocation_ledger'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('pricing_approximate').nullable()
      table.string('pricing_matched_by', 40).nullable()
      table.index(['organization_id', 'model_id', 'occurred_at'], 'ledger_org_model_occurred_idx')
      table.index(
        ['organization_id', 'request_model', 'occurred_at'],
        'ledger_org_request_model_occurred_idx',
      )
      table.index(
        ['organization_id', 'response_model', 'occurred_at'],
        'ledger_org_response_model_occurred_idx',
      )
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropIndex([], 'ledger_org_response_model_occurred_idx')
      table.dropIndex([], 'ledger_org_request_model_occurred_idx')
      table.dropIndex([], 'ledger_org_model_occurred_idx')
      table.dropColumn('pricing_matched_by')
      table.dropColumn('pricing_approximate')
    })
  }
}
