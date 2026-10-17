import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_structured_extraction_profile_versions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('profile_id')
        .notNullable()
        .references('id')
        .inTable('ocr_structured_extraction_profiles')
      table.integer('version').notNullable()
      table.string('status', 32).notNullable().defaultTo('active') // draft | active | archived
      table.text('schema_definition_json').notNullable() // OcrExtractionProfileSchema JSON
      table.integer('created_by').nullable().references('id').inTable('users')
      table.timestamp('created_at').notNullable().defaultTo(this.now())

      table.unique(['profile_id', 'version'])
      table.index(['profile_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
