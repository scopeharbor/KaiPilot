import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * V2 通知中心：添加 hidden_at 字段用于通知隐藏/忽略。
 *
 * - hidden_at 为空 = 未隐藏（默认）
 * - hidden_at 非空 = 用户已隐藏此通知，默认列表查询不返回
 * - 不物理删除通知记录（可审计，可取消隐藏）
 * - 复合索引 (organization_id, recipient_id, hidden_at, created_at)
 *   覆盖核心列表查询路径
 */
export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('hidden_at', { useTz: false }).nullable().after('read_at')
      table.index(
        ['organization_id', 'recipient_id', 'hidden_at', 'created_at'],
        'notifications_org_recipient_hidden_created',
      )
    })
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS notifications_org_recipient_hidden_created')
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('hidden_at')
    })
  }
}
