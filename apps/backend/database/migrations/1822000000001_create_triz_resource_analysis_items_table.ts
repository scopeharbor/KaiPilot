import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_resource_analysis_items 表：V3 TRIZ 资源分析资源快照（v3-triz-resource-analyzer §3.1）。
 *
 * 每条记录是一个资源快照——从授权来源收集并分类的资源条目。
 * 包含资源种类、系统作用域、可用性、利用状态、约束与度量。
 * 组织+项目双隔离；关联 run_id 确保一致性。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_resource_analysis_items'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 关联分析运行
      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_resource_analysis_runs')
        .onDelete('CASCADE')

      // 组织/项目归属（双隔离）
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

      // 资源标识与分类
      table.string('resource_key', 80).notNullable()
      table.string('label', 255).notNullable()
      table.string('resource_kind', 30).notNullable()
      table.string('system_scope', 30).notNullable()
      table.string('origin', 30).notNullable()

      // 可用性与利用状态
      table.string('availability', 20).notNullable()
      table.string('utilization_state', 30).notNullable()
      table.float('utilization_rate').nullable()
      table.float('accessibility').nullable()
      table.string('cost_rating', 10).nullable().defaultTo('unknown')
      table.string('capacity', 255).nullable()

      // JSON 字段
      table.json('source_refs_json').notNullable().defaultTo('[]')
      table.json('source_hashes_json').notNullable().defaultTo('{}')
      table.json('metrics_json').notNullable().defaultTo('{}')
      table.json('constraint_codes_json').notNullable().defaultTo('[]')
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引（trai = triz resource analysis items）
      table.index(['organization_id', 'project_id', 'resource_key'], 'idx_trai_org_project_key')
      table.index(['run_id', 'resource_key'], 'idx_trai_run_key')
      table.index(['organization_id', 'project_id', 'resource_kind'], 'idx_trai_org_project_kind')
      table.index(['organization_id', 'project_id', 'origin'], 'idx_trai_org_project_origin')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
