import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('bi_custom_report_definitions', (table) => {
      table.bigIncrements('id')
      table.string('definition_id', 36).notNullable().unique()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('project_id').unsigned().nullable()
      table.integer('portfolio_id').unsigned().nullable()
      table.string('scope', 20).notNullable().defaultTo('organization')
      table.string('visibility', 20).notNullable().defaultTo('personal')
      table.integer('owner_actor_id').unsigned().notNullable()
      table.integer('version').unsigned().notNullable().defaultTo(1)
      table.string('definition_hash', 40).notNullable()
      table.string('title', 200).notNullable()
      table.string('description', 2000).nullable()
      table.json('data_sources').notNullable()
      table.json('fields').notNullable()
      table.json('filters').nullable()
      table.json('groups').nullable()
      table.json('sorts').nullable()
      table.json('visualizations').notNullable()
      table.json('layout').nullable()
      table.json('warnings').nullable()
      table.boolean('is_default').notNullable().defaultTo(false)
      table.timestamp('archived_at').nullable()
      table.integer('created_by').unsigned().notNullable()
      table.integer('updated_by').unsigned().notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['organization_id', 'archived_at'])
      table.index(['organization_id', 'scope', 'visibility'])
      table.index(['organization_id', 'owner_actor_id'])
      table.index(['definition_id', 'version'])
      table.index(['project_id'])
      table.index(['portfolio_id'])
    })

    this.schema.createTable('bi_custom_report_versions', (table) => {
      table.bigIncrements('id')
      table.string('definition_id', 36).notNullable()
      table.integer('organization_id').unsigned().notNullable()
      table.integer('version').unsigned().notNullable()
      table.string('definition_hash', 40).notNullable()
      table.string('title', 200).notNullable()
      table.json('snapshot').notNullable()
      table.string('change_summary', 500).nullable()
      table.integer('updated_by').unsigned().notNullable()
      table.timestamp('created_at').notNullable()

      table.index(['definition_id', 'version'])
      table.index(['organization_id'])
      table.unique(['definition_id', 'version'])
    })
  }

  async down() {
    this.schema.dropTableIfExists('bi_custom_report_versions')
    this.schema.dropTableIfExists('bi_custom_report_definitions')
  }
}
