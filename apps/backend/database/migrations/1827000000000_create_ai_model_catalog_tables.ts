import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('ai_model_catalog_snapshots', (table) => {
      table.bigIncrements('id')
      table.string('source', 40).notNullable().defaultTo('models.dev')
      table.string('source_url', 512).notNullable()
      table.string('source_hash', 80).notNullable().unique()
      table.json('payload').notNullable()
      table.integer('provider_count').notNullable().defaultTo(0)
      table.integer('model_count').notNullable().defaultTo(0)
      table.timestamp('fetched_at').notNullable()
      table.timestamp('expires_at').notNullable()
      table.boolean('stale').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['source', 'fetched_at'])
      table.index(['expires_at'])
    })

    this.schema.createTable('ai_model_pricing_snapshots', (table) => {
      table.bigIncrements('id')
      table.string('snapshot_key', 160).notNullable().unique()
      table.string('source', 40).notNullable().defaultTo('models.dev')
      table.string('source_hash', 80).notNullable()
      table.string('provider_id', 120).notNullable()
      table.string('provider_name', 200).notNullable()
      table.string('model_id', 240).notNullable()
      table.string('model_name', 240).notNullable()
      table.string('currency', 10).notNullable().defaultTo('USD')
      table.string('pricing_unit', 40).notNullable().defaultTo('1M_tokens')
      table.json('cost').nullable()
      table.json('limits').nullable()
      table.json('modalities').nullable()
      table.json('raw_provider').nullable()
      table.json('raw_model').nullable()
      table.timestamp('fetched_at').notNullable()
      table.timestamp('expires_at').notNullable()
      table.boolean('stale').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['provider_id'])
      table.index(['model_id'])
      table.index(['source_hash'])
      table.index(['provider_id', 'model_id'])
    })

    this.schema.createTable('ai_model_usage_snapshots', (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
      table
        .bigInteger('connection_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ai_connections')
        .onDelete('SET NULL')
      table
        .bigInteger('connection_model_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ai_connection_models')
        .onDelete('SET NULL')
      table
        .bigInteger('pricing_snapshot_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('ai_model_pricing_snapshots')
        .onDelete('SET NULL')
      table.string('provider', 160).notNullable()
      table.string('model', 240).notNullable()
      table.string('catalog_provider_id', 120).nullable()
      table.string('catalog_model_id', 240).nullable()
      table.json('usage').nullable()
      table.json('context_limits').nullable()
      table.decimal('estimated_cost', 18, 8).nullable()
      table.string('currency', 10).notNullable().defaultTo('USD')
      table.integer('latency_ms').nullable()
      table.string('error_category', 80).nullable()
      table.timestamp('occurred_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'occurred_at'])
      table.index(['organization_id', 'connection_id'])
      table.index(['pricing_snapshot_id'])
    })
  }

  async down() {
    this.schema.dropTable('ai_model_usage_snapshots')
    this.schema.dropTable('ai_model_pricing_snapshots')
    this.schema.dropTable('ai_model_catalog_snapshots')
  }
}
