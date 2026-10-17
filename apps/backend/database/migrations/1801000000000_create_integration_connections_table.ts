import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'integration_connections'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.string('provider', 40).notNullable()
      table.string('status', 30).notNullable().defaultTo('connected')
      table.string('external_account_id', 255).nullable()
      table.string('external_account_email', 254).nullable()
      table.text('scopes_json').nullable()
      table.text('access_token_encrypted').nullable()
      table.text('refresh_token_encrypted').nullable()
      table.string('token_type', 40).nullable()
      table.timestamp('expires_at').nullable()
      table.timestamp('connected_at').nullable()
      table.timestamp('disconnected_at').nullable()
      table.timestamp('last_checked_at').nullable()
      table.text('last_error').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['organization_id', 'user_id', 'provider'])
      table.index(['organization_id', 'provider', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
