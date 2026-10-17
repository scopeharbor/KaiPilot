import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_project_draft_validations', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('draft_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('ai_project_drafts')
        .onDelete('CASCADE')
      table.integer('version').notNullable()
      table.string('phase', 20).notNullable()
      table.check("phase IN ('self_checking','validating','all')")
      table.integer('confidence_score').notNullable()
      table.string('overall_risk_level', 16).notNullable()
      table.boolean('can_confirm').notNullable().defaultTo(false)
      table.json('report').notNullable()
      table.json('auto_fix_diffs').nullable()
      table.timestamp('created_at').notNullable()

      table.index(['draft_id', 'version'])
      table.index(['draft_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable('ai_project_draft_validations')
  }
}
