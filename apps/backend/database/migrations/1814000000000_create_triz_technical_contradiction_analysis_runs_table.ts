import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_technical_contradiction_analysis_runs 表：V3 TRIZ 技术矛盾分析运行（v3-triz-technical-contradiction-analyzer §3.1）。
 *
 * 每条记录是一次技术矛盾分析运行——收集输入、执行确定性规则、产出候选集。
 * 组织+项目双隔离；input_signature + idempotency_key 保证幂等。
 * 不写入正式矛盾记录；分析运行与正式记录分离。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_technical_contradiction_analysis_runs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织/项目/操作人归属（三隔离）
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
      table
        .bigInteger('actor_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')

      // 运行状态
      table.string('status', 30).notNullable().defaultTo('queued')
      table.check(
        "status IN ('queued','completed','completed_with_warnings','failed','stale','archived')",
      )

      // 幂等与签名
      table.string('input_signature', 80).notNullable()
      table.string('output_hash', 80).nullable()
      table.string('rule_version', 20).notNullable().defaultTo('1.0.0')
      table.string('idempotency_key', 80).notNullable()

      // 来源摘要 JSON
      table.json('source_summary_json').notNullable().defaultTo('{}')
      // 警告摘要 JSON
      table.json('warning_summary_json').notNullable().defaultTo('[]')
      // 候选计数
      table.integer('candidate_count').notNullable().defaultTo(0)
      // 成本摘要 JSON（仅 AI 调用时有值）
      table.json('cost_summary_json').nullable()

      // 时间戳
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('completed_at').nullable()
      table.timestamp('archived_at').nullable()

      // 索引
      table.index(['organization_id', 'project_id', 'status'], 'idx_ttcar_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'idempotency_key'],
        'idx_ttcar_org_project_idem',
      )
      table.index(['organization_id', 'project_id', 'created_at'], 'idx_ttcar_org_project_created')
    })
  }

  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
