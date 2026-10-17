/**
 * v2-context-compiler-artifact-store —— 扩展 compiler_artifacts kind 枚举与 envelope 字段（tasks 2.2/2.3）。
 *
 * 在现有迁移基础上：
 * - 扩展 kind 枚举允许新运行态 artifact 类型
 * - 新增 artifactId, content_hash, idempotency_key, summary_level 列
 *
 * SQLite 不直接支持 ALTER TABLE DROP CHECK，故采用 recreate 策略。
 * 此为 V2 编译器运行态表，非 V1 正式业务表，dev 环境安全。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

const OLD_TABLE = 'compiler_artifacts'
const NEW_TABLE = 'compiler_artifacts_v2'
const BACKUP_TABLE = 'compiler_artifacts_old'

export default class extends BaseSchema {
  async up() {
    // 1. 创建新表（扩展 kind + 新增 envelope 字段）
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
        "kind IN ('pdm','manifest','ledger','stage_output','checkpoint','contract','context_packet','model_output','validation_feedback','artifact_summary')",
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
      table.index(['idempotency_key'], 'idx_compiler_artifacts_idempotency')
      table.index(['kind', 'stage_id'], 'idx_compiler_artifacts_kind_stage')
    })

    // 2. 复制旧数据到新表（payload 内已有 kind/version 兼容旧记录）
    this.schema.raw(`
      INSERT INTO ${NEW_TABLE} (id, compiler_run_id, organization_id, kind, stage_id, version, payload, created_at, updated_at)
      SELECT id, compiler_run_id, organization_id, kind, stage_id, version, payload, created_at, updated_at
      FROM ${OLD_TABLE}
    `)

    // 3. 备份旧表
    this.schema.raw(`ALTER TABLE ${OLD_TABLE} RENAME TO ${BACKUP_TABLE}`)

    // 4. 新表正式命名
    this.schema.raw(`ALTER TABLE ${NEW_TABLE} RENAME TO ${OLD_TABLE}`)
  }

  async down() {
    // 还原步骤
    this.schema.raw(`ALTER TABLE ${OLD_TABLE} RENAME TO ${NEW_TABLE}`)
    this.schema.raw(`ALTER TABLE ${BACKUP_TABLE} RENAME TO ${OLD_TABLE}`)
    this.schema.dropTableIfExists(NEW_TABLE)
  }
}
