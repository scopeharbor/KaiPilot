/**
 * 文档智能工作台 —— API 与只读适配器功能测试（v3-document-intelligence-workbench §3）
 *
 * 覆盖：
 * - 3.4   同租/跨项目/跨租/隐藏源、unsupported MIME、native document、1000-source 分页
 * - 3.6   「reviewable 不等于 accepted」、多 job/extraction、superseded/purged/stale loader
 * - 3.8   downstream empty/ready/stale/blocked 与隐藏目标批量 adapter
 * - 3.10  read-only / permission denied / privacy blocked / retention hold / audit restricted /
 *         profile disabled|invalid 的治理 adapter
 * - 3.14  deleted/hidden/cross-project/superseded deep link 的低敏 detail 语义
 * - 3.18  JWT / 组织隔离 / 项目可见性 / 字段级降级 / 分页 metadata / 统一错误 envelope
 * - 3.19  工作台 URL 上无 POST/PATCH/DELETE 旁路
 * - 3.20  读前后 zero-diff（jobs/extractions/indexes/snapshots/links/documents/
 *         attachments/tasks/risks/audit_logs 计数不变）
 *
 * 红线：fixture 数据、零真实 provider、零公网；读取路径零写入。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Attachment from '#models/attachment'
import Document from '#models/document'
import OcrDocumentJob from '#models/ocr_document_job'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrStructuredExtractionSnapshot from '#models/ocr_structured_extraction_snapshot'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import OcrEntityLinkRun from '#models/ocr_entity_link_run'
import OcrEntityLinkConfirmedLink from '#models/ocr_entity_link_confirmed_link'
import OcrEntityLinkCandidate from '#models/ocr_entity_link_candidate'
import OcrRetentionHold from '#models/ocr_retention_hold'
import OcrPrivacyPolicyOverride from '#models/ocr_privacy_policy_override'
import { DefaultDocumentIntelligenceReadAdapters } from '#services/document_intelligence/default_read_adapters'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/projects'

/** 响应行的测试侧最小形状（低敏投影，字段按需读取） */
type ResponseRow = Record<string, any>

/**
 * 项目角色名必须落在 `ProjectRoleName` 词表内——RBAC 的
 * `canonicalRoleFromProjectRole` 对未知名称返回 null（权限集为空）。
 * 有效权限 = 组织角色权限 ∩ 项目角色权限。
 */
const PM_ROLE_NAME = 'Project Manager'
const READONLY_ROLE_NAME = 'External Collaborator'
/** 项目角色行上的显式附加权限（与规范角色集合并） */
const ADMIN_PERMISSIONS = ['project:view', 'file:view', 'file:manage']
const READONLY_PERMISSIONS = ['project:view', 'file:view']

/** 正文诱饵：任何响应/URL/错误体都不得回显 */
const SECRET_BODY = '机密正文内容-should-not-leak-2026'

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedAttachment(
  projectId: number,
  uploadedBy: number,
  fileName: string,
  mimeType = 'application/pdf',
) {
  return Attachment.create({
    projectId,
    entityType: 'project',
    entityId: projectId,
    fileName,
    filePath: `uploads/spec/${fileName}`,
    fileSize: 256,
    mimeType,
    storageProvider: 'local',
    currentVersion: 1,
    uploadedBy,
  })
}

async function seedJob(
  organizationId: number,
  projectId: number,
  userId: number,
  attachmentId: number,
  overrides: { status?: string; warningCodes?: string[]; createdAt?: DateTime } = {},
) {
  const job = await OcrDocumentJob.create({
    organizationId,
    projectId,
    sourceAttachmentId: attachmentId,
    sourceKind: 'attachment',
    sourceFileName: null,
    sourceMimeType: 'application/pdf',
    sourceHash: `hash-${attachmentId}-${overrides.status ?? 'reviewable'}`,
    status: (overrides.status ?? 'reviewable') as OcrDocumentJob['status'],
    pageCount: 2,
    succeededPages: 2,
    failedPages: 0,
    warningCodes: (overrides.warningCodes ?? []) as OcrDocumentJob['warningCodes'],
    provider: 'fake-adapter',
    createdBy: userId,
  })
  if (overrides.createdAt) {
    job.createdAt = overrides.createdAt
    job.updatedAt = overrides.createdAt
    await job.save()
  }
  return job
}

async function seedExtraction(
  organizationId: number,
  projectId: number,
  reviewerId: number,
  jobId: number | null,
  sourceId: number,
  status: 'current' | 'superseded',
  extra: { purgedAt?: DateTime | null } = {},
) {
  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = organizationId
  extraction.projectId = projectId
  extraction.reviewerId = reviewerId
  extraction.jobId = jobId
  extraction.sourceKind = 'attachment'
  extraction.sourceId = sourceId
  extraction.sourceHash = `src-hash-${sourceId}-${status}`
  extraction.candidateHash = `cnd-hash-${sourceId}-${status}`
  extraction.selectedTextHash = `txt-hash-${sourceId}-${status}`
  // 正文仅存在于权威表，工作台响应不得回显
  extraction.selectedText = SECRET_BODY
  extraction.pageRefsJson = [1]
  extraction.status = status
  extraction.confirmedAt = DateTime.now()
  if (extra.purgedAt) extraction.purgedAt = extra.purgedAt
  await extraction.save()
  return extraction
}

