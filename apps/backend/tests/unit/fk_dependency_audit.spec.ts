import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import {
  auditFkDependencies,
  auditFkMigrationSource,
  classifyGuardCondition,
  extractGuardRegions,
  isPgReachable,
} from './helpers/fk_dependency_audit.js'
import { PG_IDENTIFIER_MAX_BYTES, stripComments } from './helpers/pg_identifier_audit.js'

/**
 * v3-docker-compose-runtime-foundation（第八轮）—— FK forward-reference 回归门禁。
 *
 * 真实证据：fresh GCP PG 在 1840100000000 exit 1——copilot_memory_entries 内联 FK
 * 引用 copilot_sessions，而父表由更晚的 1841000000000 创建：
 * `relation "copilot_sessions" does not exist`。SQLite CREATE TABLE 不校验被引用表
 * 存在性，全量 SQLite 迁移测试从未暴露此序依赖。
 *
 * 本 spec 锁定：
 *   1. 修复契约：184010 在 PG 下不建 basis_session_db_id FK（列保留），SQLite 分支
 *      保留原 inline FK（CASCADE）；1841000000002 在父表就位后以显式短名
 *      fk_cme_basis_session 补齐 PG FK（ON DELETE CASCADE）；
 *   2. 全仓 migrations 不存在任何 PG 可达的 forward FK（A 类零容忍）；
 *   3. 无不可静态解析的 FK（unparsed 零容忍）；无父表缺失（D 类零容忍）；
 *   4. 已知 forward reference 冻结于 KNOWN_FORWARD_REFERENCES——新增任何
 *      forward FK（含 SQLite-only）立即失败，修复存量后必须同步移除条目（防 stale）。
 */

const MIGRATIONS_DIR = fileURLToPath(new URL('../../database/migrations/', import.meta.url))

const MIGRATION_184010 = '1840100000000_create_copilot_memory_entries_table.ts'
const MIGRATION_1841000000002 = '1841000000002_add_copilot_memory_basis_session_fk.ts'
const MIGRATION_SESSIONS = '1841000000000_create_copilot_sessions_table.ts'

/**
 * 已知 forward reference 冻结清单（逐项核实证据）。
 * 唯一条目为第八轮修复后的 intentional deferred FK：
 * - 184010 SQLite 分支保留 inline FK（SQLite 不校验父表存在性，契约不回退）；
 * - PG 由 1841000000002 以 fk_cme_basis_session 补齐，最终 schema 完整性等价。
 */
const KNOWN_FORWARD_REFERENCES = [
  {
    category: 'C',
    migration: MIGRATION_184010,
    childTable: 'copilot_memory_entries',
    childColumns: ['basis_session_db_id'],
    parentTable: 'copilot_sessions',
    parentMigration: MIGRATION_SESSIONS,
    deferredBy: MIGRATION_1841000000002,
  },
] as const

/**
 * 存量截断（>63B）但**表级命名空间内互不碰撞**的 FK 约束名冻结清单（第八轮审计快照）。
 * FK 名在 PG 为表级命名空间，三者分属不同表，截断合法且不碰撞（第七轮
 * foreignNamespaceCollisions=[] 门禁持续覆盖碰撞本身）。新增任何 >63B FK 名立即失败，
 * 修复存量后必须同步移除条目（防 stale）。
 */
const LEGACY_TRUNCATED_FK_NAMES = new Set([
  'triz_physical_contradiction_analysis_runs_organization_id_foreign', // 65B
  'triz_technical_contradiction_analysis_runs_organization_id_foreign', // 66B
  'multi_project_dependency_detection_results_organization_id_foreign', // 66B
])

