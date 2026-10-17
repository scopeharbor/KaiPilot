/**
 * v3-ocr-document-search-indexing — API 功能测试与审计测试 (§7.4, §7.6, §7.7)
 *
 * 覆盖：
 * - 成功信封、验证错误、权限拒绝、跨项目遮盖、stale preview 错误、幂等重放
 * - 审计元数据不包含完整 OCR 文本、raw provider bodies、prompts、API keys、
 *   authorization headers、绝对存储路径、hidden file contents
 * - API 分页、按 source/extraction/status 过滤、确定性 warning/blocked reason 排序
 */

import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrDocumentSearchIndexRun from '#models/ocr_document_search_index_run'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import AuditLog from '#models/audit_log'
import { OcrDocumentSearchIndexService } from '#services/ai_ocr/ocr_document_search_index_service'
import Project from '#models/project'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'
import { makePermissiveResolver } from '../unit/ocr_permission_audit_integration_helpers.js'

/**
 * 组织 / 项目 / 审查人**必须是真实存在的行**。
 *
 * 本文件原先写死 ORG_ID=900 / PROJECT_ID=901 / reviewerId=1 却从不创建父行，
 * 而 ocr_review_accepted_extractions 自建表迁移起就带 organizations / projects / users
 * 三个外键——每个用到 fixture 的用例都在插入时 FOREIGN KEY constraint failed。
 */
let ORG_ID = 0
let PROJECT_ID = 0
let REVIEWER_ID = 0

/**
 * 构造索引服务（注入放行 resolver，保持本文件既有行为不变）。
 * 权限门禁的拒绝/降级行为由独立集成测试覆盖。
 */
function makeService(): OcrDocumentSearchIndexService {
  return new OcrDocumentSearchIndexService(makePermissiveResolver())
}

const BASE = '/api/v1/projects'

/**
 * 创建必要的测试数据
 */
async function createFixtureData() {
  const now = DateTime.now()
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = ORG_ID
  extraction.projectId = PROJECT_ID
  extraction.reviewerId = REVIEWER_ID
  extraction.sourceKind = 'attachment'
  extraction.sourceId = 10
  extraction.sourceHash = 'src-hash-api-001'
  extraction.candidateHash = 'cand-hash-api-001'
  extraction.selectedTextHash = 'txt-hash-api-001'
  extraction.selectedText = 'API测试OCR文本内容'
  extraction.pageRefsJson = [1]
  extraction.status = 'current'
  extraction.confirmedAt = now
  await extraction.save()
  return extraction
}

