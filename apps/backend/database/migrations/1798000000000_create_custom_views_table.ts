import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * custom_views 表：V2 项目级自定义视图（v2-custom-views-view-config）。
 *
 * 设计原则（D1）：
 * - 新增 `custom_views` 表，不复用 `view_preferences`
 * - 个人视图仅 owner 可见和管理；共享视图对同项目有查看权限的成员可见
 * - 组织隔离：organization_id + project_id 双重边界
 * - 软删除：删除时清理默认引用，不清除正式项目数据
 */
export default class extends BaseSchema {
  protected tableName = 'custom_views'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目隔离
      table.bigInteger('organization_id').unsigned().notNullable().index()
      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 所有者
      table
        .bigInteger('owner_user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 视图属性
      table.string('name', 100).notNullable()
      table
        .enum('base_view_type', ['kanban', 'list', 'calendar', 'gantt', 'wbs', 'resource'] as const)
        .notNullable()
      table
        .enum('visibility', ['personal', 'shared'] as const)
        .notNullable()
        .defaultTo('personal')

      // 配置 JSON（白名单校验在 Service/Validator 层）
      table.json('config_json').notNullable()

      // 配置版本
      table.integer('schema_version').unsigned().notNullable().defaultTo(1)

      // 排序与默认
      table.integer('position').unsigned().notNullable().defaultTo(0)
      table.boolean('is_default').notNullable().defaultTo(false)

      // 审计时间戳
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()

      // 软删除
      table.timestamp('deleted_at', { useTz: false }).nullable()
    })

    // 复合索引
    const isSqlite = this.db.dialect.name === 'sqlite3' || this.db.dialect.name === 'better-sqlite3'
    const isDefaultPredicate = isSqlite ? 'is_default = 1' : 'is_default = true'
    this.schema.raw(
      `CREATE INDEX idx_custom_views_org_project ON ${this.tableName} (organization_id, project_id)`,
    )
    this.schema.raw(
      `CREATE INDEX idx_custom_views_owner ON ${this.tableName} (owner_user_id, project_id)`,
    )
    this.schema.raw(
      `CREATE UNIQUE INDEX idx_custom_views_default ON ${this.tableName} (owner_user_id, project_id) WHERE ${isDefaultPredicate} AND deleted_at IS NULL`,
    )
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
