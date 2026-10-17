/**
 * v3-ui-next-chart-gallery —— 迁移纯 SQL 单元测试（tasks 3.x 迁移前置）。
 *
 * 覆盖 1996080000000_widen_diagrams_type_check_for_fishbone 的 up/down × 方言
 * 语句序列（先例：1994000000000 WBS 唯一索引迁移的 vitest 直接断言方式）：
 * - SQLite：表重建五连（新建→拷贝→DROP→改名→索引），CHECK 白名单含 fishbone；
 *   回退先删除 fishbone 记录再恢复旧 CHECK；
 * - PostgreSQL：DROP/ADD CONSTRAINT 形态与约束名。
 */
import { describe, expect, it } from 'vitest'
import { diagramsFishboneTypeStatements } from '../../database/migrations/1996080000000_widen_diagrams_type_check_for_fishbone.js'

const SQLITE_UP = diagramsFishboneTypeStatements('up', 'better-sqlite3')
const SQLITE_DOWN = diagramsFishboneTypeStatements('down', 'sqlite3')
const PG_UP = diagramsFishboneTypeStatements('up', 'postgres')
const PG_DOWN = diagramsFishboneTypeStatements('down', 'postgres')

describe('diagrams type CHECK 迁移（fishbone 扩容）', () => {
  it('SQLite up：新表 CHECK 白名单包含 fishbone 且保留全部旧类型', () => {
    const ddl = SQLITE_UP[0]!
    expect(ddl).toContain('CREATE TABLE diagrams__new')
    expect(ddl).toContain('CHECK (type IN')
    expect(ddl).toContain("'wbs_tree','gantt','dependency_graph','critical_path','fishbone'")
  })

  it('SQLite up：五连重建保留数据、外键与索引', () => {
    expect(SQLITE_UP).toHaveLength(6)
    expect(SQLITE_UP[0]).toContain(
      'FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
    )
    expect(SQLITE_UP[0]).toContain(
      'FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT',
    )
    expect(SQLITE_UP[1]).toBe(
      'INSERT INTO diagrams__new (id, organization_id, project_id, type, title, spec, source_hash, created_by, updated_by, deleted_at, created_at, updated_at) SELECT id, organization_id, project_id, type, title, spec, source_hash, created_by, updated_by, deleted_at, created_at, updated_at FROM diagrams',
    )
    expect(SQLITE_UP[2]).toBe('DROP TABLE diagrams')
    expect(SQLITE_UP[3]).toBe('ALTER TABLE diagrams__new RENAME TO diagrams')
    expect(SQLITE_UP.join('\n')).toContain(
      'CREATE INDEX diagrams_project_id_type_idx_v2 ON diagrams (project_id, type)',
    )
    expect(SQLITE_UP.join('\n')).toContain(
      'CREATE INDEX diagrams_org_project_deleted_idx_v2 ON diagrams (organization_id, project_id, deleted_at)',
    )
  })

  it('SQLite down：先清 fishbone 记录，再重建回旧 CHECK', () => {
    expect(SQLITE_DOWN[0]).toBe("DELETE FROM diagrams WHERE type = 'fishbone'")
    const ddl = SQLITE_DOWN[1]!
    expect(ddl).toContain('CREATE TABLE diagrams__old')
    expect(ddl).toContain('CHECK (type IN')
    expect(ddl).not.toContain('fishbone')
    expect(SQLITE_DOWN.join('\n')).toContain(
      'INSERT INTO diagrams__old (id, organization_id, project_id, type, title, spec, source_hash, created_by, updated_by, deleted_at, created_at, updated_at) SELECT id, organization_id, project_id, type, title, spec, source_hash, created_by, updated_by, deleted_at, created_at, updated_at FROM diagrams',
    )
    expect(SQLITE_DOWN[3]).toBe('DROP TABLE diagrams')
    expect(SQLITE_DOWN[4]).toBe('ALTER TABLE diagrams__old RENAME TO diagrams')
  })

  it('PostgreSQL：up/down 以 DROP/ADD CONSTRAINT 替换 CHECK', () => {
    expect(PG_UP).toEqual([
      'ALTER TABLE diagrams DROP CONSTRAINT IF EXISTS diagrams_type_check',
      "ALTER TABLE diagrams ADD CONSTRAINT diagrams_type_check CHECK (type IN ('wbs_tree','gantt','dependency_graph','critical_path','fishbone'))",
    ])
    expect(PG_DOWN[0]).toBe('ALTER TABLE diagrams DROP CONSTRAINT IF EXISTS diagrams_type_check')
    expect(PG_DOWN[1]).toContain("'wbs_tree','gantt','dependency_graph','critical_path'")
    expect(PG_DOWN[1]).not.toContain('fishbone')
  })
})
