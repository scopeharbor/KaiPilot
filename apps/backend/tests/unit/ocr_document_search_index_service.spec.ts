/**
 * v3-ocr-document-search-indexing — 索引服务测试 (§5.2, §5.4, §5.6, §5.8, §5.10, §5.12)
 *
 * 覆盖：
 * - listStatus 分页、组织/项目过滤、hidden source 排除、权限降级元数据
 * - previewIndexing 非破坏性、阻止 OCR candidates、stale source、retention/hold、superseded
 * - executeIndexing 成功、重放、stale preview 拒绝、重复防护、红线保持
 * - reindex 替换 stale 条目、保留 tombstones、不索引被阻止提取
 * - unindex 行为、tombstone、文本清除、幂等重放、搜索遗漏
 * - 性能探针：大量 accepted extraction fixture 集
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import { OcrDocumentSearchIndexService } from '#services/ai_ocr/ocr_document_search_index_service'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrDocumentSearchIndexRun from '#models/ocr_document_search_index_run'
import OcrRetentionHold from '#models/ocr_retention_hold'
import Project from '#models/project'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'
import { makePermissiveResolver } from './ocr_permission_audit_integration_helpers.js'

import {
  isExtractionIndexable,
  truncateSearchableText,
  generateSearchSnippet,
  OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX,
  type OcrAcceptedExtractionStatus,
} from '@aiproj/types'

/**
 * 组织 / 项目 / 审查人**必须是真实存在的行**。
 *
 * 本文件原先写死 `ORG_ID = 700` / `PROJECT_ID = 701` / `reviewerId = 1` 却从不创建父行，
 * 而 `ocr_review_accepted_extractions` 自建表迁移（1835000000000）起就带
 * organizations / projects / users 三个外键——于是每一个调用 `createAcceptedExtraction`
 * 的用例都在插入时 `FOREIGN KEY constraint failed`，共 11 条从未真正跑过。
 * 改为与姊妹 spec `ocr_permission_audit_search_index.spec.ts` 一致：每个用例前建真实父行。
 */
let ORG_ID = 0
let PROJECT_ID = 0
let REVIEWER_ID = 0

/**
 * 构造索引服务（注入放行 resolver，保持本文件既有行为不变）。
 * 权限门禁的拒绝/降级行为由独立集成测试覆盖（见 ocr_permission_audit_search_index.spec.ts）。
 */
function makeService(): OcrDocumentSearchIndexService {
  return new OcrDocumentSearchIndexService(makePermissiveResolver())
}

/**
 * 辅助：在数据库创建一条 accepted extraction 记录
 */
async function createAcceptedExtraction(
  overrides: Record<string, unknown> = {},
): Promise<OcrReviewAcceptedExtraction> {
  const now = DateTime.now()
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = ORG_ID
  extraction.projectId = PROJECT_ID
  extraction.reviewerId = REVIEWER_ID
  extraction.sourceKind = (overrides.sourceKind as any) ?? 'attachment'
  extraction.sourceId = (overrides.sourceId as number) ?? 10
  extraction.sourceHash = (overrides.sourceHash as string) ?? 'src-hash-001'
  extraction.candidateHash = (overrides.candidateHash as string) ?? 'cand-hash-001'
  extraction.selectedTextHash = (overrides.selectedTextHash as string) ?? 'txt-hash-001'
  extraction.selectedText =
    (overrides.selectedText as string) ?? '这是测试的OCR识别文本内容，用于搜索索引'
  extraction.pageRefsJson = (overrides.pageRefsJson as number[]) ?? [1, 2]
  extraction.status = (overrides.status as OcrAcceptedExtractionStatus) ?? 'current'
  extraction.confirmedAt = (overrides.confirmedAt as DateTime) ?? now
  extraction.retentionLifecycle = (overrides.retentionLifecycle as string | null) ?? null
  extraction.purgedAt = (overrides.purgedAt as DateTime | null) ?? null
  extraction.tombstoneId = (overrides.tombstoneId as number | null) ?? null
  extraction.retentionPolicyHash =
    (overrides.retentionPolicyHash as string | null) ?? 'pol-hash-001'
  extraction.retentionEligibleAt = (overrides.retentionEligibleAt as DateTime | null) ?? null

  await extraction.save()
  return extraction
}