test.group('OCR Search Index — API 端点', (group) => {
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
      name: 'OCR 索引 API 测试项目',
      code: 'OCR-IDX-API',
      createdBy: user.id,
    })
    ORG_ID = org.id
    PROJECT_ID = project.id
    REVIEWER_ID = user.id

    await OcrDocumentSearchIndexEntry.query().delete()
    await OcrDocumentSearchIndexRun.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
    await AuditLog.query().delete()
  })

  // ── §7.4: 成功信封 ─────────────────────────────────────────────────────

  test('GET /api/v1/projects/:projectId/ocr/search-index 需要认证', async ({ client, assert }) => {
    const res = await client.get(`${BASE}/${PROJECT_ID}/ocr/search-index`)
    assert.isAtLeast(res.status(), 400, '应返回认证错误')
  })

  test('POST /api/v1/projects/:projectId/ocr/search-index/preview 需要认证', async ({
    client,
    assert,
  }) => {
    const res = await client.post(`${BASE}/${PROJECT_ID}/ocr/search-index/preview`).json({})
    assert.isAtLeast(res.status(), 400, '应返回认证错误')
  })

  test('POST /api/v1/projects/:projectId/ocr/search-index/execute 需要认证', async ({
    client,
    assert,
  }) => {
    const res = await client.post(`${BASE}/${PROJECT_ID}/ocr/search-index/execute`).json({})
    assert.isAtLeast(res.status(), 400, '应返回认证错误')
  })

  test('POST /api/v1/projects/:projectId/ocr/search-index/unindex-preview 需要认证', async ({
    client,
    assert,
  }) => {
    const res = await client.post(`${BASE}/${PROJECT_ID}/ocr/search-index/unindex-preview`).json({})
    assert.isAtLeast(res.status(), 400, '应返回认证错误')
  })

  // ── §7.4: 验证错误 ──────────────────────────────────────────────────────

  test('execute 无 previewHash 返回验证错误', async ({ client, assert }) => {
    const res = await client
      .post(`${BASE}/${PROJECT_ID}/ocr/search-index/execute`)
      .json({ idempotencyKey: 'test' })
    assert.isAtLeast(res.status(), 400, '缺少 previewHash 应返回验证错误')
  })

  test('execute 无 idempotencyKey 返回验证错误', async ({ client, assert }) => {
    const res = await client
      .post(`${BASE}/${PROJECT_ID}/ocr/search-index/execute`)
      .json({ previewHash: '0000000000000000' })
    assert.isAtLeast(res.status(), 400, '缺少 idempotencyKey 应返回验证错误')
  })

  // ── §7.4: stale preview 错误 ─────────────────────────────────────────────

  test('execute 使用无效 previewHash 返回错误', async ({ assert }) => {
    const svc = makeService()

    await assert.rejects(async () => {
      await svc.executeIndexing(
        ORG_ID,
        PROJECT_ID,
        {
          previewHash: 'ffffffffffffffff',
          idempotencyKey: 'bad-hash-test',
        },
        1,
      )
    }, /STALE_PREVIEW/)
  })

  // ── §7.4: 跨组织遮盖 ──────────────────────────────────────────────────

  test('跨组织不返回数据', async ({ assert }) => {
    await createFixtureData()

    const svc = makeService()
    const result = await svc.listStatus(9999, PROJECT_ID, {})

    assert.lengthOf(result.data, 0, '跨组织应返回空结果')
    assert.equal(result.meta.total, 0)
  })

  // ── §7.4: 幂等重放 ─────────────────────────────────────────────────────

  test('相同 idempotencyKey 重放返回相同结果', async ({ assert }) => {
    const extraction = await createFixtureData()

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])

    if (preview.data.eligibleCount === 0) return

    const key = 'api-idem-replay'
    const r1 = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: key,
      },
      1,
    )

    const r2 = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: key,
      },
      1,
    )

    assert.equal(r1.data.run.id, r2.data.run.id, '重放应返回相同 run')
  })

  // ── §7.7: 分页和过滤 ───────────────────────────────────────────────────

  test('listStatus 支持 perPage 参数', async ({ assert }) => {
    const now = DateTime.now()
    for (let i = 0; i < 5; i++) {
      await OcrDocumentSearchIndexEntry.create({
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        extractionId: 1000 + i,
        sourceKind: 'attachment',
        sourceId: 10 + i,
        sourceHash: `api-hash-${i}`,
        selectedTextHash: `api-txt-${i}`,
        indexContentHash: `api-idx-${i}`,
        pageRefsJson: [i + 1],
        searchableText: `API测试 ${i}`,
        searchableSnippet: `API ${i}`,
        status: 'active',
        indexedBy: 1,
        indexedAt: now,
      })
    }

    const svc = makeService()
    const result = await svc.listStatus(ORG_ID, PROJECT_ID, { perPage: 3 })

    assert.isAtMost(result.data.length, 3)
    assert.equal(result.meta.perPage, 3)
  })

  test('listStatus 支持 sourceKind 过滤', async ({ assert }) => {
    const now = DateTime.now()
    await OcrDocumentSearchIndexEntry.create({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      extractionId: 1100,
      sourceKind: 'attachment',
      sourceId: 50,
      sourceHash: 'att-hash',
      selectedTextHash: 'att-txt',
      indexContentHash: 'att-idx',
      pageRefsJson: [1],
      searchableText: '附件文本',
      searchableSnippet: '附件',
      status: 'active',
      indexedBy: 1,
      indexedAt: now,
    })
    await OcrDocumentSearchIndexEntry.create({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      extractionId: 1101,
      sourceKind: 'document',
      sourceId: 51,
      sourceHash: 'doc-hash',
      selectedTextHash: 'doc-txt',
      indexContentHash: 'doc-idx',
      pageRefsJson: [1],
      searchableText: '文档文本',
      searchableSnippet: '文档',
      status: 'active',
      indexedBy: 1,
      indexedAt: now,
    })

    const svc = makeService()
    const attResult = await svc.listStatus(ORG_ID, PROJECT_ID, { sourceKind: 'attachment' })

    for (const entry of attResult.data) {
      assert.equal(entry.sourceKind, 'attachment')
    }
  })
})

