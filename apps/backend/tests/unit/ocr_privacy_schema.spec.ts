/**
 * OCR Privacy Policy Schema — Japa 数据库 Schema 测试
 *
 * 验证 policy override 和 copy/export run 表在数据库中正确创建。
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

test.group('OCR Privacy Policy — 数据库 Schema', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('ocr_privacy_policy_overrides 表存在', async ({ assert }) => {
    assert.isTrue(await tableExists('ocr_privacy_policy_overrides'))
  })

  test('ocr_privacy_copy_export_runs 表存在', async ({ assert }) => {
    assert.isTrue(await tableExists('ocr_privacy_copy_export_runs'))
  })

  test('ocr_privacy_policy_overrides 包含所有必需列', async ({ assert }) => {
    const cols = await tableColumns('ocr_privacy_policy_overrides')
    const required = [
      'id',
      'organization_id',
      'project_id',
      'policy_json',
      'version',
      'policy_hash',
      'source',
      'status',
      'updated_by',
      'created_at',
      'updated_at',
    ]
    for (const col of required) {
      assert.include(cols, col, `列 ${col} 必须存在`)
    }
  })

  test('ocr_privacy_copy_export_runs 包含所有必需列', async ({ assert }) => {
    const cols = await tableColumns('ocr_privacy_copy_export_runs')
    const required = [
      'id',
      'run_key',
      'organization_id',
      'project_id',
      'source_scope_kind',
      'purpose',
      'format',
      'preview_hash',
      'policy_hash',
      'status',
      'output_mode',
      'record_count',
      'character_count',
      'page_count',
      'content_hashes',
      'warning_codes',
      'confirmed_by',
      'created_at',
      'updated_at',
    ]
    for (const col of required) {
      assert.include(cols, col, `列 ${col} 必须存在`)
    }
  })

  test('ocr_privacy_policy_overrides 有 org+project 复合索引', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ocr_privacy_policy_overrides'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const names = rows.map((r: any) => r.name)
    assert.include(names, 'idx_ocr_privacy_policy_overrides_org_proj')
  })

  test('ocr_privacy_copy_export_runs 有 run_key 唯一索引', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ocr_privacy_copy_export_runs'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const names = rows.map((r: any) => r.name)
    assert.include(names, 'idx_ocr_privacy_runs_key')
  })
})