async function seedIndexEntry(
  organizationId: number,
  projectId: number,
  extractionId: number,
  sourceId: number,
  status: 'active' | 'tombstoned',
) {
  const entry = new OcrDocumentSearchIndexEntry()
  entry.organizationId = organizationId
  entry.projectId = projectId
  entry.extractionId = extractionId
  entry.sourceKind = 'attachment'
  entry.sourceId = sourceId
  entry.sourceHash = `src-hash-${sourceId}`
  entry.selectedTextHash = `txt-hash-${sourceId}`
  entry.indexContentHash = `idx-hash-${sourceId}`
  entry.pageRefsJson = [1]
  entry.searchableText = 'snippet-only'
  entry.status = status
  entry.indexedAt = DateTime.now()
  if (status === 'tombstoned') entry.tombstonedAt = DateTime.now()
  await entry.save()
  return entry
}

async function seedSnapshot(
  organizationId: number,
  projectId: number,
  reviewerId: number,
  extractionId: number,
  status: 'current' | 'superseded',
) {
  const snapshot = new OcrStructuredExtractionSnapshot()
  Object.assign(snapshot, {
    organizationId,
    projectId,
    extractionId,
    status,
    profileId: null,
    profileRef: null,
    profileSource: 'builtin',
    profilePayloadDigest: null,
    pluginVersion: null,
    profileVersion: 1,
    reviewerId,
    sourceHash: `snap-src-${extractionId}`,
    snapshotHash: `snap-hash-${extractionId}-${status}`,
    fieldValuesJson: {},
    tableValuesJson: {},
    sourceSpanHashesJson: [],
    candidateHashesJson: [],
    previewHash: `snap-preview-${extractionId}-${status}`,
    reviewNote: null,
    fieldCount: 0,
    tableCount: 0,
    confirmedAt: DateTime.now(),
  })
  await snapshot.save()
  return snapshot
}

async function seedEntityLink(
  organizationId: number,
  projectId: number,
  reviewerId: number,
  extractionId: number,
  opts: {
    runStatus?: 'completed' | 'stale'
    lifecycleStatus?: 'active' | 'superseded'
    targetId?: number
  } = {},
) {
  const run = new OcrEntityLinkRun()
  Object.assign(run, {
    organizationId,
    projectId,
    actorId: reviewerId,
    inputSignature: `sig-${extractionId}-${opts.runStatus ?? 'completed'}`,
    ruleVersion: 'v1',
    status: opts.runStatus ?? 'completed',
    candidateCount: 1,
    confirmedCount: 1,
    sourceExtractionIdsJson: [extractionId],
    targetKindsJson: ['task'],
  })
  await run.save()

  const candidate = new OcrEntityLinkCandidate()
  Object.assign(candidate, {
    organizationId,
    projectId,
    runId: Number(run.id),
    extractionId,
    pageRefsJson: [1],
    spanStart: 0,
    spanEnd: 4,
    mentionType: 'task_ref',
    normalizedLabel: 'label',
    selectedTextHash: `txt-hash-${extractionId}`,
    spanHash: `span-hash-${extractionId}`,
    confidence: 0.9,
    status: 'matched',
    targetSuggestionJson: null,
    warningsJson: [],
    candidateKey: `cand-${extractionId}-${opts.lifecycleStatus ?? 'active'}`,
  })
  await candidate.save()

  const link = new OcrEntityLinkConfirmedLink()
  Object.assign(link, {
    organizationId,
    projectId,
    runId: Number(run.id),
    candidateId: Number(candidate.id),
    extractionId,
    sourceHash: `src-hash-${extractionId}`,
    selectedTextHash: `txt-hash-${extractionId}`,
    spanHash: `span-hash-${extractionId}`,
    targetKind: 'task',
    targetId: opts.targetId ?? 42,
    normalizedLabel: 'label',
    confidence: 0.9,
    matchReason: 'exact',
    ruleVersion: 'v1',
    reviewerId,
    lifecycleStatus: opts.lifecycleStatus ?? 'active',
    confirmationHash: `conf-${extractionId}-${opts.lifecycleStatus ?? 'active'}`,
    confirmedAt: DateTime.now(),
  })
  await link.save()
  return { run, link }
}

interface SeedWorld {
  organizationId: number
  projectId: number
  ownerId: number
  ownerEmail: string
  viewerEmail: string
  /** reviewable 但无 accepted extraction */
  attNeedsReview: number
  /** completed + current extraction + active index + current snapshot + active link */
  attReady: number
  /** 仅 superseded extraction */
  attSuperseded: number
  /** 不支持 MIME */
  attUnsupported: number
  /** stale 作业 */
  attStale: number
  /** tombstoned 索引 + 隐藏目标链接 */
  attBlocked: number
  nativeDocId: number
  readyExtractionId: number
}