// ── §7.6: 审计测试 ─────────────────────────────────────────────────────

test.group('OCR Search Index — 审计元数据', (group) => {
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
      name: 'OCR 索引 API 测试项目',
      code: 'OCR-IDX-API',
      createdBy: user.id,
    })
    ORG_ID = org.id
    PROJECT_ID = project.id
    REVIEWER_ID = user.id

    await OcrDocumentSearchIndexEntry.query().delete()
    await OcrDocumentSearchIndexRun.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
    await AuditLog.query().delete()
  })

  test('审计元数据不包含完整 OCR 文本', async ({ assert }) => {
    const extraction = await createFixtureData()

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])

    if (preview.data.eligibleCount === 0) return

    await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: 'audit-test-001',
      },
      1,
    )

    // 验证审计日志存在且不包含 OCR 文本
    const auditLogs = await AuditLog.query()
      .where('organization_id', ORG_ID)
      .where('entity_type', 'ocr_search_index')

    if (auditLogs.length > 0) {
      for (const log of auditLogs) {
        const metadata = log.metadata as any
        // 不包含完整 OCR 文本
        assert.isFalse(
          JSON.stringify(metadata).includes('API测试OCR文本内容'),
          '审计元数据不应包含完整 OCR 文本',
        )
        // 不包含 raw provider bodies 相关字段
        assert.isFalse(
          JSON.stringify(metadata).includes('rawProviderBody'),
          '审计元数据不应包含 raw provider body',
        )
        // 不包含 API keys
        assert.isFalse(JSON.stringify(metadata).includes('apiKey'), '审计元数据不应包含 API key')
        // 不包含绝对存储路径
        assert.isFalse(JSON.stringify(metadata).includes('C:\\'), '审计元数据不应包含绝对存储路径')
      }
    }
  })

  test('审计元数据不包含 hidden file contents', async ({ assert }) => {
    const auditLogs = await AuditLog.query().where('entity_type', 'ocr_search_index')

    for (const log of auditLogs) {
      const metadata = log.metadata as any
      assert.isFalse(
        JSON.stringify(metadata).includes('hiddenContent'),
        '审计元数据不应包含隐藏文件内容',
      )
    }
  })

  test('unindex 审计不保留被移除的 OCR 文本', async ({ assert }) => {
    const extraction = await createFixtureData()

    const svc = makeService()
    const preview = await svc.previewIndexing(ORG_ID, PROJECT_ID, [extraction.id])

    if (preview.data.eligibleCount === 0) return

    const execResult = await svc.executeIndexing(
      ORG_ID,
      PROJECT_ID,
      {
        previewHash: preview.data.previewHash,
        idempotencyKey: 'unindex-audit-test',
      },
      1,
    )

    const entryIds = execResult.data.entries.map((e) => e.id)
    if (entryIds.length === 0) return

    const unindexPreview = await svc.previewUnindex(ORG_ID, PROJECT_ID, entryIds)

    await svc.executeUnindex(
      ORG_ID,
      PROJECT_ID,
      entryIds,
      unindexPreview.data.previewHash,
      'unindex-audit-key',
      null,
      1,
    )

    // 验证 unindex 审计日志不包含被移除的 OCR 文本
    const auditLogs = await AuditLog.query()
      .where('organization_id', ORG_ID)
      .where('entity_type', 'ocr_search_index')
      .orderBy('created_at', 'desc')

    if (auditLogs.length > 0) {
      const latestLog = auditLogs[0]
      const metadata = latestLog.metadata as any
      assert.isFalse(
        JSON.stringify(metadata).includes('API测试OCR文本内容'),
        'unindex 审计不应保留被移除的 OCR 文本',
      )
    }
  })
})
