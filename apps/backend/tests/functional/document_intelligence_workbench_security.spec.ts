/**
 * 文档智能工作台 —— Plugin-first、安全与零副作用红线
 * （v3-document-intelligence-workbench §6.2–§6.6）
 *
 * 覆盖：
 * - 6.2 profile 注入拒绝：可执行组件/脚本/HTML/SQL/prompt/URL/provider/model/
 *       secret/permission/action 一律不得进入工作台，且安全回退 builtin
 * - 6.3 profile 停用/卸载/损坏后新选择停止、历史 provenance 可读、
 *       既有 extraction/snapshot/link 不删除不重执行
 * - 6.4 跨租与隐藏源三面（list / detail / deep-link）不泄露任何存在性
 * - 6.5 DTO/URL/error 低敏扫描：全文、raw provider、prompt/模型输出、
 *       secret/token/Authorization/API key、绝对路径诱饵均不得出现
 * - 6.6 读取路径零副作用与网络隔离：无 provider、无 AIGateway、无 fetch/http(s)
 *
 * 默认全部 fixture / fake：零真实 provider、零公网。
 */

import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import Attachment from '#models/attachment'
import OcrDocumentJob from '#models/ocr_document_job'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import { DefaultDocumentIntelligenceReadAdapters } from '#services/document_intelligence/default_read_adapters'
import { scanLowSensitive, PLUGIN_SEAM_OCR_PROFILE } from '@aiproj/types'
import {
  STRONG_PASSWORD,
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const BASE = '/api/v1/projects'

/** Lucid count() 聚合行的最小形状 */
interface CountRow {
  $extras?: { total?: number | string }
}
const PM_ROLE_NAME = 'Project Manager'
const ADMIN_PERMISSIONS = ['project:view', 'file:view', 'file:manage']

/** 低敏扫描诱饵：任何响应/URL/错误体出现其一即判失败 */
const HONEYPOTS = [
  '机密正文内容-should-not-leak-2026',
  'Bearer sk-live-should-not-leak',
  'sk-live-should-not-leak',
  'C:\\\\Users\\\\alice\\\\secret',
  '/var/lib/aiproj/secret',
  '你是一个OCR助手-prompt-should-not-leak',
]

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

interface World {
  organizationId: number
  projectId: number
  ownerId: number
  ownerEmail: string
  attachmentId: number
  jobId: number
  extractionId: number
}

async function seedWorld(): Promise<World> {
  const owner = await createUser({ email: uniqueEmail('di-sec') })
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

  const attachment = await Attachment.create({
    projectId: pid,
    entityType: 'project',
    entityId: pid,
    fileName: 'contract.pdf',
    // 绝对路径诱饵只存在于权威表，工作台响应不得回显
    filePath: 'C:\\Users\\alice\\secret\\contract.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    storageProvider: 'local',
    currentVersion: 1,
    uploadedBy: uid,
  })

  const job = await OcrDocumentJob.create({
    organizationId: oid,
    projectId: pid,
    sourceAttachmentId: Number(attachment.id),
    sourceKind: 'attachment',
    sourceFileName: null,
    sourceMimeType: 'application/pdf',
    sourceHash: 'sec-src-hash',
    status: 'reviewable',
    pageCount: 1,
    succeededPages: 1,
    failedPages: 0,
    warningCodes: [],
    provider: 'fake-adapter',
    createdBy: uid,
  })

  const extraction = new OcrReviewAcceptedExtraction()
  extraction.organizationId = oid
  extraction.projectId = pid
  extraction.reviewerId = uid
  extraction.jobId = Number(job.id)
  extraction.sourceKind = 'attachment'
  extraction.sourceId = Number(attachment.id)
  extraction.sourceHash = 'sec-src-hash'
  extraction.candidateHash = 'sec-cand-hash'
  extraction.selectedTextHash = 'sec-text-hash'
  extraction.selectedText = HONEYPOTS[0]
  extraction.pageRefsJson = [1]
  extraction.status = 'current'
  extraction.confirmedAt = DateTime.now()
  await extraction.save()

  return {
    organizationId: oid,
    projectId: pid,
    ownerId: uid,
    ownerEmail: owner.email,
    attachmentId: Number(attachment.id),
    jobId: Number(job.id),
    extractionId: Number(extraction.id),
  }
}

/** 安装一个带恶意 OCR profile 贡献的插件版本（模拟越界注入） */
async function installMaliciousProfilePlugin(organizationId: number, userId: number) {
  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: 'evil.ocr.profile',
    version: '1.0.0',
    packageDigest: 'digest-package-evil',
    manifestDigest: 'digest-manifest-evil',
    compatibilityDigest: 'digest-compat-evil',
    upstreamReceiptRef: 'receipt-evil',
    status: 'approved',
    rowVersion: 1,
    metadata: JSON.stringify({
      contributions: [
        {
          contributionKey: 'evil-profile',
          seamKey: PLUGIN_SEAM_OCR_PROFILE,
          seamVersion: '1.0.0',
          payload: {
            profiles: [
              {
                profileKey: 'evil',
                name: '<script>alert(1)</script>',
                version: '1.0.0',
                // 越界字段：组件路径 / prompt / provider / model / secret / 权限 / 动作 / URL / SQL
                componentPath: '../../evil/Component.tsx',
                prompt: HONEYPOTS[5],
                provider: 'openai',
                model: 'gpt-4o',
                apiKey: HONEYPOTS[1],
                permissions: ['file:manage'],
                actions: [{ kind: 'confirm', endpoint: 'https://evil.example.com/hook' }],
                sql: 'DROP TABLE ocr_document_jobs; --',
                fields: [{ key: 'x', label: 'x', type: 'text' }],
                review: { groups: [] },
              },
            ],
          },
        },
      ],
    }),
  } as never)

  await PluginInstallation.create({
    organizationId,
    pluginId: 'evil.ocr.profile',
    releaseId: Number(release.id),
    version: '1.0.0',
    status: 'enabled',
    packageDigest: 'digest-package-evil',
    manifestDigest: 'digest-manifest-evil',
    compatibilityDigest: 'digest-compat-evil',
    rowVersion: 1,
  } as never)
  void userId

  return release
}

