import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-plugin-fixture-market-seed —— plugin_fixture_seed_records（tasks 3.3）。
 *
 * 最小 seed state：只记录 catalog 版本与本组织由 seed 创建的 resource refs，
 * 用于幂等 reseed 与 reset 的 provenance 白名单。它不是 registry/install 的
 * authority：release/installation 的真实状态以各自表为准；本表行可随时重建。
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_fixture_seed_records', (table) => {
      table.bigIncrements('id')

      // ── Server-owned scope ──
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // ── Catalog identity ──
      table.string('catalog_id', 120).notNullable()
      table.string('catalog_version', 20).notNullable()
      table.string('catalog_digest', 32).notNullable()
      table.string('item_id', 120).notNullable()

      // ── Created resource refs（registry authority 仍在其自身表）──
      table.string('plugin_identity', 160).notNullable()
      table.string('version', 20).notNullable()
      table.bigInteger('release_id').unsigned().nullable()
      table.bigInteger('installation_id').unsigned().nullable()
      table.string('item_digest', 32).notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // ── Idempotency & indexes ──
      table.unique(['organization_id', 'catalog_id', 'catalog_version', 'item_id'])
      table.index(['organization_id', 'catalog_version'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_fixture_seed_records')
  }
}
