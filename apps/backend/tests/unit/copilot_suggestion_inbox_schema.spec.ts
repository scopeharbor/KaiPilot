import { test } from '@japa/runner'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * copilot_suggestion_inbox 表 schema 校验（v3-copilot-suggestion-inbox 任务 3.5/3.6）。
 *
 * 验证：
 * - 表存在，且**不存在可容纳建议正文的列**（正文按引用回源读取，收件箱只存状态与去重元数据）；
 * - 组织隔离列存在且非空；
 * - 去重唯一约束与主查询索引存在；
 * - 迁移保留 PostgreSQL 路径：不使用 SQLite 专有语法。
 */

const MIGRATION_PATH = join(
  process.cwd(),
  'database',
  'migrations',
  '1844000000000_create_copilot_suggestion_inbox_table.ts',
)

test.group('CopilotSuggestionInboxSchema', () => {
  test('copilot_suggestion_inbox table exists', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    assert.isTrue(await db.connection().schema.hasTable('copilot_suggestion_inbox'))
  })

  test('no column can hold suggestion body text', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo('copilot_suggestion_inbox'))

    // 收件箱只存「状态 + 去重元数据 + 来源引用」；正文列一旦出现即为红线破口
    const forbidden = [
      'body',
      'content',
      'suggestion_body',
      'suggestion_content',
      'suggestion_text',
      'description',
      'summary',
      'title',
      'rationale',
      'recommendation_text',
      'model_output',
      'raw_content',
      'payload',
    ]
    const offenders = columns.filter((c) => forbidden.includes(c))
    assert.deepEqual(offenders, [], `存在可容纳建议正文的列：${offenders.join(', ')}`)
  })

  test('expiry_detail is bounded and holds reason detail only', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_suggestion_inbox', 'expiry_detail')
    // 有界字符串（512）——不能被当作正文容器
    assert.isTrue(info.nullable)
    assert.notEqual(info.type, 'text')
  })

  test('jsonb dialect mapping keeps SQLite json column type unchanged', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    // 第九轮：PG 侧改用 jsonb（btree 可索引），knex 在 SQLite 将 jsonb 映射回 json——
    // 本测试锁定 SQLite 实际列类型仍为 json，证明既有 SQLite 行为零退化。
    const dedupe = await db.connection().columnsInfo('copilot_suggestion_inbox', 'dedupe_key_json')
    const sourceRefs = await db
      .connection()
      .columnsInfo('copilot_suggestion_inbox', 'source_refs_json')
    assert.equal(dedupe.type, 'json')
    assert.equal(sourceRefs.type, 'json')
  })

  test('organization_id exists and is not nullable', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_suggestion_inbox', 'organization_id')
    assert.isFalse(info.nullable)
  })

  test('project_id exists and is not nullable', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_suggestion_inbox', 'project_id')
    assert.isFalse(info.nullable)
  })

  test('state defaults to unread', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_suggestion_inbox', 'state')
    assert.isFalse(info.nullable)
    assert.include(String(info.defaultValue ?? ''), 'unread')
  })

  test('migration keeps the PostgreSQL path (no SQLite-only syntax)', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')

    // SQLite 专有构造：PostgreSQL 下会直接失败
    const sqliteOnly = [
      'AUTOINCREMENT',
      'PRAGMA',
      'sqlite_master',
      'WITHOUT ROWID',
      'INTEGER PRIMARY KEY AUTOINCREMENT',
      'datetime(',
      'strftime(',
    ]
    const offenders = sqliteOnly.filter((token) => source.includes(token))
    assert.deepEqual(offenders, [], `迁移含 SQLite 专有语法：${offenders.join(', ')}`)

    // 迁移应走 Knex schema builder（跨方言），而非 raw DDL
    assert.isTrue(source.includes('this.schema.createTable'))
    assert.isFalse(/this\.schema\.raw\(/.test(source), '迁移不应使用 raw DDL（会绑定方言）')
  })

  test('dedupe uniqueness and isolation indexes are declared', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    // 同组织 + 同项目 + 同去重键唯一
    assert.include(source, "table.unique(['organization_id', 'project_id', 'dedupe_key_json']")
    // 主查询路径：组织 + 项目 + 状态
    assert.include(source, "['organization_id', 'project_id', 'state']")
  })

  test('state and severity are constrained to the declared vocabularies', async ({ assert }) => {
    const source = readFileSync(MIGRATION_PATH, 'utf8')
    assert.include(source, "state IN ('unread','read','adopted','dismissed','expired')")
    assert.include(source, "severity IN ('critical','high','medium','low','info')")
  })
})
