import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'multi_project_impact_plans'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('actor_id').unsigned().notNullable()
      table.string('run_token', 64).notNullable().unique()
      table.string('scope_hash', 64).notNullable()
      table.string('rule_version', 32).notNullable()
      table.string('source_freshness_hash', 64).notNullable()
      table.string('permission_fingerprint', 64).notNullable()
      table.text('scope_json').notNullable() // 低敏 scope 序列化（不含敏感字段）
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.index(['organization_id'])
      table.index(['run_token'])
      table.index(['expires_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
