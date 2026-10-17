import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_entity_link_candidates'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('organization_id').notNullable().index()
      table.integer('project_id').notNullable().index()
      table
        .integer('run_id')
        .notNullable()
        .references('id')
        .inTable('ocr_entity_link_runs')
        .onDelete('CASCADE')
      table.integer('extraction_id').notNullable().index()
      table.text('page_refs_json').notNullable().defaultTo('[]') // JSON array of page indices
      table.integer('span_start').notNullable()
      table.integer('span_end').notNullable()
      table.string('mention_type', 64).notNullable().index()
      table.string('normalized_label', 512).notNullable()
      table.string('selected_text_hash', 64).notNullable()
      table.string('span_hash', 32).notNullable()
      table.float('confidence').notNullable().defaultTo(0.0)
      table.string('status', 32).notNullable().defaultTo('pending').index() // pending|matched|unmatched|duplicate|blocked
      table.text('target_suggestion_json').nullable() // target kind/id/title/matchReason/confidence/navigationRef/redacted
      table.text('warnings_json').nullable().defaultTo('[]') // JSON array of warning codes
      table.string('candidate_key', 32).notNullable().index() // 稳定候选键
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['organization_id', 'project_id', 'status'])
      table.index(['run_id', 'status'])
      table.unique(['run_id', 'candidate_key'])
      table.index(['extraction_id', 'mention_type'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
