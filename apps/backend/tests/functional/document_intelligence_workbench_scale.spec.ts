/**
 * 文档智能工作台 —— 规模、查询预算与分页稳定性
 * （v3-document-intelligence-workbench §7.1 / §7.2 / §7.3 / §7.4）
 *
 * 覆盖：
 * - 7.1 确定性规模 fixture：1000 可见来源、200+ OCR 作业、混合治理与 downstream 状态
 * - 7.2 query-count / port-call-count 门禁：批量加载为常数族数，无逐行 N+1
 * - 7.3 本机 read-model 性能探针：记录 p50/p95 与查询次数（阈值取 design D7）
 * - 7.4 分页稳定性：连续页无重复/遗漏、稳定 tie-breaker、countMode 诚实、无 fixed-200 截断
 *
 * 红线：fixture/fake，零真实 provider、零公网。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import Attachment from '#models/attachment'
import Document from '#models/document'
import OcrDocumentJob from '#models/ocr_document_job'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import DocumentIntelligenceWorkbenchService, {
  WORKBENCH_SCAN_BUDGET,
} from '#services/document_intelligence/workbench_service'
import { DefaultDocumentIntelligenceReadAdapters } from '#services/document_intelligence/default_read_adapters'
import {
  DOCUMENT_INTELLIGENCE_PORT_KEYS,
  type DocumentIntelligenceReadPorts,
} from '#services/document_intelligence/read_ports'
import type { DocumentIntelligenceListQuery } from '@aiproj/types'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const PM_ROLE_NAME = 'Project Manager'
const ADMIN_PERMISSIONS = ['project:view', 'file:view', 'file:manage']

/** design D7 的规模目标 */
const SCALE_SOURCES = 1000
const SCALE_JOBS = 240

const ACCESS = { readOnly: false, canManageFiles: true, canReadAudit: true }

function baseQuery(
  overrides: Partial<DocumentIntelligenceListQuery> = {},
): DocumentIntelligenceListQuery {
  return {
    attention: null,
    sourceKind: null,
    capability: null,
    status: null,
    sort: 'source_ref',
    direction: 'asc',
    page: 1,
    perPage: 100,
    search: null,
    ...overrides,
  }
}

interface ScaleWorld {
  organizationId: number
  projectId: number
  ownerId: number
  attachmentIds: number[]
}

/**
 * 确定性规模 seed harness：
 * - 900 个附件 + 100 个原生文档 = 1000 可见来源
 * - 前 240 个附件各 1 条 OCR 作业（覆盖 reviewable / processing / failed / stale）
 * - 每 5 个作业里 1 个带 current accepted extraction，其中一半再带 active 搜索索引
 */
