/**
 * v2-5-compiler-run-executor-wiring —— 为 compiler_runs 状态增加 queued。
 *
 * design D2：先持久化 run identity（queued），再异步推进（running）。
 * SQLite 不支持 ALTER TABLE ADD CHECK，故重建表。
 * 此迁移与既有 CHECK 兼容：只添加 queued 到允许列表，不移除任何值。
 */
import { BaseSchema } from '@adonisjs/lucid/schema'

function isSqliteDialect(dialectName: string) {
  return dialectName === 'sqlite' || dialectName === 'better-sqlite3'
}

export default class extends BaseSchema {
  async up() {
    if (!isSqliteDialect(this.db.dialect.name)) {
      await this.db.rawQuery(`
        ALTER TABLE compiler_runs
        ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255)
      `)
      await this.db.rawQuery(`
        ALTER TABLE compiler_runs
        ADD COLUMN IF NOT EXISTS input_hash VARCHAR(64)
      `)
      await this.db.rawQuery(`
        ALTER TABLE compiler_runs DROP CONSTRAINT IF EXISTS compiler_runs_status_check
      `)
      await this.db.rawQuery(`
        ALTER TABLE compiler_runs ADD CONSTRAINT compiler_runs_status_check
        CHECK (status IN ('pending','queued','running','paused','completed','failed','cancelled','needs_human_review'))
      `)
      await this.db.rawQuery(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_compiler_runs_idempotency
        ON compiler_runs(organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      `)
      return
    }

    this.schema.raw('DROP TABLE IF EXISTS compiler_runs_tmp')
    this.schema.raw(`
      CREATE TABLE compiler_runs_tmp (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        requested_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','queued','running','paused','completed','failed','cancelled','needs_human_review')),
        current_phase VARCHAR(30),
        current_stage VARCHAR(60),
        input JSON NOT NULL,
        error JSON,
        idempotency_key VARCHAR(255),
        input_hash VARCHAR(64),
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME NOT NULL,
        updated_at DATETIME,
        CHECK (organization_id IS NOT NULL),
        CHECK (requested_by_user_id IS NOT NULL)
      )
    `)
    // 复制旧数据（idempotency_key 和 input_hash 在旧表可能不存在，用 NULL 填充）
    this.schema.raw(`
      INSERT INTO compiler_runs_tmp (
        id, organization_id, requested_by_user_id, status,
        current_phase, current_stage, input, error,
        started_at, completed_at, created_at, updated_at
      )
      SELECT
        id, organization_id, requested_by_user_id, status,
        current_phase, current_stage, input, error,
        started_at, completed_at, created_at, updated_at
      FROM compiler_runs
    `)
    this.schema.raw('DROP TABLE compiler_runs')
    this.schema.raw('ALTER TABLE compiler_runs_tmp RENAME TO compiler_runs')
    this.schema.raw(`
      CREATE INDEX idx_compiler_runs_org ON compiler_runs(organization_id)
    `)
    this.schema.raw(`
      CREATE INDEX idx_compiler_runs_org_status ON compiler_runs(organization_id, status)
    `)
    this.schema.raw(`
      CREATE INDEX idx_compiler_runs_requested_by ON compiler_runs(requested_by_user_id)
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX idx_compiler_runs_idempotency ON compiler_runs(organization_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `)
  }

  async down() {
    if (!isSqliteDialect(this.db.dialect.name)) {
      await this.db.rawQuery("UPDATE compiler_runs SET status = 'pending' WHERE status = 'queued'")
      await this.db.rawQuery('DROP INDEX IF EXISTS idx_compiler_runs_idempotency')
      await this.db.rawQuery(`
        ALTER TABLE compiler_runs DROP CONSTRAINT IF EXISTS compiler_runs_status_check
      `)
      await this.db.rawQuery(`
        ALTER TABLE compiler_runs ADD CONSTRAINT compiler_runs_status_check
        CHECK (status IN ('pending','running','paused','completed','failed','cancelled','needs_human_review'))
      `)
      await this.db.rawQuery('ALTER TABLE compiler_runs DROP COLUMN IF EXISTS input_hash')
      await this.db.rawQuery('ALTER TABLE compiler_runs DROP COLUMN IF EXISTS idempotency_key')
      return
    }

    // 回退：先转换 queued 为 pending（旧 CHECK 不允许 queued）
    this.schema.raw("UPDATE compiler_runs SET status = 'pending' WHERE status = 'queued'")
    this.schema.raw('DROP TABLE IF EXISTS compiler_runs_rollback')
    this.schema.raw(`
      CREATE TABLE compiler_runs_rollback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        requested_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','running','paused','completed','failed','cancelled','needs_human_review')),
        current_phase VARCHAR(30),
        current_stage VARCHAR(60),
        input JSON NOT NULL,
        error JSON,
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME NOT NULL,
        updated_at DATETIME,
        CHECK (organization_id IS NOT NULL),
        CHECK (requested_by_user_id IS NOT NULL)
      )
    `)
    this.schema.raw(`
      INSERT INTO compiler_runs_rollback (
        id, organization_id, requested_by_user_id, status,
        current_phase, current_stage, input, error,
        started_at, completed_at, created_at, updated_at
      )
      SELECT
        id, organization_id, requested_by_user_id, status,
        current_phase, current_stage, input, error,
        started_at, completed_at, created_at, updated_at
      FROM compiler_runs
    `)
    this.schema.raw('DROP TABLE compiler_runs')
    this.schema.raw('ALTER TABLE compiler_runs_rollback RENAME TO compiler_runs')
    this.schema.raw('CREATE INDEX idx_compiler_runs_org ON compiler_runs(organization_id)')
    this.schema.raw(
      'CREATE INDEX idx_compiler_runs_org_status ON compiler_runs(organization_id, status)',
    )
    this.schema.raw(
      'CREATE INDEX idx_compiler_runs_requested_by ON compiler_runs(requested_by_user_id)',
    )
  }
}
