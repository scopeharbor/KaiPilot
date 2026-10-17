import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * triz_innovation_schemes 表：V3 TRIZ 创新工作台方案持久化（v3-triz-innovation-workbench §2.1）。
 *
 * 一行 = 用户在工作台篮子里的一个方案（InnovationScheme）。
 * options/scores/impact/warnings/narrative 作为 JSON payload 存储（均为低敏 refs/hash/summary）。
 * 组织 + 项目双隔离；scheme_id 在 org+project 内唯一；handoff 用 idempotency_key 幂等。
 * 禁止存完整 prompt、完整模型输出、API Key 或敏感证据正文。
 * 工作台不写正式业务表；此表仅保存审查/评审状态与候选 handoff 元数据。
 */
export default class extends BaseSchema {
  protected tableName = 'triz_innovation_schemes'

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

      // 方案稳定身份（org+project 内唯一）
      table.string('scheme_id', 120).notNullable()
      table.string('name', 200).notNullable()

      // 状态机 + 评审状态
      table.string('status', 20).notNullable().defaultTo('open')
      table.check("status IN ('open','abandoned','handed_off')")
      table.string('review_state', 20).notNullable().defaultTo('pending')
      table.check("review_state IN ('pending','reviewed','needs_changes')")

      // 方案 hash（来源聚合，幂等与 stale 判定）
      table.string('scheme_hash', 80).notNullable()

      // Handoff 元数据（候选 Draft Layer 入口）
      table.string('handoff_status', 20).notNullable().defaultTo('none')
      table.check("handoff_status IN ('none','candidate_created','stale','handed_off')")
      table.string('draft_session_ref', 120).nullable()
      table.string('idempotency_key', 120).nullable()

      // 完整方案 JSON（低敏：refs/hash/summary/status/warnings；禁止存正文/密钥）
      table.json('payload').notNullable()

      // 创建人 / 评审 / 废弃
      table
        .bigInteger('created_by')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
      table.timestamp('reviewed_at').nullable()
      table.timestamp('abandoned_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // org+project+scheme_id 唯一
      table.unique(['organization_id', 'project_id', 'scheme_id'], 'uq_innov_org_project_scheme')
      // 列表/摘要索引
      table.index(['organization_id', 'project_id', 'status'], 'idx_innov_org_project_status')
      table.index(
        ['organization_id', 'project_id', 'handoff_status'],
        'idx_innov_org_project_handoff',
      )
      table.index(['idempotency_key'], 'idx_innov_idempotency')
    })
  }

  // SQLite 索引/表回滚幂等：dropTableIfExists 避免重复回滚报错。
  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
