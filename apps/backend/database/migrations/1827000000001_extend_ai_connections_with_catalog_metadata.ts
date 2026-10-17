import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('ai_connections', (table) => {
      table.string('catalog_provider_id', 120).nullable()
      table.string('catalog_provider_name', 200).nullable()
      table.string('catalog_provider_logo_url', 512).nullable()
      table.string('catalog_provider_doc_url', 512).nullable()
      table.json('catalog_provider_env_keys').nullable()
      table.json('catalog_source_payload').nullable()
      table.timestamp('catalog_synced_at').nullable()

      table.index(['organization_id', 'catalog_provider_id'])
    })

    this.schema.alterTable('ai_connection_models', (table) => {
      table.string('catalog_provider_id', 120).nullable()
      table.string('catalog_model_id', 240).nullable()
      table
        .bigInteger('pricing_snapshot_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ai_model_pricing_snapshots')
        .onDelete('SET NULL')
      table.json('catalog_metadata').nullable()
      table.integer('context_window_tokens').nullable()
      table.integer('max_input_tokens').nullable()
      table.integer('max_output_tokens').nullable()
      table.string('token_limit_source', 20).nullable()

      table.index(['organization_id', 'catalog_provider_id'])
      table.index(['organization_id', 'catalog_model_id'])
      table.index(['pricing_snapshot_id'])
    })
  }

  async down() {
    this.schema.alterTable('ai_connection_models', (table) => {
      table.dropIndex(['organization_id', 'catalog_provider_id'])
      table.dropIndex(['organization_id', 'catalog_model_id'])
      table.dropIndex(['pricing_snapshot_id'])
      table.dropColumn('token_limit_source')
      table.dropColumn('max_output_tokens')
      table.dropColumn('max_input_tokens')
      table.dropColumn('context_window_tokens')
      table.dropColumn('catalog_metadata')
      table.dropColumn('pricing_snapshot_id')
      table.dropColumn('catalog_model_id')
      table.dropColumn('catalog_provider_id')
    })

    this.schema.alterTable('ai_connections', (table) => {
      table.dropIndex(['organization_id', 'catalog_provider_id'])
      table.dropColumn('catalog_synced_at')
      table.dropColumn('catalog_source_payload')
      table.dropColumn('catalog_provider_env_keys')
      table.dropColumn('catalog_provider_doc_url')
      table.dropColumn('catalog_provider_logo_url')
      table.dropColumn('catalog_provider_name')
      table.dropColumn('catalog_provider_id')
    })
  }
}
