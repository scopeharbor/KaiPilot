/**
 * v3-plugin-private-registry-lifecycle —— Plugin Private Registry Entries & Releases 表
 * （task 3.1）。
 *
 * 组织级隔离：organization_id 必填 + 索引。
 * 红线：entries 只存目录索引与推荐指针，不存包 blob、secret、完整 manifest。
 * releases 只存不可变引用与 digest，同版本 digest 冲突由唯一约束拒绝。
 * SQLite 兼容 + PG 兼容。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // ---- Releases (created first so entries can FK to it) ----
    this.schema.createTable('plugin_private_registry_releases', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('plugin_identity', 200).notNullable()
      table.string('version', 50).notNullable()

      // Digest triple
      table.string('package_digest', 200).notNullable()
      table.string('manifest_digest', 200).notNullable()
      table.string('compatibility_digest', 200).notNullable()

      // Upstream receipt reference (hash only)
      table.string('upstream_receipt_ref', 200).notNullable()

      // Status
      table.string('status', 30).notNullable().defaultTo('draft')
      table.check(
        "status IN ('draft','pending_review','approved','rejected','deprecated','withdrawn')",
      )

      // Low-sensitive metadata (JSON, no secrets)
      table.json('metadata').nullable()

      table.integer('row_version').notNullable().defaultTo(1)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 组织内 (plugin_identity, version) 唯一
      // （自动名 79 字节超 PG 63-byte 上限，与下方两个索引截断后三方撞名 → 显式短名，
      //   v3-docker-compose-runtime-foundation 第七轮审计）
      table.unique(
        ['organization_id', 'plugin_identity', 'version'],
        'uq_ppr_releases_org_plugin_version',
      )
      table.index(['organization_id', 'plugin_identity'], 'idx_ppr_releases_org_plugin')
      table.index(['organization_id', 'status'])
      table.index(
        ['organization_id', 'plugin_identity', 'status'],
        'idx_ppr_releases_org_plugin_status',
      )
    })

    // ---- Entries ----
    this.schema.createTable('plugin_private_registry_entries', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('plugin_identity', 200).notNullable()
      table.string('plugin_name', 200).notNullable()

      table
        .bigInteger('recommended_release_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('plugin_private_registry_releases')
        .onDelete('SET NULL')

      table.string('recommended_version', 50).nullable()

      table.integer('row_version').notNullable().defaultTo(1)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 组织内 plugin identity 唯一（自动名 70/69 字节截断后撞名 → 显式短名，同上）
      table.unique(['organization_id', 'plugin_identity'], 'uq_ppr_entries_org_plugin')
      table.index(['organization_id'])
      table.index(['organization_id', 'plugin_identity'], 'idx_ppr_entries_org_plugin')
    })
  }

  async down() {
    // entries.recommended_release_id 外键指向 releases：须先删 entries。
    // SQLite 不拦截该顺序，PostgreSQL 会以「other objects depend on it」拒绝 drop。
    this.schema.dropTable('plugin_private_registry_entries')
    this.schema.dropTable('plugin_private_registry_releases')
  }
}