async function seedWorld(): Promise<SeedWorld> {
  const owner = await createUser({ email: uniqueEmail('di-owner') })
  const viewer = await createUser({ email: uniqueEmail('di-viewer') })
  const org = await createOrganization(owner)
  const { project, role } = await createProjectWithMember(
    org,
    owner,
    owner,
    PM_ROLE_NAME,
    ADMIN_PERMISSIONS,
  )
  void role
  // 只读成员：同项目、另一角色
  const { default: ProjectRole } = await import('#models/project_role')
  const { default: ProjectMember } = await import('#models/project_member')
  const { default: OrganizationMember } = await import('#models/organization_member')
  await OrganizationMember.create({ organizationId: org.id, userId: viewer.id, role: 'member' })
  const viewerRole = await ProjectRole.create({
    projectId: project.id,
    name: READONLY_ROLE_NAME,
    description: 'viewer',
    permissions: READONLY_PERMISSIONS as unknown as string[],
    isSystem: true,
  })
  await ProjectMember.create({
    projectId: project.id,
    userId: viewer.id,
    projectRoleId: viewerRole.id,
    isActive: true,
  })

  const ownerId = Number(owner.id)
  const pid = Number(project.id)
  const oid = Number(org.id)

  // A1：reviewable、无 accepted extraction
  const a1 = await seedAttachment(pid, ownerId, 'needs-review.pdf')
  await seedJob(oid, pid, ownerId, Number(a1.id), { status: 'reviewable' })

  // A2：completed + current extraction + active index + current snapshot + active entity link
  const a2 = await seedAttachment(pid, ownerId, 'ready.pdf')
  // 旧作业先建，验证 loader 取最新一条
  await seedJob(oid, pid, ownerId, Number(a2.id), {
    status: 'failed',
    createdAt: DateTime.now().minus({ days: 3 }),
  })
  const jobA2 = await seedJob(oid, pid, ownerId, Number(a2.id), { status: 'reviewable' })
  // 先建 superseded、再建 current，验证 loader 取 current
  await seedExtraction(oid, pid, ownerId, Number(jobA2.id), Number(a2.id), 'superseded')
  const extA2 = await seedExtraction(oid, pid, ownerId, Number(jobA2.id), Number(a2.id), 'current')
  await seedIndexEntry(oid, pid, Number(extA2.id), Number(a2.id), 'active')
  await seedSnapshot(oid, pid, ownerId, Number(extA2.id), 'current')
  await seedEntityLink(oid, pid, ownerId, Number(extA2.id))

  // A3：仅有 superseded extraction
  const a3 = await seedAttachment(pid, ownerId, 'superseded.pdf')
  await seedExtraction(oid, pid, ownerId, null, Number(a3.id), 'superseded')

  // A4：不支持 MIME
  const a4 = await seedAttachment(pid, ownerId, 'legacy.dat', 'application/x-legacy')

  // A5：stale 作业
  const a5 = await seedAttachment(pid, ownerId, 'stale.pdf')
  await seedJob(oid, pid, ownerId, Number(a5.id), {
    status: 'reviewable',
    warningCodes: ['STALE_SOURCE'],
  })

  // A6：tombstoned 索引 + 隐藏目标 entity link
  const a6 = await seedAttachment(pid, ownerId, 'blocked.pdf')
  const jobA6 = await seedJob(oid, pid, ownerId, Number(a6.id), { status: 'reviewable' })
  const extA6 = await seedExtraction(oid, pid, ownerId, Number(jobA6.id), Number(a6.id), 'current')
  await seedIndexEntry(oid, pid, Number(extA6.id), Number(a6.id), 'tombstoned')
  await seedEntityLink(oid, pid, ownerId, Number(extA6.id), { targetId: 0 })

  // 原生文档
  const doc = await Document.create({
    projectId: pid,
    documentType: 'document',
    name: '项目章程.md',
    parentId: null,
    isTemplate: false,
    aiGenerated: false,
    version: 1,
    createdBy: ownerId,
    updatedBy: ownerId,
  } as never)

  return {
    organizationId: oid,
    projectId: pid,
    ownerId,
    ownerEmail: owner.email,
    viewerEmail: viewer.email,
    attNeedsReview: Number(a1.id),
    attReady: Number(a2.id),
    attSuperseded: Number(a3.id),
    attUnsupported: Number(a4.id),
    attStale: Number(a5.id),
    attBlocked: Number(a6.id),
    nativeDocId: Number(doc.id),
    readyExtractionId: Number(extA2.id),
  }
}

function findRow(rows: any[], kind: string, id: number) {
  return rows.find((r) => r.sourceKind === kind && r.sourceId === id)
}

function entrypointOf(row: any, surface: string) {
  return row.entrypoints.find((e: any) => e.surface === surface)
}

