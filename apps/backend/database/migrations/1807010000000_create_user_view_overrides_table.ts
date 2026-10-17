import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * user_view_overrides 表：用户视图覆盖差量存储（§2.5 P0）。
 *
 * 存储用户对视图的个人覆盖偏好（列顺序、widget 布局等），
 * 不修改共享/基础配置本身。运行时按确定性顺序合并。
 *
 * 设计原则：
 * - 差量存储：每条记录是一个 JSON Pointer + value
 * - 不覆写 base config
 * - 支持重置（删除该用户该视图的所有覆盖）
 */
export default class extends BaseSchema {
  protected tableName = 'user_view_overrides'

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

      // 用户
      table
        .bigInteger('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 目标视图（custom_views.id）
      table
        .bigInteger('view_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('custom_views')
        .onDelete('CASCADE')

      // 覆盖差量：JSON Pointer 路径 + 值
      table.string('override_path', 500).notNullable()
      table.json('override_value').notNullable()

      // 元数据
      table.integer('schema_version').unsigned().notNullable().defaultTo(1)

      // 审计时间戳
      table.timestamp('created_at', { useTz: false }).notNullable()
      table.timestamp('updated_at', { useTz: false }).nullable()
    })

    // 复合索引
    this.schema.raw(
      `CREATE INDEX idx_uv_org_project ON ${this.tableName} (organization_id, project_id)`,
    )
    this.schema.raw(`CREATE INDEX idx_uv_user_view ON ${this.tableName} (user_id, view_id)`)
    this.schema.raw(
      `CREATE UNIQUE INDEX idx_uv_user_view_path ON ${this.tableName} (user_id, view_id, override_path)`,
    )
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
