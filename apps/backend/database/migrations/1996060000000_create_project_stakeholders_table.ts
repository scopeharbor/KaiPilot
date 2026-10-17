import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-chart-gallery-data-foundation —— project_stakeholders 利害关系人登记表（W1.2）。
 *
 * - user_id → users ON DELETE SET NULL：内部用户可选绑定，外部人员为 NULL
 *   （干系人不强绑登录用户，name 始终必填作展示称谓）
 * - power_level / interest_level：权力-利益四象限评估维度（low/medium/high）
 * - attitude：supportive/neutral/resistant/leading
 * - management_strategy：manage_closely/keep_satisfied/keep_informed/monitor
 *   （与四象限自动归类互为表里，服务层可据 power/interest 推导）
 * - contact_info 联系方式 JSON（邮箱/电话/IM 等），默认 '{}'
 *
 * 方言兼容：无 `.after()`；索引显式命名（≤ PostgreSQL 63 字节）。
 */
export default class extends BaseSchema {
  protected tableName = 'project_stakeholders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table
        .bigInteger('project_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('projects')
        .onDelete('CASCADE')

      // 可选绑定的内部用户；外部干系人为 NULL
      table
        .bigInteger('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.string('name', 128).notNullable()
      table.string('organization_name', 255).nullable()
      table.string('role_title', 128).nullable()

      // internal / external
      table.string('stakeholder_type', 20).notNullable().defaultTo('internal')
      table.check("stakeholder_type IN ('internal','external')")

      // 权力-利益四象限评估
      table.string('power_level', 20).notNullable().defaultTo('medium')
      table.check("power_level IN ('low','medium','high')")
      table.string('interest_level', 20).notNullable().defaultTo('medium')
      table.check("interest_level IN ('low','medium','high')")

      // 态度与应对策略
      table.string('attitude', 20).notNullable().defaultTo('neutral')
      table.check("attitude IN ('supportive','neutral','resistant','leading')")
      table.text('expectations').nullable()
      table.string('management_strategy', 30).notNullable().defaultTo('manage_closely')
      table.check(
        "management_strategy IN ('manage_closely','keep_satisfied','keep_informed','monitor')",
      )

      // 联系方式 JSON（模型层 prepare/consume）
      table.json('contact_info').nullable().defaultTo('{}')

      // 审计
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('RESTRICT')
      table
        .bigInteger('updated_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      // 软删除 + 时间戳
      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 按策略桶聚合查询索引
      table.index(
        ['organization_id', 'project_id', 'management_strategy'],
        'idx_stakeholders_org_project_strategy',
      )
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