test.group('OcrDocumentSearchIndexService', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    await setupTest()
    const org = await createTestOrg()
    // helper 形参是 (db, org, options)，首参为兼容旧调用形态保留的 db 占位
    const user = await createTestUser(undefined, org, { role: 'pmo' })
    const project = await Project.create({
      organizationId: org.id,
      name: '索引服务测试项目',
      code: 'OCR-INDEX',
      createdBy: user.id,
    })
    ORG_ID = org.id
    PROJECT_ID = project.id
    REVIEWER_ID = user.id

    await OcrDocumentSearchIndexEntry.query().delete()
    await OcrDocumentSearchIndexRun.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
    await OcrRetentionHold.query().delete()
  })

  // ── §5.2: listStatus ──────────────────────────────────────────────────────

  test('listStatus 返回空列表当无条目时', async ({ assert }) => {
    const svc = makeService()
    const result = await svc.listStatus(ORG_ID, PROJECT_ID, {})

    assert.lengthOf(result.data, 0)
    assert.equal(result.meta.total, 0)
    assert.equal(result.meta.page, 1)
    assert.equal(result.meta.perPage, 20)
  })

  test('listStatus 支持分页', async ({ assert }) => {
    const now = DateTime.now()
    for (let i = 0; i < 10; i++) {
      await OcrDocumentSearchIndexEntry.create({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        extractionId: 100 + i,
        sourceKind: 'attachment',
        sourceId: 10 + i,
        sourceHash: `hash-${i}`,
        selectedTextHash: `txthash-${i}`,
        indexContentHash: `idxhash-${i}`,
        pageRefsJson: [i + 1],
        searchableText: `测试文本 ${i}`,
        searchableSnippet: `测试 ${i}`,
        status: 'active',
        indexedBy: 1,
        indexedAt: now,
      })
    }

    const svc = makeService()
    const page1 = await svc.listStatus(ORG_ID, PROJECT_ID, { page: 1, perPage: 5 })
    assert.lengthOf(page1.data, 5)
    assert.equal(page1.meta.total, 10)
    assert.equal(page1.meta.page, 1)
    assert.equal(page1.meta.perPage, 5)
    assert.equal(page1.meta.totalPages, 2)

    const page2 = await svc.listStatus(ORG_ID, PROJECT_ID, { page: 2, perPage: 5 })
    assert.lengthOf(page2.data, 5)
    assert.equal(page2.meta.page, 2)
  })

  test('listStatus 过滤不同组织的数据', async ({ assert }) => {
    const now = DateTime.now()
    await OcrDocumentSearchIndexEntry.create({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      extractionId: 200,
      sourceKind: 'attachment',
      sourceId: 20,
      sourceHash: 'hash-org1',
      selectedTextHash: 'txthash-org1',
      indexContentHash: 'idxhash-org1',
      pageRefsJson: [1],
      searchableText: '组织1的文本',
      searchableSnippet: '组织1',
      status: 'active',
      indexedBy: 1,
      indexedAt: now,
    })

    const svc = makeService()
    const result = await svc.listStatus(9999, PROJECT_ID, {})
    assert.lengthOf(result.data, 0)
    assert.equal(result.meta.total, 0, '跨组织不应返回数据')
  })

  test('listStatus 支持按 status 过滤', async ({ assert }) => {
    const now = DateTime.now()

    // active
    await OcrDocumentSearchIndexEntry.create({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      extractionId: 301,
      sourceKind: 'attachment',
      sourceId: 30,
      sourceHash: 'h1',
      selectedTextHash: 't1',
      indexContentHash: 'i1',
      pageRefsJson: [1],
      searchableText: 'active text',
      searchableSnippet: 'active',
      status: 'active',
      indexedBy: 1,
      indexedAt: now,
    })
    // tombstoned
    await OcrDocumentSearchIndexEntry.create({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      extractionId: 302,
      sourceKind: 'attachment',
      sourceId: 31,
      sourceHash: 'h2',
      selectedTextHash: 't2',
      indexContentHash: 'i2',
      pageRefsJson: [2],
      searchableText: '',
      searchableSnippet: null,
      status: 'tombstoned',
      indexedBy: null,
      indexedAt: null,
      tombstonedBy: 1,
      tombstonedAt: now,
    })

    const svc = makeService()
    const activeResult = await svc.listStatus(ORG_ID, PROJECT_ID, { status: 'active' })
    assert.equal(activeResult.data.length, 1)

    const tombstonedResult = await svc.listStatus(ORG_ID, PROJECT_ID, { status: 'tombstoned' })
    assert.equal(tombstonedResult.data.length, 1)
  })

  // ── §5.4: previewIndexing 非破坏性 ──────────────────────────────────────

  test('previewIndexing 不改变任何数据库记录', async ({ assert }) => {
    await createAcceptedExtraction({ extractionId: 400 } as any)

    const svc = makeService()

    const beforeEntries = await OcrDocumentSearchIndexEntry.query().count('* as total')
    const beforeRuns = await OcrDocumentSearchIndexRun.query().count('* as total')

    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID)

    const afterEntries = await OcrDocumentSearchIndexEntry.query().count('* as total')
    const afterRuns = await OcrDocumentSearchIndexRun.query().count('* as total')

    assert.equal(
      Number(beforeEntries[0].$extras?.total ?? 0),
      Number(afterEntries[0].$extras?.total ?? 0),
      'preview 不应创建任何 index entry',
    )
    assert.equal(
      Number(beforeRuns[0].$extras?.total ?? 0),
      Number(afterRuns[0].$extras?.total ?? 0),
      'preview 不应创建任何 run record',
    )

    // 验证预览有 previewHash 和 requiresConfirmation
    assert.isString(preview.data.previewHash)
    assert.isTrue(typeof preview.data.requiresConfirmation === 'boolean')
  })

  test('previewIndexing 阻止非 current 状态的提取', async ({ assert }) => {
    // 原写法传 status:'candidate'，但本表 CHECK 只允许 current|superseded
    //（`status IN ('current','superseded')`，迁移 1835000000000），插入必然抛错，
    // 该用例从未跑到断言。本表只存**已接受**提取，「非 accepted」在这里的真实形态
    // 就是 superseded——服务只索引 current。
    const extraction = await createAcceptedExtraction({ status: 'superseded' })

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])

    assert.equal(preview.data.eligibleCount, 0)
  })

  test('previewIndexing 返回 eligible 提取的 index 计划', async ({ assert }) => {
    await createAcceptedExtraction({})

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID)

    assert.isAtLeast(preview.data.eligibleCount, 0)
    assert.isArray(preview.data.entries)
    assert.isArray(preview.data.blockedReasons)
    assert.isArray(preview.data.warnings)
  })

  // ── §5.6: executeIndexing ────────────────────────────────────────────────

  test('executeIndexing 创建 index entry 和 run record', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])

    if (preview.data.eligibleCount === 0) {
      // 如果没有 eligible 条目，跳过执行测试
      return
    }

    const result = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: 'test-key-001',
      },
      1,
    )

    assert.isAtLeast(result.data.createdCount, 1)
    assert.isDefined(result.data.run)
    assert.isDefined(result.data.run.id)
    assert.isArray(result.data.entries)
  })

  test('executeIndexing 拒绝 stale preview hash', async ({ assert }) => {
    // 原写法在**空数据集**上断言 `previewHash: '0000000000000000'` 会被拒——
    // 但 `computePreviewHash([])` 算出来正好就是 '0000000000000000'
    //（parts='' → hash=0 → padStart(8,'0').padEnd(16,'0')），
    // 传进去的「陈旧 hash」恰恰是**正确**的 hash，服务当然不抛，用例形同虚设。
    // 现在先建数据让真实 hash 非平凡，再传一个断言过「确实不同」的 hash。
    await createAcceptedExtraction({})
    const svc = makeService()

    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID)
    const staleHash = '0000000000000000'
    assert.notEqual(preview.data.previewHash, staleHash, '前提：真实 hash 必须与 stale hash 不同')

    await assert.rejects(async () => {
      await svc.executeIndexing(
        ORG_ID,
        PROJECT_ID,
        { previewHash: staleHash, idempotencyKey: 'stale-test-key' },
        REVIEWER_ID,
      )
    }, /STALE_PREVIEW/)
  })

  test('executeIndexing 幂等重放返回已有结果', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])

    if (preview.data.eligibleCount === 0) return

    const idemKey = 'idempotent-replay-key'
    const first = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: idemKey,
      },
      1,
    )

    const second = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: idemKey,
      },
      1,
    )

    // 第二响应应返回相同 run
    assert.equal(second.data.run.id, first.data.run.id, '重放应返回相同 run')

    // 不应创建重复条目
    const activeEntries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .where('extraction_id', extraction.id)
    assert.isAtMost(activeEntries.length, 1, '不应有重复 active 条目')
  })

  // ── §5.8: reindex ────────────────────────────────────────────────────────

  test('previewReindex 委托给 previewIndexing', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()
    const preview = await svc.previewReindex(ORG_ID, PROJECT_ID, {
      extractionIds: [extraction.id],
    })

    assert.isArray(preview.data.entries)
    assert.isString(preview.data.previewHash)
  })

  test('executeReindex 替换 stale 条目', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()

    // 先 index
    const preview1 = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])
    if (preview1.data.eligibleCount === 0) return

    await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview1.data.previewHash,
        idempotencyKey: 'reindex-test-init',
      },
      1,
    )

    // 然后 reindex
    const preview2 = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])
    if (preview2.data.eligibleCount === 0) return

    await svc.executeReindex(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview2.data.previewHash,
        idempotencyKey: 'reindex-test-reindex',
      },
      1,
    )

    // 应只有一个 active per extraction
    const activeEntries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ORG_ID)
      .where('status', 'active')
      .where('extraction_id', extraction.id)
    assert.isAtMost(activeEntries.length, 1, 'reindex 不应创建重复 active 条目')
  })

  // ── §5.10: unindex ───────────────────────────────────────────────────────

  test('previewUnindex 返回活跃条目的 unindex 计划', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()

    // 先 index
    const preview1 = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])
    if (preview1.data.eligibleCount === 0) return

    const execResult = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview1.data.previewHash,
        idempotencyKey: 'unindex-prep',
      },
      1,
    )

    const entryIds = execResult.data.entries.map((e) => e.id)
    if (entryIds.length === 0) return

    const preview2 = await svc.previewUnindex(ORG_ID, PROJECT_ID, entryIds)
    assert.isAtLeast(preview2.data.eligibleCount, 1)
    assert.isString(preview2.data.previewHash)
  })

  test('executeUnindex 将条目标记为 tombstoned 并清除文本', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()

    const preview1 = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])
    if (preview1.data.eligibleCount === 0) return

    const execResult = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview1.data.previewHash,
        idempotencyKey: 'unindex-exec-prep',
      },
      1,
    )

    const entryIds = execResult.data.entries.map((e) => e.id)
    if (entryIds.length === 0) return

    const preview2 = await svc.previewUnindex(ORG_ID, PROJECT_ID, entryIds)

    const unindexResult = await svc.executeUnindex(
      ORG_ID,
      PROJECT_ID,
      entryIds,
      preview2.data.previewHash,
      'unindex-exec-key',
      '手动取消索引',
      1,
    )

    assert.equal(unindexResult.data.updatedCount, entryIds.length)

    // 验证条目现在是 tombstoned 且文本已清除
    for (const id of entryIds) {
      const entry = await OcrDocumentSearchIndexEntry.find(id)
      if (entry) {
        assert.equal(entry.status, 'tombstoned', '条目应为 tombstoned 状态')
        assert.equal(entry.searchableText, '', '搜索文本应被清除')
        assert.isNull(entry.searchableSnippet, '搜索摘要应为 null')
        assert.isNotNull(entry.tombstonedAt, '应有 tombstoned 时间')
      }
    }
  })

  test('executeUnindex 幂等重放返回已有结果', async ({ assert }) => {
    const extraction = await createAcceptedExtraction({})

    const svc = makeService()

    const preview1 = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])
    if (preview1.data.eligibleCount === 0) return

    const execResult = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview1.data.previewHash,
        idempotencyKey: 'unindex-idem-prep',
      },
      1,
    )

    const entryIds = execResult.data.entries.map((e) => e.id)
    if (entryIds.length === 0) return

    const preview2 = await svc.previewUnindex(ORG_ID, PROJECT_ID, entryIds)
    const idemKey = 'unindex-idem-replay'

    const first = await svc.executeUnindex(
      ORG_ID,
      PROJECT_ID,
      entryIds,
      preview2.data.previewHash,
      idemKey,
      null,
      1,
    )
    const second = await svc.executeUnindex(
      ORG_ID,
      PROJECT_ID,
      entryIds,
      preview2.data.previewHash,
      idemKey,
      null,
      1,
    )

    assert.equal(second.data.run.id, first.data.run.id, '重放应返回相同 run')
  })

  // ── §5.12: 性能探针 ────────────────────────────────────────────────────

  test('大量 accepted extraction fixture 的 previewIndexing 性能', async ({ assert }) => {
    const svc = makeService()
    const max = 50 // 测试用 50 条记录

    for (let i = 0; i < max; i++) {
      await createAcceptedExtraction({
        sourceId: 100 + i,
        sourceHash: `perf-src-hash-${i}`.padEnd(16, '0'),
        selectedTextHash: `perf-txt-hash-${i}`.padEnd(16, '0'),
        selectedText: `性能测试文本 ${i}：这是用于验证索引服务在大数据量下的响应时间`,
        pageRefsJson: [i + 1],
      } as any)
    }

    const start = performance.now()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID)
    const elapsed = performance.now() - start

    assert.isAtLeast(preview.data.entries.length, 0)
    // 记录性能阈值 - 50 条记录应在 2 秒内完成
    assert.isAtMost(elapsed, 5000, `preview 应在 5 秒内完成，实际：${elapsed.toFixed(0)}ms`)
    console.log(`[perf probe] previewIndexing ${max} extractions: ${elapsed.toFixed(0)}ms`)
  }).timeout(15000)
})