async function seedScaleWorld(): Promise<ScaleWorld> {
  const owner = await createUser({ email: uniqueEmail('di-scale') })
  const org = await createOrganization(owner)
  const { project } = await createProjectWithMember(
    org,
    owner,
    owner,
    PM_ROLE_NAME,
    ADMIN_PERMISSIONS,
  )
  const oid = Number(org.id)
  const pid = Number(project.id)
  const uid = Number(owner.id)

  const attachmentRows = Array.from({ length: 900 }, (_, i) => ({
    projectId: pid,
    entityType: 'project',
    entityId: pid,
    fileName: `scale-${String(i).padStart(4, '0')}.pdf`,
    filePath: `uploads/scale/${i}.pdf`,
    fileSize: 512,
    mimeType: i % 50 === 49 ? 'application/x-legacy' : 'application/pdf',
    storageProvider: 'local',
    currentVersion: 1,
    uploadedBy: uid,
  }))
  const attachments = await Attachment.createMany(attachmentRows as never)

  const documentRows = Array.from({ length: 100 }, (_, i) => ({
    projectId: pid,
    documentType: 'document',
    name: `规模文档-${String(i).padStart(3, '0')}.md`,
    parentId: null,
    isTemplate: false,
    aiGenerated: false,
    version: 1,
    createdBy: uid,
    updatedBy: uid,
  }))
  await Document.createMany(documentRows as never)

  const attachmentIds = attachments.map((a) => Number(a.id))

  const jobStatuses = ['reviewable', 'processing', 'failed', 'reviewable'] as const
  const jobRows = attachmentIds.slice(0, SCALE_JOBS).map((sourceId, i) => ({
    organizationId: oid,
    projectId: pid,
    sourceAttachmentId: sourceId,
    sourceKind: 'attachment',
    sourceFileName: null,
    sourceMimeType: 'application/pdf',
    sourceHash: `scale-hash-${sourceId}`,
    status: jobStatuses[i % jobStatuses.length],
    pageCount: 2,
    succeededPages: 2,
    failedPages: 0,
    warningCodes: i % 7 === 0 ? ['STALE_SOURCE'] : [],
    provider: 'fake-adapter',
    createdBy: uid,
  }))
  const jobs = await OcrDocumentJob.createMany(jobRows as never)

  // 每 5 个作业出 1 个 current accepted extraction
  const extractions: OcrReviewAcceptedExtraction[] = []
  for (let i = 0; i < jobs.length; i += 5) {
    const job = jobs[i]!
    const extraction = new OcrReviewAcceptedExtraction()
    extraction.organizationId = oid
    extraction.projectId = pid
    extraction.reviewerId = uid
    extraction.jobId = Number(job.id)
    extraction.sourceKind = 'attachment'
    extraction.sourceId = Number(job.sourceAttachmentId)
    extraction.sourceHash = `scale-hash-${job.sourceAttachmentId}`
    extraction.candidateHash = `scale-cand-${job.sourceAttachmentId}`
    extraction.selectedTextHash = `scale-text-${job.sourceAttachmentId}`
    extraction.selectedText = 'scale-fixture-body'
    extraction.pageRefsJson = [1]
    extraction.status = 'current'
    extraction.confirmedAt = DateTime.now()
    await extraction.save()
    extractions.push(extraction)
  }

  // 一半 extraction 再带 active 搜索索引
  for (let i = 0; i < extractions.length; i += 2) {
    const extraction = extractions[i]!
    const entry = new OcrDocumentSearchIndexEntry()
    entry.organizationId = oid
    entry.projectId = pid
    entry.extractionId = Number(extraction.id)
    entry.sourceKind = 'attachment'
    entry.sourceId = Number(extraction.sourceId)
    entry.sourceHash = `scale-hash-${extraction.sourceId}`
    entry.selectedTextHash = `scale-text-${extraction.sourceId}`
    entry.indexContentHash = `scale-idx-${extraction.sourceId}`
    entry.pageRefsJson = [1]
    entry.searchableText = 'snippet-only'
    entry.status = 'active'
    entry.indexedAt = DateTime.now()
    await entry.save()
  }

  return { organizationId: oid, projectId: pid, ownerId: uid, attachmentIds }
}

/** 统计 port 调用次数的透明代理（不改变行为） */
function countingPorts(inner: DocumentIntelligenceReadPorts) {
  const calls: Record<string, number> = {}
  const proxy = {} as DocumentIntelligenceReadPorts
  for (const key of DOCUMENT_INTELLIGENCE_PORT_KEYS) {
    ;(proxy as unknown as Record<string, unknown>)[key] = async (params: unknown) => {
      calls[key] = (calls[key] ?? 0) + 1
      return (inner as unknown as Record<string, (p: unknown) => Promise<unknown>>)[key]!(params)
    }
  }
  return { ports: proxy, calls }
}

/** 统计一次调用期间的 SQL 查询数 */
async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  let queries = 0
  const listener = () => {
    queries += 1
  }
  db.connection().getWriteClient()
  const emitter = (db as unknown as { emitter?: { on: Function; off: Function } }).emitter
  if (emitter) emitter.on('db:query', listener)
  try {
    const result = await fn()
    return { result, queries }
  } finally {
    if (emitter) emitter.off('db:query', listener)
  }
}

