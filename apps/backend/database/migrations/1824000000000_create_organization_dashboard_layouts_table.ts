import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-organization-dashboard-layout-builder —— 组织 Dashboard 布局配置迁移。
 *
 * 存储组织级 Dashboard 的布局配置：系统默认、个人、组织共享三种作用域。
 * 布局仅保存配置元数据（模块排序、尺寸、密度等），不保存业务事实。
 * SQLite + PG 兼容、可回滚。
 */
export default class extends BaseSchema {
  protected tableName = 'organization_dashboard_layouts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // 组织隔离（红线）
      table.integer('organization_id').unsigned().notNullable()

      // 作用域：system | personal | shared
      table.string('scope', 16).notNullable()

      // 个人布局的所有者（system/shared 为 null）
      table.integer('owner_actor_id').unsigned().nullable()

      // 布局名称（系统默认不可变，个人/共享可选）
      table.string('name', 128).nullable()

      // 乐观锁版本号
      table.integer('version').unsigned().notNullable().defaultTo(1)

      // 是否为该作用域下的默认布局
      table.integer('is_default').notNullable().defaultTo(0) // SQLite boolean as 0/1

      // 密度：comfortable | compact
      table.string('density', 16).notNullable().defaultTo('comfortable')

      // 模块实例列表（JSON 数组，每个元素包含 moduleKey, size, row, col, breakpoints, settings）
      table.text('modules_json').notNullable()

      // 低敏元数据
      table.text('metadata_json').nullable()

      // 时间戳
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()

      // 索引
      table.index(['organization_id', 'scope'], 'idx_odl_org_scope')
      table.index(['organization_id', 'owner_actor_id'], 'idx_odl_org_owner')
      table.unique(
        ['organization_id', 'scope', 'owner_actor_id', 'is_default'],
        'uq_odl_org_scope_default',
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
