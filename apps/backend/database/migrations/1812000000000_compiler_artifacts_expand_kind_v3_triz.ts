/**
 * v3-triz-innovation-workbench —— 扩展 compiler_artifacts kind 枚举（补齐 TRIZ kinds）。
 *
 * v2-triz-compiler-analysis-layer / v2-triz-ai-clarification-cards 在 TS ArtifactKind 类型里
 * 声明了 `triz_analysis_artifact` 与 `triz_clarification_artifact`，但未补齐 DB CHECK 约束，
 * 导致这两类 artifact 实际无法落库（SQLite CHECK 直接拒绝）。本变更（工作台需读取 TRIZ analysis
 * artifact）将其补入 CHECK，recreate 策略与 1796030000000 一致。
 *
 * SQLite 不直接支持 ALTER TABLE DROP CHECK，故采用 recreate 策略。
 * 此为编译器运行态表，非 V1 正式业务表，dev/test 环境安全。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

const TABLE_NAME = 'compiler_artifacts'
const BACKUP_TABLE = 'compiler_artifacts_v3_backup'
const NEW_TABLE = 'compiler_artifacts_v3_expanded'

export default class extends BaseSchema {
  async up() {
    // 1. 创建新表（补齐 triz_analysis_artifact / triz_clarification_artifact）
    this.schema.createTable(NEW_TABLE, (table) => {
      table.bigIncrements('id')

      table
        .bigInteger('compiler_run_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('compiler_runs')
        .onDelete('CASCADE')
      table
        .bigInteger('organization_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('kind', 40).notNullable()
      table.check(
        "kind IN ('pdm','manifest','ledger','stage_output','checkpoint','contract','context_packet','model_output','validation_feedback','artifact_summary','observability_event','cost_event','budget_decision','budget_policy','triz_analysis_artifact','triz_clarification_artifact')",
      )

      table.string('stage_id', 60).nullable()
      table.string('artifactId', 120).nullable().index()
      table.integer('version').unsigned().notNullable().defaultTo(1)
      table.string('content_hash', 64).nullable()
      table.string('idempotency_key', 120).nullable()
      table.string('summary_level', 10).nullable().defaultTo('full')

      table.json('payload').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['compiler_run_id'])
      table.index(['organization_id'])
      table.index(['compiler_run_id', 'kind'])
      table.index(['compiler_run_id', 'kind', 'version'])
      table.index(['idempotency_key'], 'idx_compiler_artifacts_v3_idempotency')
      table.index(['kind', 'stage_id'], 'idx_compiler_artifacts_v3_kind_stage')
    })

    // 2. 复制旧数据到新表
    this.schema.raw(`
      INSERT INTO ${NEW_TABLE} (id, compiler_run_id, organization_id, kind, stage_id, "artifactId", version, content_hash, idempotency_key, summary_level, payload, created_at, updated_at)
      SELECT id, compiler_run_id, organization_id, kind, stage_id, "artifactId", version, content_hash, idempotency_key, summary_level, payload, created_at, updated_at
      FROM ${TABLE_NAME}
    `)

    // 3. 备份旧表
    this.schema.raw(`ALTER TABLE ${TABLE_NAME} RENAME TO ${BACKUP_TABLE}`)

    // 4. 新表正式命名
    this.schema.raw(`ALTER TABLE ${NEW_TABLE} RENAME TO ${TABLE_NAME}`)
  }

  async down() {
    this.schema.raw(`ALTER TABLE ${TABLE_NAME} RENAME TO ${NEW_TABLE}`)
    this.schema.raw(`ALTER TABLE ${BACKUP_TABLE} RENAME TO ${TABLE_NAME}`)
    this.schema.dropTableIfExists(NEW_TABLE)
  }
}