test.group('文档智能工作台 — 规模与查询预算', (group) => {
  useAuthDatabase(group)

  test('1000 来源规模：常数级 port 调用族数，无逐行 N+1', async ({ assert }) => {
    const world = await seedScaleWorld()
    const { ports, calls } = countingPorts(new DefaultDocumentIntelligenceReadAdapters())
    const service = new DocumentIntelligenceWorkbenchService(ports)

    const res = await service.listSources({
      organizationId: world.organizationId,
      projectId: world.projectId,
      query: baseQuery({ perPage: 100 }),
      access: ACCESS,
    })

    assert.equal(res.data.length, 100)
    assert.equal(res.meta.total, SCALE_SOURCES)

    // 每个维度族至多被调用一次（source 族允许 probe + page 两次）
    for (const [name, count] of Object.entries(calls)) {
      const limit = name === 'pageVisibleSources' ? 2 : 1
      assert.isAtMost(count, limit, `${name} 调用了 ${count} 次，超出常数预算`)
    }
    // 总调用数与行数无关：远小于页内行数
    const totalCalls = Object.values(calls).reduce((a, b) => a + b, 0)
    assert.isBelow(totalCalls, 20, `port 总调用数 ${totalCalls} 疑似随行数增长`)
  }).timeout(180000)

  test('SQL 查询次数为常数级，不随页内行数线性增长', async ({ assert }) => {
    const world = await seedScaleWorld()
    const service = new DocumentIntelligenceWorkbenchService(
      new DefaultDocumentIntelligenceReadAdapters(),
    )

    const small = await withQueryCount(() =>
      service.listSources({
        organizationId: world.organizationId,
        projectId: world.projectId,
        query: baseQuery({ perPage: 10 }),
        access: ACCESS,
      }),
    )
    const large = await withQueryCount(() =>
      service.listSources({
        organizationId: world.organizationId,
        projectId: world.projectId,
        query: baseQuery({ perPage: 100 }),
        access: ACCESS,
      }),
    )

    // 每页 10 行与 100 行的查询数应基本一致（常数族），绝不成 10 倍
    if (small.queries > 0) {
      assert.isBelow(
        large.queries,
        small.queries * 2,
        `查询数从 ${small.queries} 增至 ${large.queries}，疑似 N+1`,
      )
    }
    assert.equal(large.result.data.length, 100)
  }).timeout(180000)

  test('read-model 性能探针：记录耗时与页大小（design D7 阈值）', async ({ assert }) => {
    const world = await seedScaleWorld()
    const service = new DocumentIntelligenceWorkbenchService(
      new DefaultDocumentIntelligenceReadAdapters(),
    )

    const samples: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const started = Date.now()
      await service.listSources({
        organizationId: world.organizationId,
        projectId: world.projectId,
        query: baseQuery({ perPage: 20, page: i + 1 }),
        access: ACCESS,
      })
      samples.push(Date.now() - started)
    }
    samples.sort((a, b) => a - b)
    const p50 = samples[Math.floor(samples.length * 0.5)]!
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]!

    // 低敏观测输出（无内容、无路径）

    console.log(
      `[perf] document-intelligence listSources sources=${SCALE_SOURCES} jobs=${SCALE_JOBS} p50=${p50}ms p95=${p95}ms`,
    )
    // design D7：首屏 read-model API p95 目标 < 800ms（本机 SQLite fixture）
    assert.isBelow(p95, 800, `p95=${p95}ms 超出 design D7 阈值 800ms`)
  }).timeout(180000)
})

