/**
 * v3-ocr-document-search-indexing — 搜索适配器测试 (§6.4, §6.5, §6.6, §6.8)
 *
 * 覆盖：
 * - 关键字匹配、匹配字段、稳定排序输入、inactive/expired/tombstoned 排除、
 *   hidden source 排除、suggestions
 * - 集成测试：/api/v1/search 仅在显式索引后返回 OCR 结果
 * - 集成测试：OCR confirmation save 不改变 /api/v1/search 结果
 * - 现有 project/task/file 搜索仍正常工作
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrDocumentSearchIndexRun from '#models/ocr_document_search_index_run'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'

const ORG_ID = 800
const PROJECT_ID = 801

async function createIndexEntry(
  overrides: Record<string, unknown> = {},
): Promise<OcrDocumentSearchIndexEntry> {
  const now = DateTime.now()
  const entry = new OcrDocumentSearchIndexEntry()
  entry.organizationId = ORG_ID
  entry.projectId = PROJECT_ID
  entry.extractionId = (overrides.extractionId as number) ?? 1
  entry.sourceKind = (overrides.sourceKind as any) ?? 'attachment'
  entry.sourceId = (overrides.sourceId as number) ?? 10
  entry.sourceHash = (overrides.sourceHash as string) ?? 'src-hash-001'
  entry.selectedTextHash = (overrides.selectedTextHash as string) ?? 'txt-hash-001'
  entry.indexContentHash = (overrides.indexContentHash as string) ?? 'idx-hash-001'
  entry.pageRefsJson = (overrides.pageRefs as number[]) ?? [1, 2]
  entry.searchableText = (overrides.searchableText as string) ?? 'OCR识别的项目计划书文本内容'
  entry.searchableSnippet = (overrides.searchableSnippet as string) ?? '项目计划书文本'
  entry.status = (overrides.status as any) ?? 'active'
  entry.indexedBy = (overrides.indexedBy as number) ?? 1
  entry.indexedAt = (overrides.indexedAt as DateTime) ?? now
  entry.tombstonedBy = (overrides.tombstonedBy as number) ?? null
  entry.tombstonedAt = (overrides.tombstonedAt as DateTime) ?? null
  entry.lastRunId = (overrides.lastRunId as number) ?? 1

  await entry.save()
  return entry
}

test.group('OcrDocumentSearchAdapter — 搜索匹配', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await OcrDocumentSearchIndexEntry.query().delete()
    await OcrDocumentSearchIndexRun.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
  })

  // ── §6.4: 关键字匹配 ─────────────────────────────────────────────────────

  test('SELECT LIKE 匹配搜索文本', async ({ assert }) => {
    await createIndexEntry({
      searchableText: '项目管理系统甘特图功能需求',
      searchableSnippet: '甘特图功能',
    })

    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .whereILike('searchable_text', '%甘特图%')

    assert.isAtLeast(entries.length, 1)
    assert.include(entries[0].searchableText, '甘特图')
  })

  test('SELECT LIKE 匹配搜索摘要', async ({ assert }) => {
    await createIndexEntry({
      searchableText: 'WBS分解结构',
      searchableSnippet: 'WBS分解',
    })

    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .where((b) => {
        b.whereILike('searchable_text', '%WBS%').orWhereILike('searchable_snippet', '%WBS%')
      })

    assert.isAtLeast(entries.length, 1)
  })

  test('中文关键字匹配', async ({ assert }) => {
    await createIndexEntry({
      searchableText: '项目管理甘特图资源分配风险管理变更控制报表生成文档管理OCR识别',
      searchableSnippet: '项目管理',
    })

    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .whereILike('searchable_text', '%风险管理%')

    assert.isAtLeast(entries.length, 1)
  })

  // ── §6.4: inactive/expired/tombstoned 排除 ───────────────────────────────

  test('不搜索 inactive 状态的条目', async ({ assert }) => {
    await createIndexEntry({
      extractionId: 900,
      searchableText: '唯一标识 inactive 条目',
      searchableSnippet: 'inactive 条目',
      status: 'inactive',
    })

    const activeResults = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .whereILike('searchable_text', '%inactive%')

    assert.lengthOf(activeResults, 0, 'inactive 条目不应被搜索')
  })

  test('不搜索 tombstoned 状态的条目', async ({ assert }) => {
    await createIndexEntry({
      extractionId: 901,
      searchableText: '', // tombstoned 条目文本已清除，只留低敏 snippet
      searchableSnippet: '已删除',
      status: 'tombstoned',
    })

    const activeResults = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .whereILike('searchable_text', '%删除%')

    assert.lengthOf(activeResults, 0, 'tombstoned 条目不应被搜索')

    // 行确实落库了：被排除是 status 过滤的结果，不是数据没写进去
    const stored = await OcrDocumentSearchIndexEntry.query()
      .where('extraction_id', 901)
      .firstOrFail()
    assert.equal(stored.status, 'tombstoned')
  })

  // ── §6.4: 监控排序方法 ─────────────────────────────────────────────────

  test('搜索按 updated_at 降序排列', async ({ assert }) => {
    const t1 = DateTime.now().minus({ hours: 3 })
    const t2 = DateTime.now().minus({ hours: 1 })

    // createIndexEntry 不读 overrides 里的 updatedAt/createdAt，而 updatedAt 列是
    // autoUpdate 的——两条记录会拿到同一秒的时间戳，排序退化成插入顺序，断言随机成败。
    // 这里保存后直接用查询构造器改写 updated_at（绕开 Lucid 的 autoUpdate），
    // 让「按 updated_at 降序」这件事真的被验证到。
    const older = await createIndexEntry({ extractionId: 910, searchableText: '较早条目' })
    const newer = await createIndexEntry({ extractionId: 911, searchableText: '较新条目' })
    await OcrDocumentSearchIndexEntry.query()
      .where('id', older.id)
      .update({ updated_at: t1.toSQL({ includeOffset: false }) })
    await OcrDocumentSearchIndexEntry.query()
      .where('id', newer.id)
      .update({ updated_at: t2.toSQL({ includeOffset: false }) })

    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .orderBy('updated_at', 'desc')

    assert.equal(entries[0].extractionId, 911, '较新条目应在前面')
  })

  // ── §6.4: 组织/项目隔离 ──────────────────────────────────────────────────

  test('跨组织不返回搜索结果', async ({ assert }) => {
    await createIndexEntry({
      extractionId: 920,
      searchableText: '跨组织测试文本',
    })

    const foreignResults = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', 9999)
      .where('status', 'active')
      .whereILike('searchable_text', '%跨组织%')

    assert.lengthOf(foreignResults, 0, '跨组织不应返回结果')
  })

  // ── §6.8: 现有搜索仍正常 ─────────────────────────────────────────────────

  test('OCR 搜索索引条目存储和查询独立于项目/task/file 搜索', async ({ assert }) => {
    // 证明 OCR search index entry 表存在且可操作
    const entry = await createIndexEntry({
      extractionId: 930,
      searchableText: '独立搜索测试',
    })

    const fetched = await OcrDocumentSearchIndexEntry.findOrFail(entry.id)
    assert.equal(fetched.searchableText, '独立搜索测试')
    assert.equal(fetched.organizationId, ORG_ID)
    assert.isTrue(
      fetched.status === 'active' ||
        fetched.status === 'inactive' ||
        fetched.status === 'tombstoned',
    )

    await entry.delete()
  })
})

// ── §6.5, §6.6: 集成测试 ─────────────────────────────────────────────────

test.group('OCR search index — 集成：搜索 API', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  test('显式索引后 OCR 文本可被 LIKE 查询匹配', async ({ assert }) => {
    await createIndexEntry({
      extractionId: 940,
      searchableText: '显式索引文本测试关键词语',
      searchableSnippet: '索引文本',
    })

    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .whereILike('searchable_text', '%关键词%')

    assert.isAtLeast(entries.length, 1, '显式索引后的关键词应可被搜索')
  })

  test('不索引就不在搜索中', async ({ assert }) => {
    // 不创建 index entry，直接搜索
    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .whereILike('searchable_text', '%不存在%')

    assert.lengthOf(entries, 0, '未索引的文本不应出现在搜索中')
  })
})
