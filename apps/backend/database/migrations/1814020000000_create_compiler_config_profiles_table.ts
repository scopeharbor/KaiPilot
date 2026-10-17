import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v2-5-compiler-config-management-api —— Compiler Config Profiles 迁移（design D1/D2）。
 *
 * 组织级、版本化 Compiler Config Profile 实体。
 * append-only 版本行：每次写入创建不可变版本行，is_active 标记当前生效版本。
 * 三类配置以 text 存 JSON（应用层 zod 解析，不依赖 DB JSON 函数，规避 SQLite/PG 方言差异）。
 *
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'compiler_config_profiles'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离
      table.integer('organization_id').unsigned().notNullable()

      // 版本号（组织内单调递增）
      table.integer('version').unsigned().notNullable()

      // 是否当前生效版本（组织内唯一 active）
      table.boolean('is_active').notNullable().defaultTo(false)

      // 三类配置：text 存 JSON（应用层解析，不依赖 DB JSON 函数）
      table.text('feature_toggles').notNullable().defaultTo('{}')
      table.text('budget_policies').notNullable().defaultTo('[]')
      table.text('cache_policy').nullable()

      // 审计
      table.integer('created_by').unsigned().notNullable()
      table.timestamp('created_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'is_active'], 'idx_ccp_org_active')
      table.index(['organization_id', 'version'], 'idx_ccp_org_version')

      // 唯一约束：同一组织内 version 唯一
      table.unique(['organization_id', 'version'], 'idx_ccp_org_version_unique')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
