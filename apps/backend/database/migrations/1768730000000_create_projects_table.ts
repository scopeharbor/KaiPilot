import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * projects 表：系统核心实体表（sec7.1.2，约 30 字段）。
 * - organization_id → organizations ON DELETE CASCADE
 * - created_by → users ON DELETE RESTRICT；updated_by → users ON DELETE SET NULL
 * - wbs_root_id 仅建列，外键由 wbs_nodes 迁移补加（循环外键 SET NULL）
 * - 金额字段以「分」整数存储（design D7 / DEBT-01）
 */
export default class extends BaseSchema {
  protected tableName = 'projects'

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

      // 基础信息域
      table.string('name', 255).notNullable()
      table.string('code', 64).nullable()
      table.text('description').nullable()
      table.string('category', 64).nullable()

      // 状态机：draft/planning/active/on_hold/completed/cancelled/archived
      table.string('status', 20).notNullable().defaultTo('draft')
      table.check(
        "status IN ('draft','planning','active','on_hold','completed','cancelled','archived')",
      )

      // 优先级：low/medium/high/critical
      table.string('priority', 20).notNullable().defaultTo('medium')
      table.check("priority IN ('low','medium','high','critical')")

      // 日期域（计划 / 实际）
      table.date('start_date').nullable()
      table.date('end_date').nullable()
      table.date('actual_start_date').nullable()
      table.date('actual_end_date').nullable()

      // TODO-DEBT: DEBT-01 — 金额字段 V1 以「分」整数存储，规避 SQLite REAL 浮点精度风险，
      // V2 迁 PostgreSQL 改 NUMERIC(15,2)。
      table.bigInteger('budget_cents').nullable()
      table.bigInteger('actual_cost_cents').nullable()
      table.string('currency', 3).notNullable().defaultTo('CNY')

      // 进度域（0.00-100.00，任务加权自动计算）
      table.decimal('progress_percent', 5, 2).notNullable().defaultTo(0)
      // 健康度：green/yellow/red/unknown
      table.string('health_status', 20).notNullable().defaultTo('unknown')
      table.check("health_status IN ('green','yellow','red','unknown')")

      // WBS 与图表域：wbs_root_id 外键由 wbs_nodes 迁移补加（SET NULL）
      table.bigInteger('wbs_root_id').unsigned().nullable()
      // 项目级图表规格缓存（DiagramSpec）
      table.json('diagram_spec').nullable()

      // AI 域：置信度 / 模型版本 / 假设数量等
      table.json('ai_metadata').nullable()

      // 审计域
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

      table.timestamp('deleted_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：组织项目列表、甘特图日期过滤（sec7.5）
      table.index(['organization_id', 'status'])
      table.index(['start_date', 'end_date'])
      // 组织内项目编码唯一
      table.unique(['organization_id', 'code'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
