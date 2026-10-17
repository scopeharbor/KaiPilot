/**
 * OCR 权限/审计 —— 搜索索引集成测试（v3-ocr-permission-and-audit §6.8）
 *
 * 证明 denied/degraded 决策：
 * - preview 不产生索引写计划（plannedIndexHash 为 null）、条目标记 permission_blocked
 * - 响应不暴露完整 OCR 文本
 * - execute 不产生任何 index entry / run 记录
 * - 放行时仍保留模块自身 preview/idempotency 契约
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { OcrDocumentSearchIndexService } from '#services/ai_ocr/ocr_document_search_index_service'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrDocumentSearchIndexRun from '#models/ocr_document_search_index_run'
import OcrRetentionHold from '#models/ocr_retention_hold'
import Project from '#models/project'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'
import {
  makeDeniedResolver,
  makeResolver,
  fakeMembership,
} from './ocr_permission_audit_integration_helpers.js'
import type { Permission } from '#rbac'

const OCR_TEXT = '这是敏感OCR全文，用于验证索引预览不泄露完整文本'

test.group('OcrPermissionAudit — Search Index Integration', (group) => {
  let orgId = 0
  let projectId = 0
  let actorId = 0

  group.each.setup(async () => {
    await setupTest()
    const org = await createTestOrg()
    // helper 形参是 (db, org, options)，首参为兼容旧调用形态保留的 db 占位
    const user = await createTestUser(undefined, org, { role: 'pmo' })
    const project = await Project.create({
      organizationId: org.id,
      name: '权限集成测试项目',
      code: 'PERM-INDEX',
      createdBy: user.id,
    })
    orgId = org.id
    projectId = project.id
    actorId = user.id

    await OcrDocumentSearchIndexEntry.query().delete()
    await OcrDocumentSearchIndexRun.query().delete()
    await OcrReviewAcceptedExtraction.query().delete()
    await OcrRetentionHold.query().delete()
  })

  async function createAcceptedExtraction(): Promise<OcrReviewAcceptedExtraction> {
    const extraction = new OcrReviewAcceptedExtraction()
    extraction.organizationId = orgId
    extraction.projectId = projectId
    extraction.reviewerId = actorId
    extraction.sourceKind = 'attachment'
    extraction.sourceId = 10
    extraction.sourceHash = 'src-hash-integration-001'
    extraction.candidateHash = 'cand-hash-integration-001'
    extraction.selectedTextHash = 'txt-hash-integration-001'
    extraction.selectedText = OCR_TEXT
    extraction.pageRefsJson = [1]
    // 搜索索引服务只索引 status='current' 的已接受提取（枚举仅 current/superseded）
    extraction.status = 'current'
    extraction.confirmedAt = DateTime.now()
    extraction.retentionPolicyHash = 'pol-hash-integration-001'
    await extraction.save()
    return extraction
  }

  test('denied 决策：preview 标记 permission_blocked 且无索引写计划', async ({ assert }) => {
    const extraction = await createAcceptedExtraction()
    const svc = new OcrDocumentSearchIndexService(makeDeniedResolver())

    const preview = await svc.previewIndexing(
      orgId,
      projectId,
      [extraction.id],
      undefined,
      undefined,
      actorId,
    )

    const entry = preview.data.entries.find((e) => e.extractionId === extraction.id)
    assert.isDefined(entry, '应能找到该提取的预览条目')
    assert.equal(entry!.eligible, false, 'denied 决策不应 eligible')
    assert.equal(entry!.blockedReason, 'permission_blocked')
    assert.isNull(entry!.plannedIndexHash, 'denied 决策不应产生索引写计划')
    assert.equal(preview.data.eligibleCount, 0)
  })

  test('denied 决策：preview 响应不暴露完整 OCR 文本', async ({ assert }) => {
    const extraction = await createAcceptedExtraction()
    const svc = new OcrDocumentSearchIndexService(makeDeniedResolver())

    const preview = await svc.previewIndexing(
      orgId,
      projectId,
      [extraction.id],
      undefined,
      undefined,
      actorId,
    )
    const json = JSON.stringify(preview.data)

    assert.isFalse(json.includes(OCR_TEXT), '预览响应不应包含完整 OCR 文本')
    // 原断言写的是 `json.includes('selectedText')`，但预览条目 DTO 里有
    // `selectedTextHash`（**哈希**，设计上就是低敏可回传），字符串包含判定会被它误命中——
    // 该用例因此恒失败，且失败原因与它想守护的语义无关。
    // 正确的守卫是：不得出现明文字段 `selectedText`，哈希字段允许存在。
    const entries = preview.data.entries as unknown as Record<string, unknown>[]
    for (const entry of entries) {
      assert.notProperty(entry, 'selectedText', '预览条目不应包含明文 selectedText 字段')
    }
    assert.isTrue(json.includes('selectedTextHash'), '哈希字段属低敏，应保留')
  })

  test('denied 决策：execute 不写任何 index entry', async ({ assert }) => {
    const extraction = await createAcceptedExtraction()
    const svc = new OcrDocumentSearchIndexService(makeDeniedResolver())

    const preview = await svc.previewIndexing(
      orgId,
      projectId,
      [extraction.id],
      undefined,
      undefined,
      actorId,
    )
    const result = await svc.executeIndexing(
      orgId,
      projectId,
      { previewHash: preview.data.previewHash, idempotencyKey: 'deny-exec' },
      actorId,
    )

    const entries = await OcrDocumentSearchIndexEntry.query().where('organization_id', orgId)
    assert.lengthOf(entries, 0, 'denied 决策不应创建任何 index entry')
    assert.equal(result.data.createdCount, 0, 'denied 决策不应产生索引写计划')
  })

  test('preview 放行但 execution 拒绝：execute 不写索引', async ({ assert }) => {
    const extraction = await createAcceptedExtraction()
    // 仅 ocr_search_index:view → preview(需要 view) 放行，execution(需要 manage) 拒绝
    const svc = new OcrDocumentSearchIndexService(
      makeResolver({
        membership: fakeMembership({
          permissions: new Set<Permission>(['ocr_search_index:view']),
        }),
      }),
    )

    const preview = await svc.previewIndexing(
      orgId,
      projectId,
      [extraction.id],
      undefined,
      undefined,
      actorId,
    )
    const entry = preview.data.entries.find((e) => e.extractionId === extraction.id)
    assert.isTrue(entry!.eligible, 'preview（view 权限）应放行')
    assert.isNotNull(entry!.plannedIndexHash, 'preview 应有索引写计划')

    await svc.executeIndexing(
      orgId,
      projectId,
      { previewHash: preview.data.previewHash, idempotencyKey: 'exec-denied' },
      actorId,
    )

    const entries = await OcrDocumentSearchIndexEntry.query().where('organization_id', orgId)
    assert.lengthOf(entries, 0, 'execution 被拒不应创建 index entry')
  })

  test('放行时保留模块自身 preview/idempotency 契约', async ({ assert }) => {
    const extraction = await createAcceptedExtraction()
    const svc = new OcrDocumentSearchIndexService(makeResolver())

    const preview = await svc.previewIndexing(
      orgId,
      projectId,
      [extraction.id],
      undefined,
      undefined,
      actorId,
    )
    assert.equal(preview.data.eligibleCount, 1)

    // 幂等重放：相同 idempotencyKey 返回相同 run
    const r1 = await svc.executeIndexing(
      orgId,
      projectId,
      { previewHash: preview.data.previewHash, idempotencyKey: 'idem-exec' },
      actorId,
    )
    const r2 = await svc.executeIndexing(
      orgId,
      projectId,
      { previewHash: preview.data.previewHash, idempotencyKey: 'idem-exec' },
      actorId,
    )
    assert.isAtLeast(r1.data.createdCount, 1)
    assert.equal(r2.data.run.id, r1.data.run.id, '幂等重放应返回相同 run')

    // stale preview 仍被拒
    await assert.rejects(
      () =>
        svc.executeIndexing(
          orgId,
          projectId,
          { previewHash: 'ffffffffffffffff', idempotencyKey: 'stale-exec' },
          actorId,
        ),
      /STALE_PREVIEW/,
    )
  })
})
