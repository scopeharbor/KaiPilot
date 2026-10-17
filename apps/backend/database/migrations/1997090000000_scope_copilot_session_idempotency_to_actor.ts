import { BaseSchema } from '@adonisjs/lucid/schema'

/** 服务按本人查幂等键，数据库约束也必须包含本人，避免同组织账号互相占用键。 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('copilot_sessions', (table) => {
      table.dropUnique(['organization_id', 'idempotency_key'], 'uq_cs_idempotency')
      table.unique(['organization_id', 'actor_id', 'idempotency_key'], 'uq_cs_actor_idempotency')
    })
  }

  async down() {
    const duplicate = await this.db
      .from('copilot_sessions')
      .select('organization_id', 'idempotency_key')
      .groupBy('organization_id', 'idempotency_key')
      .havingRaw('COUNT(*) > 1')
      .first()
    if (duplicate) throw new Error('不同账号已使用相同会话幂等键，无法无损回滚组织级唯一约束')
    this.schema.alterTable('copilot_sessions', (table) => {
      table.dropUnique(
        ['organization_id', 'actor_id', 'idempotency_key'],
        'uq_cs_actor_idempotency',
      )
      table.unique(['organization_id', 'idempotency_key'], 'uq_cs_idempotency')
    })
  }
}