test.group('文档智能工作台 — 分页稳定性', (group) => {
  useAuthDatabase(group)

  test('连续页无重复无遗漏，且不被固定 200 截断', async ({ assert }) => {
    const world = await seedScaleWorld()
    const service = new DocumentIntelligenceWorkbenchService(
      new DefaultDocumentIntelligenceReadAdapters(),
    )

    const seen = new Set<string>()
    let totalReported = 0
    for (let page = 1; page <= 10; page += 1) {
      const res = await service.listSources({
        organizationId: world.organizationId,
        projectId: world.projectId,
        query: baseQuery({ page, perPage: 100 }),
        access: ACCESS,
      })
      totalReported = res.meta.total
      for (const row of res.data) {
        const ref = `${row.sourceKind}:${row.sourceId}`
        assert.isFalse(seen.has(ref), `第 ${page} 页出现重复行 ${ref}`)
        seen.add(ref)
      }
    }

    assert.equal(totalReported, SCALE_SOURCES)
    assert.equal(seen.size, SCALE_SOURCES, '10 页 × 100 行应覆盖全部来源，无遗漏')
    // 远超旧前端固定 200 条上限
    assert.isAbove(seen.size, 200)
  }).timeout(240000)

  test('countMode 诚实：预算内 exact、超预算 page 且 scanTruncated 显式标注', async ({
    assert,
  }) => {
    const world = await seedScaleWorld()
    const service = new DocumentIntelligenceWorkbenchService(
      new DefaultDocumentIntelligenceReadAdapters(),
    )

    // 1000 来源恰好落在扫描预算内 → exact
    const within = await service.listSources({
      organizationId: world.organizationId,
      projectId: world.projectId,
      query: baseQuery({ perPage: 50 }),
      access: ACCESS,
    })
    assert.equal(WORKBENCH_SCAN_BUDGET, 1000)
    assert.equal(within.meta.countMode, 'exact')
    assert.isFalse(within.meta.scanTruncated)

    // 超出预算后：带维度过滤时必须显式标注截断，不冒充全量
    await Attachment.createMany(
      Array.from({ length: 20 }, (_, i) => ({
        projectId: world.projectId,
        entityType: 'project',
        entityId: world.projectId,
        fileName: `overflow-${i}.pdf`,
        filePath: `uploads/scale/overflow-${i}.pdf`,
        fileSize: 128,
        mimeType: 'application/pdf',
        storageProvider: 'local',
        currentVersion: 1,
        uploadedBy: world.ownerId,
      })) as never,
    )

    const overflowNoFilter = await service.listSources({
      organizationId: world.organizationId,
      projectId: world.projectId,
      query: baseQuery({ perPage: 50 }),
      access: ACCESS,
    })
    // 无维度过滤：total 仍是权威计数（不被截断成 1000）
    assert.equal(overflowNoFilter.meta.total, SCALE_SOURCES + 20)
    assert.isFalse(overflowNoFilter.meta.scanTruncated)
    assert.equal(overflowNoFilter.meta.countMode, 'page')

    const overflowFiltered = await service.listSources({
      organizationId: world.organizationId,
      projectId: world.projectId,
      query: baseQuery({ perPage: 50, attention: 'needs_review' }),
      access: ACCESS,
    })
    assert.isTrue(overflowFiltered.meta.scanTruncated, '超预算 + 维度过滤必须显式标注截断')
    assert.equal(overflowFiltered.meta.countMode, 'page')
  }).timeout(240000)

  test('稳定 tie-breaker：相同排序键的相邻页顺序确定且可复现', async ({ assert }) => {
    const world = await seedScaleWorld()
    const service = new DocumentIntelligenceWorkbenchService(
      new DefaultDocumentIntelligenceReadAdapters(),
    )

    const run = async () => {
      const res = await service.listSources({
        organizationId: world.organizationId,
        projectId: world.projectId,
        query: baseQuery({ page: 3, perPage: 25, sort: 'updated_at', direction: 'desc' }),
        access: ACCESS,
      })
      return res.data.map((r) => `${r.sourceKind}:${r.sourceId}`)
    }

    const first = await run()
    const second = await run()
    assert.deepEqual(second, first, '同一查询两次结果应完全一致（稳定 tie-breaker）')
  }).timeout(240000)
})
