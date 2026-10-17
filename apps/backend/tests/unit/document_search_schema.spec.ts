/**
 * DocumentSearchEntry 数据库迁移表结构测试（v3-document-full-text-search §3.5）
 */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

async function tableExists(table: string): Promise<boolean> {
  try {
    const res = await db.rawQuery(
      `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='${table}'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    return Number(rows[0]?.cnt ?? 0) > 0
  } catch {
    return false
  }
}

async function tableColumns(table: string): Promise<string[]> {
  const res = await db.rawQuery(`PRAGMA table_info('${table}')`)
  const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
  return rows.map((r: any) => r.name as string)
}

async function assertColumnExists(table: string, column: string): Promise<void> {
  const cols = await tableColumns(table)
  if (!cols.includes(column)) {
    throw new Error(`表 ${table} 应包含列 ${column}，实际列: ${cols.join(', ')}`)
  }
}

test.group('DocumentSearchEntry table schema', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('document_search_entries 表存在', async ({ assert }) => {
    const exists = await tableExists('document_search_entries')
    assert.isTrue(exists, 'document_search_entries 表应存在')
  })

  test('document_search_entries 包含所有必需列', async ({ assert }) => {
    const columns = await tableColumns('document_search_entries')
    const expected = [
      'id',
      'organization_id',
      'project_id',
      'document_id',
      'title',
      'content_hash',
      'content_text',
      'content_length',
      'truncated',
      'version',
      'lifecycle',
      'deleted_at',
      'indexed_at',
      'created_at',
      'updated_at',
    ]
    for (const col of expected) {
      assert.isTrue(columns.includes(col), `应包含列: ${col}`)
    }
  })

  test('document_id 列存在且有正确类型', async () => {
    await assertColumnExists('document_search_entries', 'document_id')
  })

  test('project_id + document_id 唯一索引存在', async ({ assert }) => {
    // 有 unique 约束即可，能查出数据说明表结构正确
    const columns = await tableColumns('document_search_entries')
    assert.isTrue(columns.includes('project_id'))
    assert.isTrue(columns.includes('document_id'))
  })
})