describe('fk_dependency_audit 解析器', () => {
  it('识别方言守卫条件分类', () => {
    expect(classifyGuardCondition("dialect === 'sqlite3'")).toBe('sqlite-only')
    expect(classifyGuardCondition("dialect !== 'sqlite3'")).toBe('pg-only')
    expect(classifyGuardCondition("dialect === 'postgres'")).toBe('pg-only')
    expect(classifyGuardCondition("dialect !== 'postgres'")).toBe('sqlite-only')
    expect(classifyGuardCondition('isPgDialect(this.db.dialect.name)')).toBe('pg-only')
    expect(classifyGuardCondition('!isPgDialect(this.db.dialect.name)')).toBe('sqlite-only')
    expect(classifyGuardCondition('isSqliteDialect(name)')).toBe('sqlite-only')
    expect(classifyGuardCondition('!hasOrgColumn')).toBe('unknown')
  })

  it('if/else 区域正确求反（else 分支翻转方言含义）', () => {
    const source = [
      'async up() {',
      '  if (isPgDialect(this.db.dialect.name)) {',
      '    alpha()',
      '  } else {',
      '    beta()',
      '  }',
      '}',
    ].join('\n')
    const regions = extractGuardRegions(source)
    const alpha = isPgReachable(regions, source.indexOf('alpha()'))
    const beta = isPgReachable(regions, source.indexOf('beta()'))
    expect(alpha.pgReachable).toBe(true)
    expect(beta.pgReachable).toBe(false)
    expect(beta.guards[0]).toContain('else of')
  })

  it('无分号多行列链 FK 可被提取', () => {
    const source = `
export default class extends BaseSchema {
  protected tableName = 'child_table'
  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.bigIncrements('id')
      table
        .bigInteger('parent_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('parent_table')
        .onDelete('CASCADE')
    })
  }
}
`
    const { references, unparsed } = auditFkMigrationSource(source, '0001_test.ts')
    expect(unparsed).toEqual([])
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({
      childTable: 'child_table',
      childColumns: ['parent_id'],
      parentTable: 'parent_table',
      parentColumn: 'id',
      onDelete: 'CASCADE',
      fkName: 'child_table_parent_id_foreign',
      pgReachable: true,
    })
  })

  it('静态属性 inTable(ClassName.tableName) 可解析', () => {
    const source = `
export default class CreateFoo extends BaseSchema {
  public static tableName = 'foo_parent' as const
  async up() {
    this.schema.createTable('foo_child', (table) => {
      table
        .integer('parent_id')
        .references('id')
        .inTable(CreateFoo.tableName)
        .onDelete('CASCADE')
    })
  }
}
`
    const { references, unparsed } = auditFkMigrationSource(source, '0002_test.ts')
    expect(unparsed).toEqual([])
    expect(references[0]?.parentTable).toBe('foo_parent')
  })

  it('raw CREATE TABLE 内联 FOREIGN KEY 归属最近父 CREATE TABLE', () => {
    const source = `
async up() {
  const client = this.db.dialect.name
  if (client === 'sqlite3') {
    await this.db.rawQuery(\`
      CREATE TABLE reports_new (
        id INTEGER PRIMARY KEY,
        project_id BIGINT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    \`)
  }
}
`
    const { references, unparsed } = auditFkMigrationSource(source, '0003_test.ts')
    expect(unparsed).toEqual([])
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject({
      childTable: 'reports_new',
      parentTable: 'projects',
      onDelete: 'CASCADE',
      pgReachable: false, // sqlite3 分支
    })
  })

  it('动态子表 + 字面量父表的 raw ALTER 记为 <dynamic> 而非 unparsed', () => {
    const source = `
async function helper(db) {
  for (const table of TABLES) {
    await db.rawQuery(\`
      ALTER TABLE "public"."\${table}"
      ADD CONSTRAINT "\${table}_org_fk"
      FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
      ON DELETE CASCADE\`)
  }
}
`
    const { references, unparsed } = auditFkMigrationSource(source, '0004_test.ts')
    expect(unparsed).toEqual([])
    expect(references).toHaveLength(1)
    expect(references[0]?.childTable).toBe('<dynamic>')
    expect(references[0]?.parentTable).toBe('organizations')
  })
})

