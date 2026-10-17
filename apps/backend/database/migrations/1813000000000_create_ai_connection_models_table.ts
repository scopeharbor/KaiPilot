import { BaseSchema } from '@adonisjs/lucid/schema'

const DEFAULT_MODEL_CAPABILITIES = JSON.stringify([
  'chat',
  'project_draft',
  'structured_output',
  'tool_calling',
])

export default class extends BaseSchema {
  protected tableName = 'ai_connection_models'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('connection_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_connections')
        .onDelete('CASCADE')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('model_name', 200).notNullable()
      table.json('capabilities').nullable()
      table.integer('rpm_limit').nullable()
      table.integer('tpm_limit').nullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('last_tested_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id'])
      table.index(['connection_id'])
      table.index(['organization_id', 'is_active'])
      table.unique(['connection_id', 'model_name'])
    })

    this.defer(async (db) => {
      const now = new Date().toISOString()
      const existing = await db
        .from('ai_connections')
        .select('id', 'organization_id', 'model', 'is_active')

      if (existing.length === 0) return

      const rows = existing
        .filter((row) => typeof row.model === 'string' && row.model.trim().length > 0)
        .map((row) => ({
          connection_id: row.id,
          organization_id: row.organization_id,
          model_name: row.model,
          capabilities: DEFAULT_MODEL_CAPABILITIES,
          rpm_limit: null,
          tpm_limit: null,
          is_active: row.is_active,
          last_tested_at: null,
          created_at: now,
          updated_at: now,
        }))
      if (rows.length > 0) await db.table(this.tableName).insert(rows)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
