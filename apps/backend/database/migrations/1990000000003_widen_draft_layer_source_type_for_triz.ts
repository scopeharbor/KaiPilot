import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-triz-to-delivery-closed-loop —— 放宽 `ai_draft_layer_sessions.source_type` CHECK
 * 追加 `'v3_triz_candidate'`（G-1 缺口收口：TRIZ 候选物化为真实草案层会话）。
 *
 * 沿用 1839800000000 的「新建 + 拷贝 + 换名」重建先例（SQLite 不支持 ALTER CHECK）；
 * 既有行零变化。down 删除 TRIZ 会话行（本 change 前 TRIZ 会话不存在，等价 no-op）。
 */
export default class extends BaseSchema {
  // 表重建需手动 PRAGMA foreign_keys=OFF（SQLite 不支持事务内切换外键强制）
  public static disableTransactions = true

  async up() {
    const client = this.db.dialect.name
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        await this.db.rawQuery(`
          CREATE TABLE ai_draft_layer_sessions__new (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            source_type VARCHAR(20) NOT NULL,
            compiler_run_id INTEGER NULL,
            pdm_artifact_id VARCHAR(200) NULL,
            pdm_hash VARCHAR(64) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            version INTEGER NOT NULL DEFAULT 1,
            expires_at DATETIME NULL,
            summary JSON NULL,
            metadata JSON NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            CHECK (source_type IN ('v2_compiler_pdm','v3_copilot_action','v3_triz_candidate')),
            CHECK (status IN ('active','previewing','reviewing','applying','applied','discarded','expired')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (compiler_run_id) REFERENCES compiler_runs(id) ON DELETE SET NULL
          )
        `)
        await this.db.rawQuery(`
          INSERT INTO ai_draft_layer_sessions__new (
            id, organization_id, created_by_user_id, source_type, compiler_run_id,
            pdm_artifact_id, pdm_hash, status, version, expires_at,
            summary, metadata, created_at, updated_at
          )
          SELECT
            id, organization_id, created_by_user_id, source_type, compiler_run_id,
            pdm_artifact_id, pdm_hash, status, version, expires_at,
            summary, metadata, created_at, updated_at
          FROM ai_draft_layer_sessions
        `)
        await this.db.rawQuery('DROP TABLE ai_draft_layer_sessions')
        await this.db.rawQuery(
          'ALTER TABLE ai_draft_layer_sessions__new RENAME TO ai_draft_layer_sessions',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_organization_id_index ON ai_draft_layer_sessions (organization_id)',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_organization_id_status_index ON ai_draft_layer_sessions (organization_id, status)',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_compiler_run_id_index ON ai_draft_layer_sessions (compiler_run_id)',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_created_by_user_id_index ON ai_draft_layer_sessions (created_by_user_id)',
        )
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      await this.db.rawQuery(
        'ALTER TABLE ai_draft_layer_sessions DROP CONSTRAINT IF EXISTS ai_draft_layer_sessions_source_type_check',
      )
      await this.db.rawQuery(`
        ALTER TABLE ai_draft_layer_sessions ADD CONSTRAINT ai_draft_layer_sessions_source_type_check
        CHECK (source_type IN ('v2_compiler_pdm','v3_copilot_action','v3_triz_candidate'))
      `)
    }
  }

  async down() {
    const client = this.db.dialect.name
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        await this.db.rawQuery(
          "DELETE FROM ai_draft_layer_sessions WHERE source_type = 'v3_triz_candidate'",
        )
        await this.db.rawQuery(`
          CREATE TABLE ai_draft_layer_sessions__old (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL,
            created_by_user_id INTEGER NOT NULL,
            source_type VARCHAR(20) NOT NULL,
            compiler_run_id INTEGER NULL,
            pdm_artifact_id VARCHAR(200) NULL,
            pdm_hash VARCHAR(64) NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            version INTEGER NOT NULL DEFAULT 1,
            expires_at DATETIME NULL,
            summary JSON NULL,
            metadata JSON NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            CHECK (source_type IN ('v2_compiler_pdm','v3_copilot_action')),
            CHECK (status IN ('active','previewing','reviewing','applying','applied','discarded','expired')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (compiler_run_id) REFERENCES compiler_runs(id) ON DELETE SET NULL
          )
        `)
        await this.db.rawQuery(`
          INSERT INTO ai_draft_layer_sessions__old (
            id, organization_id, created_by_user_id, source_type, compiler_run_id,
            pdm_artifact_id, pdm_hash, status, version, expires_at,
            summary, metadata, created_at, updated_at
          )
          SELECT
            id, organization_id, created_by_user_id, source_type, compiler_run_id,
            pdm_artifact_id, pdm_hash, status, version, expires_at,
            summary, metadata, created_at, updated_at
          FROM ai_draft_layer_sessions
        `)
        await this.db.rawQuery('DROP TABLE ai_draft_layer_sessions')
        await this.db.rawQuery(
          'ALTER TABLE ai_draft_layer_sessions__old RENAME TO ai_draft_layer_sessions',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_organization_id_index ON ai_draft_layer_sessions (organization_id)',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_organization_id_status_index ON ai_draft_layer_sessions (organization_id, status)',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_compiler_run_id_index ON ai_draft_layer_sessions (compiler_run_id)',
        )
        await this.db.rawQuery(
          'CREATE INDEX ai_draft_layer_sessions_created_by_user_id_index ON ai_draft_layer_sessions (created_by_user_id)',
        )
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      await this.db.rawQuery(
        'ALTER TABLE ai_draft_layer_sessions DROP CONSTRAINT IF EXISTS ai_draft_layer_sessions_source_type_check',
      )
      await this.db.rawQuery(`
        ALTER TABLE ai_draft_layer_sessions ADD CONSTRAINT ai_draft_layer_sessions_source_type_check
        CHECK (source_type IN ('v2_compiler_pdm','v3_copilot_action'))
      `)
    }
  }
}
