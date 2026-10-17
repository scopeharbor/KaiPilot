import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'risks'

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

      table.string('risk_code', 50).nullable()
      table.string('title', 255).notNullable()
      table.text('description').notNullable()

      // 类别八枚举
      table.string('category', 20).notNullable().defaultTo('other')
      table.check(
        "category IN ('technical','schedule','cost','resource','external','organizational','legal','other')",
      )

      // 概率×影响×得分
      table.integer('probability').notNullable().defaultTo(3)
      table.integer('impact').notNullable().defaultTo(3)
      table.integer('score').notNullable().defaultTo(9)

      // 六状态生命周期
      table.string('status', 20).notNullable().defaultTo('identified')
      table.check(
        "status IN ('identified','analyzing','mitigating','resolved','accepted','closed')",
      )

      // 缓解策略域
      table.text('mitigation_strategy').nullable()
      table.text('contingency_plan').nullable()
      table
        .bigInteger('owner_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.string('trigger_event', 255).nullable()

      // 残余风险评估
      table.integer('residual_probability').nullable()
      table.integer('residual_impact').nullable()
      table.integer('residual_score').nullable()

      // 时间域
      table.date('identified_at').notNullable()
      table.date('target_resolution_date').nullable()
      table.date('resolved_at').nullable()

      // 关联任务
      table
        .bigInteger('related_task_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('tasks')
        .onDelete('SET NULL')

      // AI 元数据（JSON，TEXT 存储）
      table.text('ai_metadata').nullable()

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

      // 索引
      table.index(['organization_id', 'project_id', 'deleted_at'])
      table.index(['project_id', 'score'])
      table.index(['project_id', 'probability', 'impact'])
      table.index(['project_id', 'status'])
      table.index(['related_task_id'])
      table.index(['owner_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
