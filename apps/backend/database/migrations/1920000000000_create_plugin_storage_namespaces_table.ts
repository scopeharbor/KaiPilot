/**
 * v3-plugin-scoped-storage —— plugin_storage_namespaces 表（任务 2.1）。
 *
 * namespace = 插件 × 组织 × scope（organization|project）的隔离与配额单元（design D1）：
 * - 绑定 installation（enabled 安装态是 runtime 访问的前提，spec Requirement 1）；
 * - status 承载生命周期：active / read-only / orphaned / pending-deletion（design D4）；
 * - quota/usage 冗余在行内，写入同事务更新（design D3）；
 * - row_version 乐观锁保护配额计数的并发更新。
 *
 * 唯一性：组织内 (scope, project_id, plugin_id)。organization scope 的 project_id 为 NULL，
 * SQLite/PG 的唯一约束对 NULL 不去重，故用 partial unique index（两者均支持）：
 * - org 唯一：(organization_id, plugin_id) WHERE scope='organization' AND project_id IS NULL
 * - project 唯一：(organization_id, project_id, plugin_id) WHERE scope='project'
 * SQLite 兼容 + PG 兼容（PostgreSQL 可移植性由 partial index 语法保证）。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_storage_namespaces', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // organization scope 时为 NULL
      table
        .bigInteger('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      table.string('plugin_id', 200).notNullable()
      table.string('plugin_version', 50).notNullable()

      // 绑定安装记录（安装记录卸载为软删除，永不物理删除，故无级联问题）
      table
        .bigInteger('installation_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('plugin_installations')

      // scope：organization / project
      table.string('scope', 20).notNullable()
      table.check("scope IN ('organization', 'project')")

      // 生命周期：active（可读写）/ read-only（停用）/ orphaned（卸载保留期）/ pending-deletion
      table.string('status', 30).notNullable().defaultTo('active')
      table.check("status IN ('active', 'read-only', 'orphaned', 'pending-deletion')")

      // 配额（默认值来自共享契约 PLUGIN_STORAGE_LIMITS）
      table.bigInteger('quota_bytes').notNullable().defaultTo(524288)
      table.bigInteger('used_bytes').notNullable().defaultTo(0)
      table.integer('quota_entries').notNullable().defaultTo(256)
      table.integer('used_entries').notNullable().defaultTo(0)

      // 乐观锁行版本（namespace 级 CAS，保护配额计数）
      table.integer('row_version').notNullable().defaultTo(1)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 卸载进入 orphaned 的时间与保留期截止时间
      table.timestamp('orphaned_at').nullable()
      table.timestamp('retention_until').nullable()

      // 一次性清理确认句柄绑定（preview 写入、confirm 消费后随行删除）
      table.string('cleanup_handle_digest', 64).nullable()
      table.timestamp('cleanup_handle_expires_at').nullable()

      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'plugin_id'])
    })

    // 部分唯一索引：org scope 与 project scope 各自保证组织内插件唯一
    this.schema.raw(
      "CREATE UNIQUE INDEX uq_plugin_storage_ns_org ON plugin_storage_namespaces (organization_id, plugin_id) WHERE scope = 'organization' AND project_id IS NULL",
    )
    this.schema.raw(
      "CREATE UNIQUE INDEX uq_plugin_storage_ns_project ON plugin_storage_namespaces (organization_id, project_id, plugin_id) WHERE scope = 'project' AND project_id IS NOT NULL",
    )
  }

  async down() {
    this.schema.raw('DROP INDEX IF EXISTS uq_plugin_storage_ns_org')
    this.schema.raw('DROP INDEX IF EXISTS uq_plugin_storage_ns_project')
    this.schema.dropTable('plugin_storage_namespaces')
  }
}
