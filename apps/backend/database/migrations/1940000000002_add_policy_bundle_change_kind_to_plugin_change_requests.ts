import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * v3-plugin-policy-bundles —— 扩展 `plugin_change_requests.kind` CHECK。
 *
 * design D4：策略变更复用统一插件变更流；首期契约仅三类 kind，故由本 change
 * 以兼容扩展新增 `'policy-bundle-change'`。共享契约（PLUGIN_CHANGE_KINDS）已追加，
 * 本迁移使 SQLite CHECK 白名单与之一致。
 *
 * SQLite 不支持直接 ALTER CHECK，采用「新建 + 拷贝 + 换名」重建表（沿用
 * 1839800000000_widen_draft_layer_source_type_check 先例）；列结构、唯一键、
 * 索引、外键全部保持不变。plugin_change_decisions 的外键引用在重建期间由
 * PRAGMA foreign_keys=OFF 保护。
 */
export default class extends BaseSchema {
  // 需要手动 PRAGMA foreign_keys=OFF + 表重建（SQLite 不支持在事务内切换外键强制）
  public static disableTransactions = true

  async up() {
    const client = this.db.dialect.name
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        await this.db.rawQuery(`
          CREATE TABLE plugin_change_requests__new (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL,
            project_id INTEGER NULL,
            request_uid VARCHAR(80) NOT NULL,
            kind VARCHAR(30) NOT NULL,
            state VARCHAR(30) NOT NULL DEFAULT 'draft',
            plugin_id VARCHAR(200) NOT NULL,
            requested_by VARCHAR(64) NOT NULL,
            target_revision VARCHAR(120) NOT NULL,
            diff_json TEXT NOT NULL,
            diff_digest VARCHAR(32) NOT NULL,
            permission_digest VARCHAR(32) NOT NULL,
            compatibility_digest VARCHAR(32) NOT NULL,
            approval_required BOOLEAN NOT NULL DEFAULT 0,
            approved_by VARCHAR(64) NULL,
            handle_digest VARCHAR(32) NULL,
            handle_actor_ref VARCHAR(64) NULL,
            handle_expires_at DATETIME NULL,
            row_version INTEGER NOT NULL DEFAULT 1,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            CHECK (kind IN ('install','permission-upgrade','version-upgrade','policy-bundle-change')),
            CHECK (state IN ('draft','pending-approval','approved','rejected','awaiting-confirmation','applied','withdrawn','expired','failed')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
          )
        `)
        await this.db.rawQuery(`
          INSERT INTO plugin_change_requests__new (
            id, organization_id, project_id, request_uid, kind, state, plugin_id,
            requested_by, target_revision, diff_json, diff_digest, permission_digest,
            compatibility_digest, approval_required, approved_by, handle_digest,
            handle_actor_ref, handle_expires_at, row_version, expires_at, created_at, updated_at
          )
          SELECT
            id, organization_id, project_id, request_uid, kind, state, plugin_id,
            requested_by, target_revision, diff_json, diff_digest, permission_digest,
            compatibility_digest, approval_required, approved_by, handle_digest,
            handle_actor_ref, handle_expires_at, row_version, expires_at, created_at, updated_at
          FROM plugin_change_requests
        `)
        await this.db.rawQuery('DROP TABLE plugin_change_requests')
        await this.db.rawQuery(
          'ALTER TABLE plugin_change_requests__new RENAME TO plugin_change_requests',
        )
        await this.db.rawQuery(
          'CREATE UNIQUE INDEX plugin_change_requests_organization_id_request_uid_unique ON plugin_change_requests (organization_id, request_uid)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_state_index ON plugin_change_requests (organization_id, state)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_plugin_id_index ON plugin_change_requests (organization_id, plugin_id)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_created_at_index ON plugin_change_requests (organization_id, created_at)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_expires_at_index ON plugin_change_requests (organization_id, expires_at)',
        )
        await this.db.rawQuery('COMMIT')
      } catch (error) {
        await this.db.rawQuery('ROLLBACK')
        throw error
      } finally {
        await this.db.rawQuery('PRAGMA foreign_keys = ON')
      }
    } else {
      // PostgreSQL 分支（DEBT-01 未来）：ALTER TABLE 替换 CHECK。
      await this.db.rawQuery(
        'ALTER TABLE plugin_change_requests DROP CONSTRAINT IF EXISTS plugin_change_requests_kind_check',
      )
      await this.db.rawQuery(`
        ALTER TABLE plugin_change_requests ADD CONSTRAINT plugin_change_requests_kind_check
        CHECK (kind IN ('install','permission-upgrade','version-upgrade','policy-bundle-change'))
      `)
    }
  }

  async down() {
    const client = this.db.dialect.name
    if (client === 'sqlite3' || client === 'better-sqlite3') {
      await this.db.rawQuery('PRAGMA foreign_keys = OFF')
      await this.db.rawQuery('BEGIN')
      try {
        // 回退前删除 policy 类请求行（其决策事件随外键级联清理）
        await this.db.rawQuery(
          "DELETE FROM plugin_change_requests WHERE kind = 'policy-bundle-change'",
        )
        await this.db.rawQuery(`
          CREATE TABLE plugin_change_requests__old (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            organization_id INTEGER NOT NULL,
            project_id INTEGER NULL,
            request_uid VARCHAR(80) NOT NULL,
            kind VARCHAR(30) NOT NULL,
            state VARCHAR(30) NOT NULL DEFAULT 'draft',
            plugin_id VARCHAR(200) NOT NULL,
            requested_by VARCHAR(64) NOT NULL,
            target_revision VARCHAR(120) NOT NULL,
            diff_json TEXT NOT NULL,
            diff_digest VARCHAR(32) NOT NULL,
            permission_digest VARCHAR(32) NOT NULL,
            compatibility_digest VARCHAR(32) NOT NULL,
            approval_required BOOLEAN NOT NULL DEFAULT 0,
            approved_by VARCHAR(64) NULL,
            handle_digest VARCHAR(32) NULL,
            handle_actor_ref VARCHAR(64) NULL,
            handle_expires_at DATETIME NULL,
            row_version INTEGER NOT NULL DEFAULT 1,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NULL,
            CHECK (kind IN ('install','permission-upgrade','version-upgrade')),
            CHECK (state IN ('draft','pending-approval','approved','rejected','awaiting-confirmation','applied','withdrawn','expired','failed')),
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
          )
        `)
        await this.db.rawQuery(`
          INSERT INTO plugin_change_requests__old (
            id, organization_id, project_id, request_uid, kind, state, plugin_id,
            requested_by, target_revision, diff_json, diff_digest, permission_digest,
            compatibility_digest, approval_required, approved_by, handle_digest,
            handle_actor_ref, handle_expires_at, row_version, expires_at, created_at, updated_at
          )
          SELECT
            id, organization_id, project_id, request_uid, kind, state, plugin_id,
            requested_by, target_revision, diff_json, diff_digest, permission_digest,
            compatibility_digest, approval_required, approved_by, handle_digest,
            handle_actor_ref, handle_expires_at, row_version, expires_at, created_at, updated_at
          FROM plugin_change_requests
        `)
        await this.db.rawQuery('DROP TABLE plugin_change_requests')
        await this.db.rawQuery(
          'ALTER TABLE plugin_change_requests__old RENAME TO plugin_change_requests',
        )
        await this.db.rawQuery(
          'CREATE UNIQUE INDEX plugin_change_requests_organization_id_request_uid_unique ON plugin_change_requests (organization_id, request_uid)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_state_index ON plugin_change_requests (organization_id, state)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_plugin_id_index ON plugin_change_requests (organization_id, plugin_id)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_created_at_index ON plugin_change_requests (organization_id, created_at)',
        )
        await this.db.rawQuery(
          'CREATE INDEX plugin_change_requests_organization_id_expires_at_index ON plugin_change_requests (organization_id, expires_at)',
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
        'ALTER TABLE plugin_change_requests DROP CONSTRAINT IF EXISTS plugin_change_requests_kind_check',
      )
      await this.db.rawQuery(`
        ALTER TABLE plugin_change_requests ADD CONSTRAINT plugin_change_requests_kind_check
        CHECK (kind IN ('install','permission-upgrade','version-upgrade'))
      `)
    }
  }
}
