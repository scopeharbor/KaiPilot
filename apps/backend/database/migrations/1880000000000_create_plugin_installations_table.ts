/**
 * v3-skill-as-plugin-adapter —— Plugin Installations 表（W2b 安装生命周期）。
 *
 * 组织级隔离：organization_id 必填 + 索引。
 * 状态机：installed（未启用）/ enabled（已启用）/ uninstalled（已卸载）。
 * 权限确认：enable 转移时同事务记录权限清单确认摘要（JSON）。
 * 组织内 (organization_id, plugin_id) 唯一。
 * SQLite 兼容 + PG 兼容。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('plugin_installations', (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('plugin_id', 200).notNullable()
      table.string('version', 50).notNullable()

      table.bigInteger('release_id').unsigned().notNullable()

      // 状态：installed / enabled / uninstalled
      table.string('status', 30).notNullable().defaultTo('installed')
      table.check("status IN ('installed', 'enabled', 'uninstalled')")

      // 权限确认摘要（JSON: confirmedBy, permissionDigest, permissionKeys, confirmedAt）
      table.json('permission_confirmation').nullable()

      // 完整性与摘要
      table.string('package_digest', 200).notNullable()
      table.string('manifest_digest', 200).notNullable()
      table.string('compatibility_digest', 200).notNullable()

      // 乐观锁行版本
      table.integer('row_version').notNullable().defaultTo(1)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('uninstalled_at').nullable()

      // 组织内 plugin_id 唯一
      table.unique(['organization_id', 'plugin_id'])
      table.index(['organization_id'])
      table.index(['organization_id', 'status'])
      table.index(['organization_id', 'plugin_id', 'status'])
    })
  }

  async down() {
    this.schema.dropTable('plugin_installations')
  }
}
