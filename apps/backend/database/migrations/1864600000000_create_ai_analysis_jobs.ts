import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ai_analysis_jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 36).primary()
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('request_key', 36).notNullable()
      table.string('input_hash', 64).notNullable()
      table.string('kind', 24).notNullable()
      table.string('state', 16).notNullable()
      table.string('live_output_id', 36).nullable()
      table.text('result_encrypted').nullable()
      table.string('error_code', 80).nullable()
      table.text('error_message').nullable()
      table.bigInteger('created_at_ms').notNullable()
      table.bigInteger('updated_at_ms').notNullable()
      table.bigInteger('lease_until_ms').notNullable()
      table.bigInteger('expires_at_ms').notNullable()
      table.unique(['organization_id', 'user_id', 'request_key'])
      table.index(['organization_id', 'user_id', 'id'])
      table.index(['expires_at_ms'])
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
