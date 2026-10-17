import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('ocr_structured_extraction_runs', (table) => {
      table.integer('profile_id').nullable().alter()
      table.integer('profile_version_id').nullable().alter()
      table.string('profile_ref', 180).nullable().index()
      table.string('profile_source', 32).notNullable().defaultTo('builtin')
      table.string('profile_payload_digest', 80).nullable()
      table.text('profile_snapshot_json').nullable()
    })
    this.schema.alterTable('ocr_structured_extraction_snapshots', (table) => {
      table.integer('profile_id').nullable().alter()
      table.string('profile_ref', 180).nullable().index()
      table.string('profile_source', 32).notNullable().defaultTo('builtin')
      table.string('profile_payload_digest', 80).nullable()
      table.string('plugin_version', 64).nullable()
    })
  }

  async down() {
    this.schema.alterTable('ocr_structured_extraction_snapshots', (table) => {
      table.dropColumn('profile_payload_digest')
      table.dropColumn('plugin_version')
      table.dropColumn('profile_source')
      table.dropColumn('profile_ref')
      table.integer('profile_id').notNullable().alter()
    })
    this.schema.alterTable('ocr_structured_extraction_runs', (table) => {
      table.dropColumn('profile_snapshot_json')
      table.dropColumn('profile_payload_digest')
      table.dropColumn('profile_source')
      table.dropColumn('profile_ref')
      table.integer('profile_version_id').notNullable().alter()
      table.integer('profile_id').notNullable().alter()
    })
  }
}