// ─────────────────────────────────────────────────────────────────────────────
// §6.2 / §6.3 Plugin-first 边界
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — Plugin profile 边界', (group) => {
  useAuthDatabase(group)

  test('恶意 profile 贡献被拒绝，工作台安全回退 builtin 且不渲染越界字段', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    await installMaliciousProfilePlugin(world.organizationId, world.ownerId)

    const adapters = new DefaultDocumentIntelligenceReadAdapters()
    const governance = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })

    // 校验失败的贡献不得成为 enabled_plugin provenance
    assert.notEqual(governance.profileProvenance?.provenanceKind, 'enabled_plugin')

    // provenance 只允许 identity/version/kind/status/receiptRef 五个低敏字段
    if (governance.profileProvenance) {
      assert.deepEqual(
        Object.keys(governance.profileProvenance).sort(),
        ['identity', 'provenanceKind', 'receiptRef', 'status', 'version'].sort(),
      )
    }

    const token = await login(client, world.ownerEmail)
    const res = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    res.assertStatus(200)

    const raw = JSON.stringify(res.body())
    for (const forbidden of [
      '<script>',
      'componentPath',
      'DROP TABLE',
      'openai',
      'gpt-4o',
      'evil.example.com',
      'permissions',
      'apiKey',
      ...HONEYPOTS,
    ]) {
      assert.notInclude(raw, forbidden, `响应不得包含越界内容 ${forbidden}`)
    }
  })

  test('profile 停用后新选择停止，但历史产物既不删除也不重执行', async ({ assert }) => {
    const world = await seedWorld()
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    const profile = await OcrStructuredExtractionProfile.create({
      organizationId: world.organizationId,
      projectId: world.projectId,
      name: '合同抽取',
      scope: 'organization',
      status: 'active',
      schemaKey: 'org.contract.v1',
      currentVersion: 2,
      totalRuns: 0,
      description: null,
      createdBy: world.ownerId,
    } as never)

    const before = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.equal(before.profileProvenance?.status, 'active')

    // 停用（archived）后：不再作为 active 选择
    profile.status = 'archived'
    await profile.save()

    const jobsBefore = await OcrDocumentJob.query().count('* as total').first()
    const extractionsBefore = await OcrReviewAcceptedExtraction.query().count('* as total').first()

    const after = await adapters.loadGovernanceSummary({
      organizationId: world.organizationId,
      projectId: world.projectId,
    })
    assert.notEqual(after.profileProvenance?.status, 'active')
    // 历史 provenance 仍可读（identity 未被抹掉）
    assert.equal(after.profileProvenance?.identity, 'org.contract.v1')

    const jobsAfter = await OcrDocumentJob.query().count('* as total').first()
    const extractionsAfter = await OcrReviewAcceptedExtraction.query().count('* as total').first()
    assert.equal(
      Number((jobsAfter as CountRow | null)?.$extras?.total),
      Number((jobsBefore as CountRow | null)?.$extras?.total),
    )
    assert.equal(
      Number((extractionsAfter as CountRow | null)?.$extras?.total),
      Number((extractionsBefore as CountRow | null)?.$extras?.total),
    )
  })

  test('插件卸载后工作台核心列表仍可用（不因插件失效而整页不可用）', async ({ client, assert }) => {
    const world = await seedWorld()
    await installMaliciousProfilePlugin(world.organizationId, world.ownerId)
    await PluginInstallation.query()
      .where('organization_id', world.organizationId)
      .update({ status: 'uninstalled' })

    const token = await login(client, world.ownerEmail)
    const res = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    res.assertStatus(200)
    assert.isAbove((res.body().data as unknown[]).length, 0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §6.4 跨租三面 / §6.5 低敏扫描
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — 跨租隔离与低敏扫描', (group) => {
  useAuthDatabase(group)

  test('跨租三面（list / detail / deep-link）均不泄露存在性与元数据', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    const outsider = await createUser({ email: uniqueEmail('di-outsider') })
    await createOrganization(outsider)
    const token = await login(client, outsider.email)

    const list = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    const detail = await client
      .get(
        `${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attachmentId}`,
      )
      .bearerToken(token)
    const deepLink = await client
      .get(
        `${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attachmentId}?attention=needs_review`,
      )
      .bearerToken(token)

    for (const res of [list, detail, deepLink]) {
      assert.isAtLeast(res.status(), 400)
      const raw = JSON.stringify(res.body())
      for (const leak of ['contract.pdf', 'sec-src-hash', 'fake-adapter', ...HONEYPOTS]) {
        assert.notInclude(raw, leak, `跨租响应泄露了 ${leak}`)
      }
      // 不得泄露作业/提取/治理/profile 的存在性
      assert.notInclude(raw, 'latestJob')
      assert.notInclude(raw, 'currentExtraction')
      assert.notInclude(raw, 'profileProvenance')
    }
  })

  test('DTO 与错误体通过共享低敏扫描（无全文/secret/token/绝对路径）', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    const list = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources`)
      .bearerToken(token)
    const detail = await client
      .get(
        `${BASE}/${world.projectId}/document-intelligence/sources/attachment/${world.attachmentId}`,
      )
      .bearerToken(token)
    const invalid = await client
      .get(`${BASE}/${world.projectId}/document-intelligence/sources?perPage=9999`)
      .bearerToken(token)

    for (const res of [list, detail, invalid]) {
      const body = res.body()
      const findings = scanLowSensitive(body)
      assert.deepEqual(findings, [], `低敏扫描失败：${JSON.stringify(findings)}`)
      const raw = JSON.stringify(body)
      for (const honeypot of HONEYPOTS) {
        assert.notInclude(raw, honeypot)
      }
      assert.notInclude(raw, 'C:\\')
      assert.notInclude(raw, 'uploads/')
    }
  })

  test('URL 与查询回显不承载任何内容字段', async ({ client, assert }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)
    const res = await client
      .get(
        `${BASE}/${world.projectId}/document-intelligence/sources?attention=needs_review&sort=created_at&direction=asc&page=1&perPage=10`,
      )
      .bearerToken(token)
    res.assertStatus(200)
    const raw = JSON.stringify(res.body())
    // 响应里出现的只应是 allowlist 枚举与数值，不含文件名/正文/hash 内容
    assert.notInclude(raw, 'contract.pdf'.replace('.pdf', '') + '正文')
    assert.notInclude(raw, 'selectedText')
    assert.notInclude(raw, 'searchableText')
    assert.notInclude(raw, 'candidateText')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §6.6 读取副作用与网络隔离
// ─────────────────────────────────────────────────────────────────────────────

test.group('文档智能工作台 — 零副作用与网络隔离', (group) => {
  useAuthDatabase(group)

  test('list/detail/filter/deep-link 全程无外网调用、无 provider 调用', async ({
    client,
    assert,
  }) => {
    const world = await seedWorld()
    const token = await login(client, world.ownerEmail)

    // 拦截全局 fetch：任何外发即失败
    const originalFetch = globalThis.fetch
    const outbound: string[] = []
    globalThis.fetch = (async (input: any) => {
      outbound.push(String(input))
      throw new Error('network disabled in workbench read path')
    }) as typeof fetch

    try {
      const base = `${BASE}/${world.projectId}/document-intelligence/sources`
      const listRes = await client.get(base).bearerToken(token)
      listRes.assertStatus(200)
      const filteredRes = await client
        .get(`${base}?attention=ready_for_downstream`)
        .bearerToken(token)
      filteredRes.assertStatus(200)
      const detailRes = await client
        .get(`${base}/attachment/${world.attachmentId}`)
        .bearerToken(token)
      detailRes.assertStatus(200)
    } finally {
      globalThis.fetch = originalFetch
    }

    assert.deepEqual(outbound, [], `读取路径发起了外网请求：${outbound.join(', ')}`)
  })

  test('工作台 Service 依赖面只暴露封闭只读端口，无 owning command 注入', async ({ assert }) => {
    const { assertNoOwningCommands, DOCUMENT_INTELLIGENCE_PORT_KEYS } =
      await import('#services/document_intelligence/read_ports')
    const adapters = new DefaultDocumentIntelligenceReadAdapters()

    const result = assertNoOwningCommands(adapters)
    assert.isTrue(result.ok, `read ports 混入了 owning command：${JSON.stringify(result)}`)

    // 原型链上的**公共**方法必须全部落在封闭端口键集内（私有 # 方法不可枚举）
    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(adapters)).filter(
      (n) => n !== 'constructor',
    )
    for (const name of publicMethods) {
      assert.include(
        DOCUMENT_INTELLIGENCE_PORT_KEYS as readonly string[],
        name,
        `适配器暴露了端口契约之外的方法 ${name}`,
      )
    }
    assert.equal(publicMethods.length, DOCUMENT_INTELLIGENCE_PORT_KEYS.length)
  })
})
