import { test } from '@japa/runner'
import { setTimeout } from 'node:timers/promises'

/**
 * copilot_memory_entries 表 schema 校验（v3-copilot-memory-user-and-project §3.6）。
 *
 * 验证：
 * - 表存在
 * - 不存在可容纳 prompt 或模型输出全文的列
 * - 组织隔离索引存在
 * - scope 选取索引存在
 * - 保留期字段存在
 */
test.group('CopilotMemorySchema', (group) => {
  group.each.setup(async () => {
    await setTimeout(10)
  })

  test('copilot_memory_entries table exists', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const hasTable = await db.connection().schema.hasTable('copilot_memory_entries')
    assert.isTrue(hasTable)
  })

  test('no column can store full prompt or model output text', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo('copilot_memory_entries'))

    // 这些列名绝对不应存在（防止有人加 prompt/model_output 全文列）
    const forbiddenColumns = [
      'prompt',
      'prompt_text',
      'model_output',
      'model_output_text',
      'full_text',
      'content',
      'message_content',
      'raw_content',
      'input_text',
      'output_text',
      'system_prompt',
    ]

    for (const forbidden of forbiddenColumns) {
      assert.isFalse(
        columns.includes(forbidden),
        `Table should not have column '${forbidden}' that could store prompt/model output text`,
      )
    }
  })

  test('summary column has bounded length (512 chars max)', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'summary')
    // SQLite reports max_length as string '512' for VARCHAR(512)
    assert.isString(info.maxLength)
    assert.equal(info.maxLength, '512')
  })

  test('organization_id column exists and is not nullable', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'organization_id')
    assert.isFalse(info.nullable)
  })

  // 这四个用例原先断言的是列的**声明类型**（text/real），但迁移用的是 table.string()/table.float()
  // ——SQLite 里声明类型分别是 varchar/float（亲和性才是 TEXT/REAL）。更要紧的是：前三个用例
  // 标题写的是「has CHECK constraint values」，却根本没查 CHECK。改为直接读建表 DDL 断言 CHECK
  // 子句本身，既对上标题，也比查类型串更强。
  async function tableDdl(): Promise<string> {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const row = await db
      .connection()
      .rawQuery("select sql from sqlite_master where type = 'table' and name = ?", [
        'copilot_memory_entries',
      ])
    const rows = Array.isArray(row) ? row : (row?.rows ?? [])
    return String(rows[0]?.sql ?? '')
  }

  test('memory_scope has CHECK constraint values', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'memory_scope')
    assert.isFalse(info.nullable)
    assert.include(await tableDdl(), "memory_scope IN ('user','project','organization')")
  })

  test('status has CHECK constraint values', async ({ assert }) => {
    assert.include(
      await tableDdl(),
      "status IN ('candidate','confirmed','edited','possibly_outdated','invalidated')",
    )
  })

  test('validity_tier has CHECK constraint values', async ({ assert }) => {
    assert.include(
      await tableDdl(),
      "validity_tier IN ('ephemeral','short','medium','long','durable')",
    )
  })

  test('confidence is stored as float', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'confidence')
    // SQLite 的声明类型是 float（REAL 亲和），不是字面量 real
    assert.oneOf(String(info.type).toLowerCase(), ['float', 'real', 'double'])
    assert.isFalse(info.nullable)
  })

  test('retention_expires_at column exists', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo('copilot_memory_entries'))
    assert.isTrue(columns.includes('retention_expires_at'))
  })

  test('observed_at column exists', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const columns = Object.keys(await db.connection().columnsInfo('copilot_memory_entries'))
    assert.isTrue(columns.includes('observed_at'))
  })

  test('last_confirmed_at column exists and is nullable', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'last_confirmed_at')
    assert.isTrue(info.nullable)
  })

  test('basis_session_db_id references copilot_sessions', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const hasColumn = await db
      .connection()
      .schema.hasColumn('copilot_memory_entries', 'basis_session_db_id')
    assert.isTrue(hasColumn)
  })

  // 这两列用 table.json() 建（全仓 100 处 json 列都这么建），SQLite 的声明类型就是 json，
  // 断言 'text' 从一开始就对不上。用例名说的是「stores JSON array」，那就断言默认值确实是
  // 一个 JSON 数组字面量、且列非空——比断言类型串更贴近用例意图。
  test('tags_json stores JSON array', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'tags_json')
    assert.isFalse(info.nullable)
    assert.include(await tableDdl(), 'tags_json')
    assert.deepEqual(JSON.parse(String(info.default ?? "'[]'").replace(/^'|'$/g, '')), [])
  })

  test('basis_json stores JSON array', async ({ assert }) => {
    const { default: db } = await import('@adonisjs/lucid/services/db')
    const info = await db.connection().columnsInfo('copilot_memory_entries', 'basis_json')
    assert.isFalse(info.nullable)
    assert.include(await tableDdl(), 'basis_json')
    assert.deepEqual(JSON.parse(String(info.default ?? "'[]'").replace(/^'|'$/g, '')), [])
  })
})
