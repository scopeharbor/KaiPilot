import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_entity_link_confirmed_links'

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
      table
        .integer('candidate_id')
        .notNullable()
        .references('id')
        .inTable('ocr_entity_link_candidates')
        .onDelete('CASCADE')
      table.integer('extraction_id').notNullable().index()
      table.string('source_hash', 64).notNullable()
      table.string('selected_text_hash', 64).notNullable()
      table.string('span_hash', 32).notNullable()
      table.string('target_kind', 64).notNullable().index()
      table.integer('target_id').notNullable()
      table.string('normalized_label', 512).notNullable()
      table.float('confidence').notNullable().defaultTo(0.0)
      table.string('match_reason', 32).notNullable().defaultTo('exact_label')
      table.string('rule_version', 32).notNullable().defaultTo('1.0.0')
      table.integer('reviewer_id').notNullable().references('id').inTable('users')
      table.string('lifecycle_status', 32).notNullable().defaultTo('active').index() // active|superseded|rejected
      table.string('confirmation_hash', 32).notNullable()
      table
        .integer('superseded_by_id')
        .nullable()
        .references('id')
        .inTable('ocr_entity_link_confirmed_links')
      table.text('supersede_reason').nullable()
      table.text('audit_ref').nullable()
      table.timestamp('confirmed_at').notNullable().defaultTo(this.now())
      table.timestamp('superseded_at').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['organization_id', 'project_id', 'lifecycle_status'])
      table.index(['run_id', 'extraction_id'])
      table.index(['target_kind', 'target_id'])
      table.unique(['extraction_id', 'span_hash', 'target_kind', 'target_id'], {
        indexName: 'uidx_elcl_extraction_span_target',
      })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
