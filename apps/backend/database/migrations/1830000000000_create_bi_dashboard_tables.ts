// v3-bi-dashboard-builder §4.1 — 创建 BI Dashboard Definition 与版本元数据表。
// 组织/PMO 级 BI Dashboard，支持 personal/shared/default/archive/version history。

import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'bi_dashboard_definitions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.integer('organization_id').unsigned().notNullable()
      table
        .string('scope')
        .notNullable()
        .defaultTo('personal')
        .comment('personal | organization_shared')
      table.integer('owner_actor_id').unsigned().nullable()
      table.string('name').notNullable()
      table.integer('version').notNullable().defaultTo(1)
      table.string('definition_hash', 64).notNullable()
      table.string('snapshot_hash', 64).notNullable()
      table.json('layout').notNullable()
      table.json('widgets').notNullable()
      table.json('global_filters').nullable()
      table.json('time_window').nullable()
      table.json('freshness_policy').nullable()
      table.boolean('is_default').notNullable().defaultTo(false)
      table.boolean('is_archived').notNullable().defaultTo(false)
      table.json('warning_summary').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 组织级索引
      table.index(['organization_id'], 'idx_bi_dash_org_id')
      // 默认看板快速查询
      table.index(['organization_id', 'is_default', 'is_archived'], 'idx_bi_dash_org_default')
      // 个人看板 owner 查询
      table.index(['organization_id', 'owner_actor_id'], 'idx_bi_dash_org_owner')
      // 组织+scope 列表
      table.index(['organization_id', 'scope', 'is_archived'], 'idx_bi_dash_org_scope')
    })

    this.schema.createTable('bi_dashboard_versions', (table) => {
      table.increments('id').primary()
      table
        .integer('dashboard_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('bi_dashboard_definitions')
        .onDelete('CASCADE')
      table.integer('organization_id').unsigned().notNullable()
      table.integer('version').notNullable()
      table.string('definition_hash', 64).notNullable()
      table.string('snapshot_hash', 64).notNullable()
      table.json('layout').notNullable()
      table.json('widgets').notNullable()
      table.json('global_filters').nullable()
      table.json('time_window').nullable()
      table.json('freshness_policy').nullable()
      table.json('warning_summary').nullable()
      table.integer('updated_by_actor_id').unsigned().nullable()
      table.string('change_note', 500).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()

      table.index(['dashboard_id'], 'idx_bi_dash_ver_dash_id')
      table.index(['dashboard_id', 'version'], 'idx_bi_dash_ver_dash_ver')
    })
  }

  async down() {
    this.schema.dropTableIfExists('bi_dashboard_versions')
    this.schema.dropTableIfExists(this.tableName)
  }
}