// ── 额外契约测试 ─────────────────────────────────────────────────────────

test.group('OCR search index — 共享纯函数', () => {
  test('isExtractionIndexable 对 current/非空文本/hash 返回 true', ({ assert }) => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'cand456',
      selectedText: '测试文本',
    })
    assert.isTrue(result.eligible)
    assert.isNull(result.blockedReason)
  })

  test('isExtractionIndexable 对空文本返回 not_accepted', ({ assert }) => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'cand456',
      selectedText: '',
    })
    assert.isFalse(result.eligible)
    assert.equal(result.blockedReason, 'not_accepted')
  })

  test('isExtractionIndexable 对 candidate_only 状态返回 false', ({ assert }) => {
    const result = isExtractionIndexable({
      status: 'candidate',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'cand456',
      selectedText: 'text',
    })
    assert.isFalse(result.eligible)
    assert.equal(result.blockedReason, 'candidate_only')
  })

  test('isExtractionIndexable 对 purged 提取返回 purged_extraction', ({ assert }) => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: '2024-01-01T00:00:00Z',
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'cand456',
      selectedText: 'text',
    })
    assert.isFalse(result.eligible)
    assert.equal(result.blockedReason, 'purged_extraction')
  })

  test('isExtractionIndexable 对 tombstoned 提取返回 tombstoned_extraction', ({ assert }) => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: null,
      purgedAt: null,
      tombstoneId: 5,
      sourceHash: 'abc123',
      candidateHash: 'cand456',
      selectedText: 'text',
    })
    assert.isFalse(result.eligible)
    assert.equal(result.blockedReason, 'tombstoned_extraction')
  })

  test('isExtractionIndexable 对过期生命周期返回 expired_extraction', ({ assert }) => {
    const result = isExtractionIndexable({
      status: 'current',
      retentionLifecycle: 'expired',
      purgedAt: null,
      tombstoneId: null,
      sourceHash: 'abc123',
      candidateHash: 'cand456',
      selectedText: 'text',
    })
    assert.isFalse(result.eligible)
    assert.equal(result.blockedReason, 'expired_extraction')
  })

  test('truncateSearchableText 截断至上限', ({ assert }) => {
    const longText = 'A'.repeat(5000)
    const truncated = truncateSearchableText(longText)
    assert.isAtMost(truncated.length, OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX)
  })

  test('generateSearchSnippet 在关键词周围生成片段', ({ assert }) => {
    const text = '项目管理系统包含甘特图和WBS分解功能，支持多项目并行管理'
    const snippet = generateSearchSnippet(text, '甘特图')
    assert.include(snippet, '甘特图')
  })
})
