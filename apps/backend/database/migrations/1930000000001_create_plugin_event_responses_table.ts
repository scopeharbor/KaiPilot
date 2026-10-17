import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // v3-plugin-event-subscription-contract —— 幂等响应 recorder（observation/advisory-draft/action-proposal）。
    // delivery_identity 唯一 → 重试最多产生一个有效建议记录（D4）。
    this.schema.createTable('plugin_event_responses', (table) => {
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
      table.string('delivery_identity', 64).notNullable()
      table.string('event_id', 32).notNullable()

      table.string('kind', 20).notNullable()
      table.check("kind IN ('observation','advisory-draft','action-proposal')")

      table.string('title', 200).nullable()
      table.string('body', 1000).nullable()

      table.string('proposal_key', 64).nullable()
      table.string('proposal_summary', 32).nullable()
      table.boolean('proposal_registered').notNullable().defaultTo(false)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 幂等唯一键含组织列（迁移守卫 3.2）
      table.unique(['organization_id', 'delivery_identity'])
      table.index(['organization_id', 'kind'])
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_event_responses')
  }
}
