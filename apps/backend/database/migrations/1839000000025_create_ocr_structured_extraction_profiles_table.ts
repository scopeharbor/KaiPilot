import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_structured_extraction_profiles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('organization_id').notNullable().index()
      table.integer('project_id').nullable().index()
      table.string('name', 255).notNullable()
      table.string('scope', 32).notNullable().index() // builtin | project | organization
      table.string('status', 32).notNullable().defaultTo('active').index() // draft | active | archived
      table.string('schema_key', 128).notNullable().index()
      table.integer('current_version').notNullable().defaultTo(1)
      table.integer('total_runs').notNullable().defaultTo(0)
      table.text('description').nullable()
      table.integer('created_by').nullable().references('id').inTable('users')
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['organization_id', 'scope', 'status'])
      table.unique(['schema_key', 'organization_id', 'project_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