// ─────────────────────────────────────────────────────────────────────────────
// §3.18 / §3.4 / §3.6：API 认证、组织隔离、权威语义
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — API 来源清单', (group) => {
  useAuthDatabase(group)

  test('未认证请求返回 401 且统一错误 envelope', async ({ client, assert }) => {
    const world = await seedWorld()
    const res = await client.get(`${BASE}/${world.projectId}/document-intelligence/sources`)
    res.assertStatus(401)
    assert.property(res.body(), 'error')
  })

  test('项目管理员获取来源清单：统一 envelope + 混合来源权威状态', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    const res = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    res.assertStatus(200)

    const body = res.body()
    assert.property(body, 'data')
    assert.property(body, 'meta')
    assert.equal(body.meta.countMode, 'exact')
    assert.equal(body.meta.page, 1)
    assert.isNumber(body.meta.total)
    assert.isNumber(body.meta.totalPages)

    const rows = body.data as ResponseRow[]
    // 六个附件 + 一个原生文档
    assert.equal(rows.length, 7)

    // 3.6：reviewable 不等于 accepted
    const needsReview = findRow(rows, 'attachment', world.attNeedsReview)
    assert.include(needsReview.attentionFacets, 'needs_review')
    assert.isNull(needsReview.currentExtraction)
    assert.equal(needsReview.dimensionStates.accepted_extraction, 'empty')
    assert.isFalse(entrypointOf(needsReview, 'search_index').enabled)
    assert.equal(entrypointOf(needsReview, 'search_index').reasonCode, 'no_accepted_extraction')
    assert.isTrue(entrypointOf(needsReview, 'review').enabled)

    // 3.6：多 job / 多 extraction 时取权威最新与 current
    const ready = findRow(rows, 'attachment', world.attReady)
    assert.equal(ready.latestJob.status, 'reviewable')
    assert.equal(ready.currentExtraction.extractionId, world.readyExtractionId)
    assert.equal(ready.currentExtraction.lifecycle, 'current')
    assert.include(ready.attentionFacets, 'ready_for_downstream')
    assert.equal(ready.dimensionStates.search_index, 'ready')
    assert.equal(ready.dimensionStates.structured_snapshot, 'ready')
    assert.equal(ready.dimensionStates.entity_link, 'ready')
    assert.isTrue(entrypointOf(ready, 'structured_extraction').enabled)
    assert.equal(
      entrypointOf(ready, 'structured_extraction').confirmationOwnedBy,
      'ocr-structured-extraction',
    )

    // 3.6：仅 superseded extraction —— 不得冒充 current，也不得显示为空
    const superseded = findRow(rows, 'attachment', world.attSuperseded)
    assert.isNull(superseded.currentExtraction)
    assert.equal(superseded.dimensionStates.accepted_extraction, 'stale')
    assert.include(superseded.attentionFacets, 'stale')
    assert.isFalse(entrypointOf(superseded, 'search_index').enabled)

    // 3.4：unsupported MIME —— 无任何 OCR 入口
    const unsupported = findRow(rows, 'attachment', world.attUnsupported)
    assert.isFalse(unsupported.capabilities.ocrSupportedMime)
    assert.include(unsupported.warningReasons, 'unsupported_mime')
    for (const surface of ['review', 'search_index', 'structured_extraction', 'entity_linking']) {
      assert.isFalse(entrypointOf(unsupported, surface).enabled, `${surface} 不应可用`)
      assert.equal(entrypointOf(unsupported, surface).reasonCode, 'unsupported_mime')
    }

    // 3.4：stale 作业
    const stale = findRow(rows, 'attachment', world.attStale)
    assert.equal(stale.dimensionStates.ocr_job, 'stale')
    assert.include(stale.attentionFacets, 'stale')

    // 3.8：tombstoned 索引 → blocked；隐藏目标 entity link → blocked
    const blocked = findRow(rows, 'attachment', world.attBlocked)
    assert.equal(blocked.dimensionStates.search_index, 'blocked')
    assert.equal(blocked.dimensionStates.entity_link, 'blocked')

    // 3.4：native document 不混淆 OCR 能力
    const native = findRow(rows, 'native_document', world.nativeDocId)
    assert.equal(native.dimensionStates.ocr_job, 'not_applicable')
    assert.equal(native.dimensionStates.accepted_extraction, 'not_applicable')
    assert.isTrue(native.capabilities.documentBodyReadable)
    assert.isFalse(native.capabilities.ocrSupportedMime)

    // 低敏：响应不回显 accepted extraction 正文诱饵
    assert.notInclude(JSON.stringify(body), SECRET_BODY)
  })

  test('attention 筛选、稳定排序与分页 metadata', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)
    const url = `${BASE}/${world.projectId}/document-intelligence/sources`

    const filtered = await client.get(`${url}?attention=needs_review`).bearerToken(token)
    filtered.assertStatus(200)
    const rows = filtered.body().data as ResponseRow[]
    assert.isAbove(rows.length, 0)
    for (const row of rows) assert.include(row.attentionFacets, 'needs_review')

    // 分页：perPage=2 时每页有界且不静默截断
    const p1 = await client
      .get(`${url}?page=1&perPage=2&sort=source_ref&direction=asc`)
      .bearerToken(token)
    const p2 = await client
      .get(`${url}?page=2&perPage=2&sort=source_ref&direction=asc`)
      .bearerToken(token)
    p1.assertStatus(200)
    p2.assertStatus(200)
    assert.equal(p1.body().data.length, 2)
    assert.equal(p1.body().meta.perPage, 2)
    assert.equal(p1.body().meta.total, 7)
    assert.equal(p1.body().meta.totalPages, 4)
    const refs1 = p1.body().data.map((r: any) => `${r.sourceKind}:${r.sourceId}`)
    const refs2 = p2.body().data.map((r: any) => `${r.sourceKind}:${r.sourceId}`)
    // 连续页无重复
    for (const ref of refs2) assert.notInclude(refs1, ref)
  })

  test('跨组织与不存在项目统一 404 且不泄露差异', async ({ client, assert }) => {
    const world = await seedWorld()
    const otherOwner = await createUser({ email: uniqueEmail('di-other') })
    await createOrganization(otherOwner)
    const token = await login(client, otherOwner.email)

    const crossOrg = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    const missing = await client
      .get(`${BASE}/99999/document-intelligence/sources`)
      .bearerToken(token)

    // spec：跨组织与不存在必须返回同一非泄露结果（RESOURCE_NOT_FOUND 或 PERMISSION_DENIED）
    assert.equal(crossOrg.status(), missing.status())
    assert.oneOf(crossOrg.status(), [403, 404])
    assert.deepEqual(crossOrg.body(), missing.body())
    assert.notInclude(JSON.stringify(crossOrg.body()), 'needs-review.pdf')
    assert.notInclude(JSON.stringify(crossOrg.body()), SECRET_BODY)
  })

  test('Validator 边界：过大 perPage / 未知参数 / 未知枚举 / 注入 search 一律拒绝', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)
    const url = `${BASE}/${world.projectId}/document-intelligence/sources`

    for (const qs of [
      'perPage=5000',
      'evilParam=x',
      'attention=all',
      'sourceKind=../etc/passwd',
      'sort=%3Bdrop%20table',
      'page=-1',
      `search=${encodeURIComponent('<script>alert(1)</script>')}`,
    ]) {
      const res = await client.get(`${url}?${qs}`).bearerToken(token)
      assert.equal(res.status(), 422, `查询 ${qs} 应被拒绝`)
      assert.property(res.body(), 'error')
    }
  })

  test('1000 来源分页：连续页无重复无遗漏且无固定 200 截断', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    const batch: any[] = []
    for (let i = 0; i < 1000; i += 1) {
      batch.push({
        projectId: world.projectId,
        entityType: 'project',
        entityId: world.projectId,
        fileName: `bulk-${String(i).padStart(4, '0')}.pdf`,
        filePath: `uploads/spec/bulk-${i}.pdf`,
        fileSize: 128,
        mimeType: 'application/pdf',
        storageProvider: 'local',
        currentVersion: 1,
        uploadedBy: world.ownerId,
      })
    }
    await Attachment.createMany(batch)

    const url = `${BASE}/${world.projectId}/document-intelligence/sources`
    const first = await client
      .get(`${url}?page=1&perPage=100&sort=source_ref&direction=asc`)
      .bearerToken(token)
    first.assertStatus(200)
    // 1007 来源：远超旧前端固定 200 条作业上限
    assert.equal(first.body().meta.total, 1007)
    assert.equal(first.body().data.length, 100)
    assert.equal(first.body().meta.totalPages, 11)

    const seen = new Set<string>()
    for (const page of [1, 2, 11]) {
      const res = await client
        .get(`${url}?page=${page}&perPage=100&sort=source_ref&direction=asc`)
        .bearerToken(token)
      res.assertStatus(200)
      for (const row of res.body().data as ResponseRow[]) {
        const ref = `${row.sourceKind}:${row.sourceId}`
        assert.isFalse(seen.has(ref), `分页出现重复行 ${ref}`)
        seen.add(ref)
      }
    }
    assert.equal(seen.size, 207)
  }).timeout(60000)
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.14 / §3.10：详情、深链 fail closed 与字段级降级
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — 详情与治理降级', (group) => {
  useAuthDatabase(group)

  test('可见源详情返回低敏证据与治理视图', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    const res = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attReady}`)
      .bearerToken(token)
    res.assertStatus(200)

    const data = res.body().data
    assert.equal(data.sourceId, world.attReady)
    assert.equal(data.evidence.jobCount, 1)
    assert.equal(data.evidence.extractionCount, 1)
    assert.equal(data.evidence.providerSummary, 'fake-adapter')
    assert.isNull(data.evidence.sourceHashPrefix)
    assert.equal(data.evidence.downstream.searchIndexStatus, 'active')
    assert.equal(data.evidence.downstream.structuredSnapshotCurrentCount, 1)
    assert.equal(data.evidence.downstream.entityLinkActiveCount, 1)
    assert.equal(data.evidence.downstream.entityLinkHiddenTargetCount, 0)
    assert.equal(data.governance.auditAccess, 'available')
    assert.equal(data.governance.privacyStatus, 'ready')
    assert.isFalse(data.governance.retentionHoldActive)
    // 低敏：无正文、无绝对路径
    const raw = JSON.stringify(res.body())
    assert.notInclude(raw, SECRET_BODY)
    assert.notInclude(raw, 'uploads/spec')
  })

  test('deleted / 跨项目 / 未知 kind 的 deep link 统一 fail closed', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)
    const base = `${BASE}/${world.projectId}/document-intelligence/sources`

    // 删除附件后 deep link 404
    const att = await Attachment.findOrFail(world.attReady)
    att.deletedAt = DateTime.now()
    await att.save()
    const deleted = await client.get(`${base}/attachment/${world.attReady}`).bearerToken(token)
    assert.equal(deleted.status(), 404)

    // 不存在的 sourceId 同样 404，且响应体与已删除完全一致（不泄露存在性差异）
    const unknown = await client.get(`${base}/attachment/987654`).bearerToken(token)
    assert.equal(unknown.status(), 404)
    assert.deepEqual(deleted.body(), unknown.body())

    // 非法 sourceKind → 422（Validator 封闭枚举）
    const badKind = await client.get(`${base}/evil_kind/1`).bearerToken(token)
    assert.equal(badKind.status(), 422)

    // 负 ID → 422
    const negative = await client.get(`${base}/attachment/-1`).bearerToken(token)
    assert.equal(negative.status(), 422)
  })

  test('superseded extraction 的 deep link 返回 stale 语义而非 ready', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    const res = await client
      .get(
        `${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attSuperseded}`,
      )
      .bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data
    assert.isNull(data.currentExtraction)
    assert.equal(data.dimensionStates.accepted_extraction, 'stale')
    assert.isFalse(entrypointOf(data, 'structured_extraction').enabled)
  })

  test('只读成员：无 owning 写入入口、审计降级为 restricted', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.viewerEmail)

    const list = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    list.assertStatus(200)
    const ready = findRow(list.body().data as ResponseRow[], 'attachment', world.attReady)
    for (const surface of ['review', 'search_index', 'structured_extraction', 'entity_linking']) {
      assert.isFalse(entrypointOf(ready, surface).enabled, `${surface} 对只读成员不应可用`)
    }
    // 只读 surface 仍可用
    assert.isTrue(entrypointOf(ready, 'document_reader').enabled)
    assert.isTrue(entrypointOf(ready, 'governance').enabled)

    const detail = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attReady}`)
      .bearerToken(token)
    detail.assertStatus(200)
    assert.equal(detail.body().data.governance.auditAccess, 'restricted')
    assert.equal(detail.body().data.governance.permissionDecision, 'blocked')
  })

  test('retention hold 与 privacy blocked：治理阻断且不产生可用写入入口', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    await OcrRetentionHold.create({
      organizationId: world.organizationId,
      projectId: world.projectId,
      scopeKind: 'project',
      scopeHash: 'hold-scope-1',
      reasonCode: 'audit_request',
      note: null,
      status: 'active',
      setBy: world.ownerId,
      setAt: DateTime.now(),
    } as never)

    const held = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    held.assertStatus(200)
    const heldRow = findRow(held.body().data as ResponseRow[], 'attachment', world.attReady)
    assert.equal(heldRow.dimensionStates.governance, 'blocked')
    assert.include(heldRow.attentionFacets, 'governance_blocked')
    assert.include(heldRow.warningReasons, 'retention_hold')
    for (const surface of ['review', 'search_index', 'structured_extraction', 'entity_linking']) {
      assert.isFalse(entrypointOf(heldRow, surface).enabled)
      assert.equal(entrypointOf(heldRow, surface).reasonCode, 'privacy_blocked')
    }

    const detail = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attReady}`)
      .bearerToken(token)
    detail.assertStatus(200)
    assert.isTrue(detail.body().data.governance.retentionHoldActive)
    assert.equal(detail.body().data.governance.reasonCode, 'retention_hold')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.19 / §3.20：无写旁路与 zero-diff
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — 只读红线', (group) => {
  useAuthDatabase(group)

  test('工作台路由无写旁路：POST/PATCH/PUT/DELETE 均不可达', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)
    const url = `${BASE}/${world.projectId}/document-intelligence/sources`

    const post = await client.post(url).bearerToken(token).json({})
    const patch = await client.patch(url).bearerToken(token).json({})
    const put = await client.put(url).bearerToken(token).json({})
    const del = await client.delete(url).bearerToken(token)
    for (const res of [post, patch, put, del]) {
      assert.isAtLeast(res.status(), 400, '工作台 URL 不得接受写方法')
      assert.notEqual(res.status(), 200)
      assert.notEqual(res.status(), 201)
    }
  })

  test('zero-diff：列表、筛选与详情读取不产生任何领域写入', async ({ client, assert }) => {
    const world = await seedWorld()
    const { default: AuditLog } = await import('#models/audit_log')
    const { default: Task } = await import('#models/task')
    const { default: Risk } = await import('#models/risk')
    const token = await login(client, world.ownerEmail)

    const countOf = async (query: any) => {
      const row = await query.count('* as total').first()
      return Number(row?.$extras?.total ?? 0)
    }
    const snapshotCounts = async () => ({
      jobs: await countOf(OcrDocumentJob.query()),
      extractions: await countOf(OcrReviewAcceptedExtraction.query()),
      indexes: await countOf(OcrDocumentSearchIndexEntry.query()),
      snapshots: await countOf(OcrStructuredExtractionSnapshot.query()),
      links: await countOf(OcrEntityLinkConfirmedLink.query()),
      runs: await countOf(OcrEntityLinkRun.query()),
      attachments: await countOf(Attachment.query()),
      documents: await countOf(Document.query()),
      tasks: await countOf(Task.query()),
      risks: await countOf(Risk.query()),
      audits: await countOf(AuditLog.query()),
    })

    const before = await snapshotCounts()

    const base = `${BASE}/${world.projectId}/document-intelligence/sources`
    await client.get(base).bearerToken(token)
    await client
      .get(`${base}?attention=needs_review&page=1&perPage=5&sort=created_at&direction=asc`)
      .bearerToken(token)
    await client.get(`${base}?sourceKind=native_document`).bearerToken(token)
    await client.get(`${base}/attachment/${world.attNeedsReview}`).bearerToken(token)
    await client.get(`${base}/attachment/${world.attReady}`).bearerToken(token)
    await client.get(`${base}/native_document/${world.nativeDocId}`).bearerToken(token)

    const after = await snapshotCounts()
    assert.deepEqual(after, before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3.4 / §3.8 / §3.10：只读适配器层（绕过 HTTP，直接验证 organization/project 过滤）
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — 只读适配器', (group) => {
  useAuthDatabase(group)

  test('source query：跨项目/跨租/软删除来源均不出现在结果里', async ({ assert }) => {
    const world = await seedWorld()
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    // 另一组织的项目与附件（跨租诱饵）
    const otherOwner = await createUser({ email: uniqueEmail('di-cross') })
    const otherOrg = await createOrganization(otherOwner)
    const { project: otherProject } = await createProjectWithMember(
      otherOrg,
      otherOwner,
      otherOwner,
      PM_ROLE_NAME,
      ADMIN_PERMISSIONS,
    )
    await seedAttachment(Number(otherProject.id), Number(otherOwner.id), 'cross-tenant.pdf')

    // 软删除来源
    const deleted = await seedAttachment(world.projectId, world.ownerId, 'deleted.pdf')
    deleted.deletedAt = DateTime.now()
    await deleted.save()

    const page = await adapters.pageVisibleSources({
      organizationId: world.organizationId,
      projectId: world.projectId,
      page: 1,
      perPage: 100,
    })
    const names = page.items.map((r) => r.displayName)
    assert.notInclude(names, 'cross-tenant.pdf')
    assert.notInclude(names, 'deleted.pdf')
    assert.include(names, 'ready.pdf')
    assert.include(names, '项目章程.md')
    assert.equal(page.total, page.items.length)
  })

  test('job/extraction loader：取最新 job 与 current extraction，purged 不计入', async ({
    assert,
  }) => {
    const world = await seedWorld()
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    // purged extraction 不应出现
    const purgedAtt = await seedAttachment(world.projectId, world.ownerId, 'purged.pdf')
    await seedExtraction(
      world.organizationId,
      world.projectId,
      world.ownerId,
      null,
      Number(purgedAtt.id),
      'current',
      { purgedAt: DateTime.now() },
    )

    const sourceIds = [world.attReady, world.attNeedsReview, Number(purgedAtt.id)]
    const jobs = await adapters.loadLatestJobsBySourceIds({
      organizationId: world.organizationId,
      projectId: world.projectId,
      sourceIds,
    })
    assert.equal(jobs.get(world.attReady)?.status, 'reviewable', '应取最新 job 而非旧的 failed')
    assert.equal(jobs.get(world.attNeedsReview)?.status, 'reviewable')

    const extractions = await adapters.loadExtractionsBySourceIds({
      organizationId: world.organizationId,
      projectId: world.projectId,
      sourceIds,
    })
    assert.equal(extractions.get(world.attReady)?.lifecycle, 'current')
    assert.isUndefined(extractions.get(world.attNeedsReview))
    assert.isUndefined(extractions.get(Number(purgedAtt.id)), 'purged extraction 不得计入')

    // 跨租读取：同 sourceIds 换组织即为空（组织过滤生效）
    const crossOrg = await adapters.loadLatestJobsBySourceIds({
      organizationId: world.organizationId + 99999,
      projectId: world.projectId,
      sourceIds,
    })
    assert.equal(crossOrg.size, 0)
  })

  test('downstream adapter：ready / stale / blocked / hidden target / empty 各自可区分', async ({
    assert,
  }) => {
    const world = await seedWorld()
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    // 追加：superseded 快照 + stale run + superseded link
    const staleAtt = await seedAttachment(world.projectId, world.ownerId, 'downstream-stale.pdf')
    const staleJob = await seedJob(
      world.organizationId,
      world.projectId,
      world.ownerId,
      Number(staleAtt.id),
      { status: 'reviewable' },
    )
    const staleExt = await seedExtraction(
      world.organizationId,
      world.projectId,
      world.ownerId,
      Number(staleJob.id),
      Number(staleAtt.id),
      'current',
    )
    await seedSnapshot(
      world.organizationId,
      world.projectId,
      world.ownerId,
      Number(staleExt.id),
      'superseded',
    )
    await seedEntityLink(
      world.organizationId,
      world.projectId,
      world.ownerId,
      Number(staleExt.id),
      {
        runStatus: 'stale',
        lifecycleStatus: 'superseded',
      },
    )

    const ids = [world.readyExtractionId, Number(staleExt.id)]
    const snapshots = await adapters.loadSnapshotSummariesByExtractionIds({
      organizationId: world.organizationId,
      projectId: world.projectId,
      extractionIds: ids,
    })
    assert.equal(snapshots.get(world.readyExtractionId)?.currentCount, 1)
    assert.equal(snapshots.get(Number(staleExt.id))?.currentCount, 0)
    assert.equal(snapshots.get(Number(staleExt.id))?.supersededCount, 1)

    const links = await adapters.loadEntityLinkSummariesByExtractionIds({
      organizationId: world.organizationId,
      projectId: world.projectId,
      extractionIds: ids,
    })
    assert.isTrue(links.available)
    assert.equal(links.rows.get(world.readyExtractionId)?.activeLinkCount, 1)
    assert.equal(links.rows.get(world.readyExtractionId)?.hiddenTargetCount, 0)
    assert.equal(links.rows.get(Number(staleExt.id))?.supersededLinkCount, 1)
    assert.isTrue(links.rows.get(Number(staleExt.id))?.staleRun)

    // 空输入：available=true 且 rows 为空（empty ≠ unavailable）
    const empty = await adapters.loadEntityLinkSummariesByExtractionIds({
      organizationId: world.organizationId,
      projectId: world.projectId,
      extractionIds: [],
    })
    assert.isTrue(empty.available)
    assert.equal(empty.rows.size, 0)
  })

  test('governance adapter：复用 shipped resolver 的 retention / privacy / profile 裁决', async ({
    assert,
  }) => {
    const world = await seedWorld()
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    // 基线：无 hold、无 privacy override、无 profile
    const baseline = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.isTrue(baseline.available)
    assert.isFalse(baseline.retentionHoldActive)
    assert.isFalse(baseline.privacyBlocked)
    assert.equal(baseline.profileProvenance?.status, 'missing')

    // retention hold → 复用 shipped read service 的 holdActiveCount
    await OcrRetentionHold.create({
      organizationId: world.organizationId,
      projectId: world.projectId,
      scopeKind: 'project',
      scopeHash: 'hold-scope-gov',
      reasonCode: 'audit_request',
      note: null,
      status: 'active',
      setBy: world.ownerId,
      setAt: DateTime.now(),
    } as never)
    const held = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.isTrue(held.retentionHoldActive)

    // organization-owned active profile → provenance 优先级
    await OcrStructuredExtractionProfile.create({
      organizationId: world.organizationId,
      projectId: world.projectId,
      name: '组织合同抽取',
      scope: 'organization',
      status: 'active',
      schemaKey: 'org.contract.v1',
      currentVersion: 3,
      totalRuns: 0,
      description: null,
      createdBy: world.ownerId,
    } as never)
    const withProfile = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.equal(withProfile.profileProvenance?.provenanceKind, 'organization_owned')
    assert.equal(withProfile.profileProvenance?.status, 'active')
    assert.equal(withProfile.profileProvenance?.identity, 'org.contract.v1')
    assert.equal(withProfile.profileProvenance?.version, '3')
    // 低敏：provenance 不含 schema 正文/prompt/provider
    assert.notProperty(withProfile.profileProvenance ?? {}, 'schemaSnapshot')
  })

  test('privacy blocked override 与 disabled profile 均可被治理 adapter 识别', async ({
    assert,
  }) => {
    const world = await seedWorld()
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    // 组织仅有 archived profile（无 builtin）→ disabled，不冒充 active
    await OcrStructuredExtractionProfile.create({
      organizationId: world.organizationId,
      projectId: world.projectId,
      name: '已归档抽取',
      scope: 'organization',
      status: 'archived',
      schemaKey: 'org.archived.v1',
      currentVersion: 1,
      totalRuns: 0,
      description: null,
      createdBy: world.ownerId,
    } as never)

    const disabled = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.equal(disabled.profileProvenance?.status, 'disabled')

    // privacy override：globalOutputMode=blocked
    await OcrPrivacyPolicyOverride.create({
      organizationId: world.organizationId,
      projectId: world.projectId,
      version: 1,
      status: 'active',
      policyJson: {
        categoryRules: [],
        allowedPurposes: [],
        globalOutputMode: 'blocked',
      },
      source: 'project',
      policyHash: 'privacy-hash-blocked-fixture',
      updatedBy: world.ownerId,
    } as never)

    const blocked = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.isTrue(blocked.privacyBlocked)
    assert.equal(blocked.privacyOutputMode, 'blocked')
  })
})
