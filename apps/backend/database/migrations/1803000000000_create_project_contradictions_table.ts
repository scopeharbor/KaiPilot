import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * project_contradictions 表：V2 TRIZ 矛盾模型基础层（v2-triz-contradiction-model-foundation D5）。
 *
 * 每条记录是一条「改善项 ↔ 恶化项」（technical）或「同参数对立要求」（physical）的结构化矛盾。
 * 组织 + 项目双隔离；只存低敏证据摘要与 hash，禁止存完整 prompt/输出/敏感正文。
 * 输入签名 + output hash + rule_version 保证幂等可追溯；按 dedupe_key 合并去重。
 */
export default class extends BaseSchema {
  protected tableName = 'project_contradictions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

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

      // 稳定 key（记录身份）与 dedupe_key（按逻辑矛盾幂等合并）
      table.string('key', 120).notNullable()
      table.string('dedupe_key', 120).notNullable()

      // 矛盾类型与规则
      table.string('type', 20).notNullable()
      table.check("type IN ('technical','physical')")
      table.string('rule_id', 20).notNullable()
      table.string('rule_version', 20).notNullable().defaultTo('1.0.0')

      // technical：改善/恶化参数对
      table.string('improving_parameter_key', 60).nullable()
      table.string('worsening_parameter_key', 60).nullable()
      table.text('improving_direction').nullable()
      table.text('worsening_direction').nullable()

      // physical：对立参数与两个要求
      table.string('parameter_key', 60).nullable()
      table.text('requirement_a').nullable()
      table.text('requirement_b').nullable()

      // 严重度 / 置信度 / 中文低敏标题
      table.string('severity', 20).notNullable().defaultTo('medium')
      table.check("severity IN ('critical','high','medium','low')")
      table.decimal('confidence', 4, 3).notNullable().defaultTo(0)
      table.text('title').notNullable().defaultTo('')

      // 低敏证据 JSON 数组与候选原理建议 JSON 数组
      table.json('evidence').notNullable().defaultTo('[]')
      table.json('suggested_principles').notNullable().defaultTo('[]')

      // 可追溯性：输入签名 / output hash
      table.string('input_signature', 64).notNullable()
      table.string('output_hash', 64).nullable()

      // 状态机 + 过期标记
      table.string('status', 20).notNullable().defaultTo('draft')
      table.check("status IN ('draft','confirmed','dismissed','superseded')")
      table.boolean('stale').notNullable().defaultTo(false)
      table.text('stale_reason').nullable()

      // 可选关联变更请求（单方向引用，不改动既有变更请求表）
      table
        .bigInteger('related_change_request_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('change_requests')
        .onDelete('SET NULL')

      // 确认人/时间
      table
        .bigInteger('confirmed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('confirmed_at').nullable()

      // 忽略人/时间/理由
      table
        .bigInteger('dismissed_by')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')
      table.timestamp('dismissed_at').nullable()
      table.text('dismiss_reason').nullable()

      // AI 解释草稿 JSON（待审核；不存完整 prompt/输出）
      table.json('ai_explanation').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // 索引：组织+项目+状态（列表/摘要）、dedupe_key（幂等合并）、稳定 key
      table.index(['organization_id', 'project_id', 'status'], 'idx_pc_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'dedupe_key', 'status'],
        'idx_pc_org_project_dedupe_status',
      )
      table.index(['organization_id', 'project_id', 'key'], 'idx_pc_org_project_key')
      table.index(['stale'], 'idx_pc_stale')
    })
  }

  // SQLite 索引/表回滚幂等：dropTableIfExists 避免重复回滚报错。
  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
