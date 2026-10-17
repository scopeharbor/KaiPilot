import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ocr_entity_link_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('organization_id').notNullable().index()
      table.integer('project_id').notNullable().index()
      table.integer('actor_id').notNullable().references('id').inTable('users')
      table.string('input_signature', 32).notNullable().index() // 幂等输入哈希
      table.string('rule_version', 32).notNullable().defaultTo('1.0.0')
      table.string('status', 32).notNullable().defaultTo('running').index() // running|completed|stale|failed
      table.integer('candidate_count').notNullable().defaultTo(0)
      table.integer('confirmed_count').notNullable().defaultTo(0)
      table.text('source_extraction_ids_json').notNullable().defaultTo('[]') // JSON array of extraction ids
      table.text('target_kinds_json').notNullable().defaultTo('[]') // JSON array of target kinds
      table.text('stale_summary_json').nullable() // { isStale, staleReason, staleSince }
      table.text('error_message').nullable()
      table.timestamp('created_at').notNullable().defaultTo(this.now())
      table.timestamp('updated_at').nullable()

      table.index(['organization_id', 'project_id'])
      table.index(['organization_id', 'project_id', 'status'])
      table.unique(['organization_id', 'project_id', 'input_signature'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
