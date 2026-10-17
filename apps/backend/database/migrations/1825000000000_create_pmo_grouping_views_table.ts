import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-pmo-portfolio-grouping-views —— PMO 组合分组视图持久化迁移。
 *
 * 存储用户/组织的分组视图配置（低敏 query shape），不保存结果/证据。
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'pmo_grouping_views'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 唯一标识（UUID 字符串，用于 API 暴露，不泄露自增 ID）
      table.string('view_id', 64).notNullable().unique()

      // 组织隔离（红线）
      table.integer('organization_id').unsigned().notNullable()

      // 视图归属
      table.string('scope', 16).notNullable() // system | personal | organization
      table.integer('owner_user_id').unsigned().nullable()

      // 视图内容
      table.string('name', 120).notNullable()
      table.string('description', 400).nullable()
      table.string('definition_version', 32).notNullable()

      // 查询定义（JSON，低敏 query shape）
      table.json('query_definition').notNullable()

      // 默认标记
      table.integer('is_default').notNullable().defaultTo(0) // SQLite boolean
      table.integer('is_org_default').notNullable().defaultTo(0)

      // 时间戳
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 软删除
      table.timestamp('deleted_at', { useTz: true }).nullable()

      // 索引
      table.index(['organization_id', 'scope'], 'idx_pgv_org_scope')
      table.index(['organization_id', 'owner_user_id'], 'idx_pgv_org_owner')
      table.index(['organization_id', 'is_default'], 'idx_pgv_org_default')
      table.index(['organization_id', 'deleted_at'], 'idx_pgv_org_deleted')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
