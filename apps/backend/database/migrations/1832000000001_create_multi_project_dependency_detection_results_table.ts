import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * multi_project_dependency_detection_results 表：检测结果记录
 * v3-multi-project-dependency-detection / §3.1
 *
 * - organization_id 强制组织隔离
 * - 每个 result 关联一个 detection run
 * - 记录规则结果、严重度、置信度、生命周期、指纹和低敏证据
 */
export default class extends BaseSchema {
  protected tableName = 'multi_project_dependency_detection_results'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')

      // 组织隔离
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      // 关联检测批次
      table
        .bigInteger('run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('multi_project_dependency_detection_runs')
        .onDelete('CASCADE')

      // 规则标识
      table.string('rule_id', 50).notNullable()

      // 严重度与置信度
      table.string('severity', 10).notNullable()
      table.check("severity IN ('critical','high','medium','low','info')")
      table.string('confidence', 10).notNullable()
      table.check("confidence IN ('high','medium','low','uncertain')")

      // 生命周期
      table.string('status', 20).notNullable().defaultTo('open')
      table.check(
        "status IN ('open','ignored','reopened','convertedToDraft','superseded','expired')",
      )

      // 指纹（跨 run 去重）
      table.string('fingerprint', 64).notNullable()

      // 低敏理由与证据
      table.text('rationale').notNullable()
      table.text('evidence_summary').nullable()
      table.string('evidence_hash', 64).nullable()

      // 受影响的端点 hash（不存名称）
      table.json('affected_endpoint_hashes').nullable()

      // 源新鲜度
      table.json('source_freshness').nullable()

      // 警告码
      table.json('warnings').nullable()

      // 脱敏状态
      table.string('redaction_state', 10).notNullable().defaultTo('none')
      table.check("redaction_state IN ('none','partial','full')")

      // Draft bridge 资格
      table.boolean('draft_eligible').notNullable().defaultTo(false)

      // 忽略原因（hash）
      table.string('ignore_reason_hash', 64).nullable()

      // AI advisory（JSON）
      table.json('ai_advisory').nullable()

      // 时间戳
      table.timestamp('created_at').notNullable().defaultTo(this.raw('CURRENT_TIMESTAMP'))
      table.timestamp('updated_at').nullable()
      table.timestamp('expires_at').nullable()

      // 索引
      table.index(['organization_id'])
      table.index(['run_id'])
      table.index(['organization_id', 'run_id'])
      table.index(['organization_id', 'status'])
      // severity 两个索引自动名（73/84 字节）PG 63-byte 截断后撞名 → 显式短名
      // （v3-docker-compose-runtime-foundation 第七轮审计）
      table.index(['organization_id', 'severity'], 'idx_mpdr_org_severity')
      table.index(['organization_id', 'rule_id'])
      table.index(['organization_id', 'fingerprint'])
      table.index(['organization_id', 'severity', 'confidence'], 'idx_mpdr_org_severity_confidence')
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
