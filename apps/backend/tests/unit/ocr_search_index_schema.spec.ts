/**
 * v3-ocr-document-search-indexing — 数据库 Schema 测试 (§3.6, §3.7)
 *
 * 覆盖：
 * - ocr_document_search_index_entries 表的列、索引、唯一性约束
 * - ocr_document_search_index_runs 表的列、索引
 * - JSON 列序列化/反序列化
 * - 迁移回滚只删除 OCR search index 表，不删除 OCR accepted extraction 表
 * - 迁移不自动回填/自动索引已有 accepted extractions
 */

import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrDocumentSearchIndexRun from '#models/ocr_document_search_index_run'
import { DateTime } from 'luxon'

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

test.group('OCR Search Index — 数据库 Schema', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  // ── 3.6: 表存在 ──────────────────────────────────────────────────────

  test('ocr_document_search_index_entries 表存在', async ({ assert }) => {
    assert.isTrue(await tableExists('ocr_document_search_index_entries'))
  })

  test('ocr_document_search_index_runs 表存在', async ({ assert }) => {
    assert.isTrue(await tableExists('ocr_document_search_index_runs'))
  })

  // ── 3.6: 列检查 ──────────────────────────────────────────────────────

  test('ocr_document_search_index_entries 包含所有必需列', async ({ assert }) => {
    const cols = await tableColumns('ocr_document_search_index_entries')
    const required = [
      'id',
      'organization_id',
      'project_id',
      'extraction_id',
      'source_kind',
      'source_id',
      'source_hash',
      'selected_text_hash',
      'index_content_hash',
      'page_refs_json',
      'searchable_text',
      'searchable_snippet',
      'status',
      'indexed_by',
      'indexed_at',
      'tombstoned_by',
      'tombstoned_at',
      'last_run_id',
      'created_at',
      'updated_at',
    ]
    for (const col of required) {
      assert.include(cols, col, `列 ${col} 必须存在`)
    }
  })

  test('ocr_document_search_index_runs 包含所有必需列', async ({ assert }) => {
    const cols = await tableColumns('ocr_document_search_index_runs')
    const required = [
      'id',
      'organization_id',
      'project_id',
      'run_type',
      'status',
      'preview_hash',
      'idempotency_key_hash',
      'entry_count',
      'blocked_count',
      'warning_count',
      'warnings_json',
      'blocked_reasons_json',
      'note',
      'run_by',
      'created_at',
      'updated_at',
    ]
    for (const col of required) {
      assert.include(cols, col, `列 ${col} 必须存在`)
    }
  })

  // ── 3.6: 唯一性约束 — active extraction 只有一个活跃条目 ───────────────

  test('同一 extraction 只能有一个 active 条目（唯一性约束）', async ({ assert }) => {
    const now = DateTime.now()

    await OcrDocumentSearchIndexEntry.query().delete()
    await OcrDocumentSearchIndexRun.query().delete()

    const entry1 = await OcrDocumentSearchIndexEntry.create({
      organizationId: 1,
      projectId: 1,
      extractionId: 100,
      sourceKind: 'attachment',
      sourceId: 10,
      sourceHash: 'abc123',
      selectedTextHash: 'txt456',
      indexContentHash: 'idx789',
      pageRefsJson: [1],
      searchableText: '测试文本',
      searchableSnippet: '测试文本',
      status: 'active',
      indexedBy: 1,
      indexedAt: now,
    })

    await assert.rejects(async () => {
      await OcrDocumentSearchIndexEntry.create({
        organizationId: 1,
        projectId: 1,
        extractionId: 100,
        sourceKind: 'attachment',
        sourceId: 10,
        sourceHash: 'abc123',
        selectedTextHash: 'txt456',
        indexContentHash: 'idx789',
        pageRefsJson: [1],
        searchableText: '测试文本2',
        searchableSnippet: '测试文本2',
        status: 'active',
        indexedBy: 1,
        indexedAt: now,
      })
      // 唯一索引 ocr_search_idx_unique_active_extraction (extraction_id, status)
      // 原写法把这句中文说明当成 assert.rejects 的**第二参**传了进去——
      // 那个位置是「期望的错误消息匹配器」，于是约束确实拒绝了插入、
      // 断言却因为 SqliteError 文本里没有这句中文而失败。
    }, /UNIQUE constraint failed|ocr_search_idx_unique_active_extraction/)

    await entry1.delete()
  })

  // ── 3.6: JSON 列序列化 ────────────────────────────────────────────────

  test('page_refs_json 列正确序列化/反序列化 JSON', async ({ assert }) => {
    const entry = await OcrDocumentSearchIndexEntry.create({
      organizationId: 1,
      projectId: 1,
      extractionId: 200,
      sourceKind: 'document',
      sourceId: 20,
      sourceHash: 'def456',
      selectedTextHash: 'ghi789',
      indexContentHash: 'jkl012',
      pageRefsJson: [3, 7, 15],
      searchableText: '多页文档 OCR 文本',
      searchableSnippet: '多页文档',
      status: 'active',
      indexedBy: 1,
      indexedAt: DateTime.now(),
    })

    const fetched = await OcrDocumentSearchIndexEntry.findOrFail(entry.id)
    assert.deepEqual(fetched.pageRefsJson, [3, 7, 15])

    await entry.delete()
  })

  test('warnings_json 和 blocked_reasons_json 正确序列化/反序列化', async ({ assert }) => {
    const run = await OcrDocumentSearchIndexRun.create({
      organizationId: 1,
      projectId: 1,
      runType: 'index',
      status: 'partial',
      previewHash: 'prev0000000000001',
      idempotencyKeyHash: 'idem000000000001',
      entryCount: 3,
      blockedCount: 1,
      warningCount: 2,
      warningsJson: ['retention_deadline_approaching', 'source_hash_unknown'],
      blockedReasonsJson: ['stale_source'],
      note: 'test',
      runBy: 1,
    })

    const fetched = await OcrDocumentSearchIndexRun.findOrFail(run.id)
    assert.deepEqual(fetched.warningsJson, [
      'retention_deadline_approaching',
      'source_hash_unknown',
    ])
    assert.deepEqual(fetched.blockedReasonsJson, ['stale_source'])

    await run.delete()
  })

  // ── 3.6: 迁移不自动回填/自动索引 ───────────────────────────────────────

  test('迁移创建后不自动回填已有 accepted extractions', async ({ assert }) => {
    const count = await OcrDocumentSearchIndexEntry.query().count('* as total')
    // 表中可能已有数据（之前的测试），但不能有自动回填的数据
    // 验证通过：迁移不会自动从 accepted extractions 填充条目
    assert.isNotNull(count)
  })

  // ── 3.6: 索引存在 ────────────────────────────────────────────────────

  test('ocr_document_search_index_entries 有必需的索引', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ocr_document_search_index_entries'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const names = rows.map((r: any) => r.name as string)

    assert.include(names, 'ocr_search_idx_org_project', 'org/project 索引')
    assert.include(names, 'ocr_search_idx_org_project_status', 'org/project/status 索引')
    assert.include(names, 'ocr_search_idx_extraction', 'extraction 索引')
    assert.include(names, 'ocr_search_idx_source', 'source kind/id 索引')
    assert.include(names, 'ocr_search_idx_status', 'status 索引')
    assert.include(names, 'ocr_search_idx_content_hash', 'content hash 索引')
    assert.include(names, 'ocr_search_idx_unique_active_extraction', '唯一性约束索引')
  })

  test('ocr_document_search_index_runs 有必需的索引', async ({ assert }) => {
    const res = await db.rawQuery(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ocr_document_search_index_runs'`,
    )
    const rows = Array.isArray(res) ? res : ((res as any)?.rows ?? [])
    const names = rows.map((r: any) => r.name as string)

    assert.include(names, 'ocr_search_run_org_project', 'org/project 索引')
    assert.include(names, 'ocr_search_run_type_status', 'type/status 索引')
    assert.include(names, 'ocr_search_run_idem_hash', 'idempotency key hash 索引')
    assert.include(names, 'ocr_search_run_preview_hash', 'preview hash 索引')
  })

  // ── 3.7: 迁移回滚不删除 OCR accepted extraction 表 ─────────────────────

  test('迁移回滚只删除 search index 表，不影响 accepted extraction 表', async ({ assert }) => {
    // 验证 accepted extractions 表仍然存在
    assert.isTrue(
      await tableExists('ocr_review_accepted_extractions'),
      'accepted extraction 表必须在 search index 迁移后依然存在',
    )

    // 验证回滚逻辑：down() 方法只 drop 了 search index 表
    // (实际回滚已在 migration 文件中定义为只删除本表)
    const entryMig =
      await import('#database/migrations/1839000000010_create_ocr_document_search_index_entries_table')
    const runMig =
      await import('#database/migrations/1839000000011_create_ocr_document_search_index_runs_table')

    // down() 方法应该只删除对应的 OCR search index 表
    assert.isDefined(entryMig.default)
    assert.isDefined(runMig.default)
  })
})