describe('copilot_memory_entries deferred FK 修复契约（第八轮）', () => {
  const report = auditFkDependencies(MIGRATIONS_DIR)

  it('184010：copilot_sessions FK 仅存于 SQLite 分支（PG 不可达），CASCADE 保持', () => {
    const fks = report.references.filter(
      (r) => r.migration === MIGRATION_184010 && r.parentTable === 'copilot_sessions',
    )
    expect(fks).toHaveLength(1)
    expect(fks[0]).toMatchObject({
      childTable: 'copilot_memory_entries',
      childColumns: ['basis_session_db_id'],
      parentColumn: 'id',
      onDelete: 'CASCADE',
      pgReachable: false,
    })
    expect(fks[0]!.guards.join(' ')).toContain('isPgDialect')
  })

  it('184010：PG 分支仍建立 basis_session_db_id 列（仅去 FK，不删列）', () => {
    const source = readFileSync(
      fileURLToPath(new URL(`../../database/migrations/${MIGRATION_184010}`, import.meta.url)),
      'utf8',
    )
    const pgBranch = source.match(
      /if \(isPgDialect\(this\.db\.dialect\.name\)\) \{([\s\S]*?)\} else \{/,
    )
    expect(pgBranch).not.toBeNull()
    expect(pgBranch![1]).toContain("bigInteger('basis_session_db_id')")
    expect(pgBranch![1]).not.toContain('.references(')
  })

  it('1841000000002：父表就位后补 fk_cme_basis_session（PG 可达 + CASCADE + 显式短名）', () => {
    const fk = report.references.find(
      (r) => r.migration === MIGRATION_1841000000002 && r.childTable === 'copilot_memory_entries',
    )
    expect(fk).toBeDefined()
    expect(fk).toMatchObject({
      childColumns: ['basis_session_db_id'],
      parentTable: 'copilot_sessions',
      parentColumn: 'id',
      onDelete: 'CASCADE',
      fkName: 'fk_cme_basis_session',
      explicitName: true,
      pgReachable: true,
    })
    expect(Buffer.byteLength('fk_cme_basis_session', 'utf8')).toBeLessThanOrEqual(
      PG_IDENTIFIER_MAX_BYTES,
    )
    // deferred FK 必须晚于父表创建迁移
    const parent = report.tableCreations.find((c) => c.table === 'copilot_sessions')
    expect(parent?.migration).toBe(MIGRATION_SESSIONS)
    expect(MIGRATION_1841000000002 > parent!.migration).toBe(true)
  })

  it('184010：不存在 basis_message_db_id 等消息级 FK 列（basis_json 仅 JSON 软引用）', () => {
    const source = readFileSync(
      fileURLToPath(new URL(`../../database/migrations/${MIGRATION_184010}`, import.meta.url)),
      'utf8',
    )
    // 剥离注释后断言：注释允许提及该名字作澄清，代码中不得存在此列
    expect(stripComments(source)).not.toContain('basis_message_db_id')
    const messageFks = report.references.filter(
      (r) => r.migration === MIGRATION_184010 && r.parentTable === 'copilot_messages',
    )
    expect(messageFks).toEqual([])
  })
})

describe('全仓 FK 依赖门禁（零容忍）', () => {
  const report = auditFkDependencies(MIGRATIONS_DIR)

  it('所有 FK 与建表语句均可静态解析（unparsed = []）', () => {
    expect(report.unparsed).toEqual([])
  })

  it('A 类（PG 可达 forward FK）= []——任何新增即 fresh PG blocker', () => {
    const blockers = report.forwardReferences.filter((f) => f.category === 'A')
    expect(blockers).toEqual([])
  })

  it('D 类（父表不由本仓迁移创建）= []', () => {
    const missing = report.forwardReferences.filter((f) => f.category === 'D')
    expect(missing).toEqual([])
  })

  it('forward references 冻结于 KNOWN_FORWARD_REFERENCES（双向防 stale）', () => {
    const actual = report.forwardReferences
      .map((f) => ({
        category: f.category,
        migration: f.migration,
        childTable: f.childTable,
        childColumns: f.childColumns,
        parentTable: f.parentTable,
        parentMigration: f.parentMigration,
        deferredBy: f.deferredBy,
      }))
      .sort((a, b) =>
        `${a.migration}${a.childTable}`.localeCompare(`${b.migration}${b.childTable}`),
      )
    const expected = [...KNOWN_FORWARD_REFERENCES].sort((a, b) =>
      `${a.migration}${a.childTable}`.localeCompare(`${b.migration}${b.childTable}`),
    )
    expect(actual).toEqual(expected)
  })

  it('PG 可达 FK 约束名 >63B 冻结于 LEGACY_TRUNCATED_FK_NAMES（双向防 stale）', () => {
    const offenders = report.references
      .filter(
        (r) =>
          r.pgReachable &&
          r.fkName !== '<dynamic>' &&
          r.fkName !== '<inline-ddl>' &&
          Buffer.byteLength(r.fkName, 'utf8') > PG_IDENTIFIER_MAX_BYTES,
      )
      .map((r) => r.fkName)
    // 同迁移 up/down 重建会让同名出现两次，按名去重后比对
    expect([...new Set(offenders)].sort()).toEqual([...LEGACY_TRUNCATED_FK_NAMES].sort())
  })
})
