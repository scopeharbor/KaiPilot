import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_function_analysis_nodes 表：V3 TRIZ 功能分析组件节点（v3-triz-function-analysis-diagram §3.1）。
 *
 * 每条记录是功能分析运行产出的一个组件节点快照。
 * 组织+项目双隔离；node_key 保证稳定引用。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_function_analysis_nodes'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 运行引用
      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('triz_function_analysis_runs')
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

      // 稳定节点 key
      table.string('node_key', 80).notNullable()

      // 低敏标签
      table.string('label', 255).notNullable()

      // 组件类型
      table.string('component_type', 30).notNullable().defaultTo('system_component')
      table.check(
        "component_type IN ('system_component','supersystem_component','user_supplied','inferred')",
      )

      // 作用域
      table.string('scope', 20).notNullable().defaultTo('internal')
      table.check("scope IN ('internal','external','environment')")

      // 节点状态
      table.string('node_status', 20).notNullable().defaultTo('active')
      table.check("node_status IN ('active','deprecated','external')")

      // 来源 refs JSON（低敏摘要）
      table.json('source_refs_json').notNullable().defaultTo('[]')
      // 来源 hashes JSON
      table.json('source_hashes_json').notNullable().defaultTo('{}')
      // 指标 JSON（入度/出度/权重）
      table.json('metrics_json').notNullable().defaultTo('{}')
      // 布局位置 JSON
      table.json('position_json').nullable()
      // 警告代码 JSON
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'node_key'], 'idx_tfan_org_project_key')
      table.index(['run_id', 'node_key'], 'idx_tfan_run_key')
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_tfan_org_project_created')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
