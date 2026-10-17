import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_function_analysis_edges 表：V3 TRIZ 功能分析功能关系边（v3-triz-function-analysis-diagram §3.1）。
 *
 * 每条记录是功能分析运行产出的一个功能关系边快照。
 * 组织+项目双隔离；edge_key 保证稳定引用。
 * 功能类型区分 useful/harmful/insufficient/excessive。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_function_analysis_edges'

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

      // 稳定边 key
      table.string('edge_key', 80).notNullable()

      // 来源/目标节点 key
      table.string('from_node_key', 80).notNullable()
      table.string('to_node_key', 80).notNullable()

      // 功能类型
      table.string('function_type', 20).notNullable().defaultTo('useful')
      table.check("function_type IN ('useful','harmful','insufficient','excessive')")

      // 低敏标签
      table.string('label', 255).notNullable()

      // 强度与置信度
      table.decimal('strength', 4, 3).notNullable().defaultTo(0)
      table.decimal('confidence', 4, 3).notNullable().defaultTo(0)

      // 低敏证据 refs JSON
      table.json('evidence_refs_json').notNullable().defaultTo('[]')

      // 来源 hashes JSON
      table.json('source_hashes_json').notNullable().defaultTo('{}')

      // 警告代码 JSON
      table.json('warning_codes_json').notNullable().defaultTo('[]')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'edge_key'], 'idx_tfae_org_project_key')
      table.index(['run_id', 'edge_key'], 'idx_tfae_run_key')
      table.index(['run_id', 'from_node_key'], 'idx_tfae_run_from')
      table.index(['run_id', 'to_node_key'], 'idx_tfae_run_to')
      table.index(['organization_id', 'project_id', 'function_type'], 'idx_tfae_org_project_ftype')
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_tfae_org_project_created')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
