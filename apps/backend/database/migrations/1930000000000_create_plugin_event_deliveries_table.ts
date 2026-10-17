import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // v3-plugin-event-subscription-contract —— 有界 internal plugin event outbox/delivery 台账。
    // 语义（design D2/D4）：核心事务成功后由宿主 projector 写入低敏 envelope；
    // delivery_identity 幂等唯一；状态机 pending→delivered/skipped/stale/failed/dropped；
    // 组织级保留上限由宿主服务清理（MAX_EVENT_DELIVERY_ROWS_PER_ORG）。
    this.schema.createTable('plugin_event_deliveries', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('installation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plugin_installations')
        .onDelete('CASCADE')

      table.string('plugin_id', 200).notNullable()
      table.string('plugin_version', 50).notNullable()
      table.string('subscription_digest', 32).notNullable()

      table.string('event_type', 100).notNullable()
      table.string('event_version', 20).notNullable()
      table.string('event_id', 32).notNullable()

      table.string('delivery_identity', 64).notNullable()
      table.json('envelope').notNullable()

      table.string('status', 20).notNullable().defaultTo('pending')
      table.check("status IN ('pending','delivered','skipped','stale','failed','dropped')")

      table.integer('attempt_count').notNullable().defaultTo(0)
      table.string('last_reason_code', 60).nullable()
      table.string('response_kind', 20).nullable()
      table.check(
        "response_kind IS NULL OR response_kind IN ('observation','advisory-draft','action-proposal')",
      )

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('delivered_at').nullable()

      // 幂等唯一键含组织列（迁移守卫 3.2：tenant-owned 唯一索引必须含 org）
      table.unique(['organization_id', 'delivery_identity'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'created_at'])
      table.index(['installation_id', 'subscription_digest'])
      table.index(['status', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_event_deliveries')
  }
}
