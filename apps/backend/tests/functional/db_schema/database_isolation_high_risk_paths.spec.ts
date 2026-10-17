/**
 * v3-multitenant-database-isolation §5.6 —— 已迁移高风险路径的跨租户负例。
 *
 * 每个 test 对应 §5.1–§5.5 中一条**实际改造过**的路径，断言跨组织尝试要么只看到
 * scope 内结果，要么返回与"不存在"完全同形的非泄露失败：
 * - §5.2 Compiler run resume、AI draft & Compiler 流授权
 * - §5.3 文件元数据列表/详情、报表导出状态写回
 * - §5.4 作业幂等（OCR attempt / OCR budget decision）
 * - §5.5 遗留任务引用解析（reason 侧信道）
 *
 * 全程本地 SQLite fixture，无真实 AI/OCR/KMS/网络（spec「Default verification is offline」）。
 */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import CompilerRun from '#models/compiler_run'
import AiProjectDraft from '#models/ai_project_draft'
import Attachment from '#models/attachment'
import Project from '#models/project'
import ReportExport from '#models/report_export'
import DatabaseTenantBoundary from '#services/database_tenant_boundary'
import FileService from '#services/file_service'
import OcrProviderAttemptRecorder from '#services/ai_ocr/ocr_provider_attempt_recorder'
import OcrProviderAttempt from '#models/ocr_provider_attempt'
import OcrProviderBudgetDecision from '#models/ocr_provider_budget_decision'
import { TaskReferenceResolver } from '#services/candidates/task_reference_resolver'
import Task from '#models/task'
import { completeExport } from '#services/report_v2/export_service'
import { AiDraftDomainAdapter, CompilerDomainAdapter } from '#services/streaming/domain_adapters'
import { createOrganization, createUser, uniqueEmail, useAuthDatabase } from '../auth/_helpers.js'

/** 两组织共用的资源标识——同名/同键才能证伪"按名字/按键即返回"的实现。 */
const SHARED_KEY = 'shared-high-risk-key'

interface Fixture {
  organizationId: number
  ownerId: number
  project: Project
  run: CompilerRun
  draft: AiProjectDraft
  attachment: Attachment
}

test.group('高风险路径跨租户负例（§5.6）', (group) => {
  useAuthDatabase(group)

  let boundary: DatabaseTenantBoundary
  let orgA: Fixture
  let orgB: Fixture

  async function seed(prefix: string): Promise<Fixture> {
    const owner = await createUser({ email: uniqueEmail(prefix) })
    const organization = await createOrganization(owner)
    const organizationId = Number(organization.id)

    const project = await Project.create({
      organizationId,
      name: '高风险-同名项目',
      code: `${prefix.toUpperCase()}${Date.now()}`,
      createdBy: owner.id,
    })

    const run = await CompilerRun.create({
      organizationId,
      requestedByUserId: owner.id,
      status: 'queued',
      input: {},
    })

    const draft = await AiProjectDraft.create({
      organizationId,
      userId: owner.id,
      projectType: 'software',
      status: 'drafting',
      schemaVersion: '1.0',
      currentVersion: 1,
      fallbackUsed: false,
      usingRealAdapter: false,
      draftUid: `${prefix}-${Date.now()}`,
    })

    const attachment = await Attachment.create({
      projectId: project.id,
      entityType: 'project',
      entityId: project.id,
      fileName: '高风险-同名附件.pdf',
      filePath: `uploads/${prefix}/file.pdf`,
      fileSize: 512,
      mimeType: 'application/pdf',
      storageProvider: 'local',
      currentVersion: 1,
      uploadedBy: owner.id,
    })

    return {
      organizationId,
      ownerId: Number(owner.id),
      project,
      run,
      draft,
      attachment,
    }
  }

  group.each.setup(async () => {
    boundary = new DatabaseTenantBoundary()
    orgA = await seed('hrpa')
    orgB = await seed('hrpb')
  })

  // ── §5.2 Compiler / AI draft ────────────────────────────────────────────────

  test('§5.2 Compiler run resume 跨租不推进，且不改变他租 run 状态', async ({ assert }) => {
    const { CompilerRunService } = await import('#services/compiler/compiler_run_service')
    const service = await app.container.make(CompilerRunService)
    const orchestrator = {
      resume: async () => {
        throw new Error('跨租 resume 不应到达 orchestrator')
      },
    }

    const result = await service.resumeCompilation(
      orchestrator as never,
      orgB.run.id,
      orgA.organizationId,
    )
    assert.isFalse(result.resumed)

    const untouched = await CompilerRun.query().where('id', orgB.run.id).firstOrFail()
    assert.equal(untouched.status, 'queued')
  })

  test('§5.2 AI draft 流授权：跨租与不存在返回同一 reasonCode', async ({ assert }) => {
    const adapter = new AiDraftDomainAdapter()
    const cross = await adapter.authorize(orgA.ownerId, orgA.organizationId, String(orgB.draft.id))
    const missing = await adapter.authorize(orgA.ownerId, orgA.organizationId, '99999999')
    assert.isFalse(cross.allowed)
    assert.equal(cross.reasonCode, 'DRAFT_NOT_FOUND')
    assert.equal(cross.reasonCode, missing.reasonCode)
    assert.equal(cross.reasonMessage, missing.reasonMessage)
  })

  test('§5.2 Compiler 流授权：跨租与不存在返回同一 reasonCode', async ({ assert }) => {
    const adapter = new CompilerDomainAdapter()
    const cross = await adapter.authorize(orgA.ownerId, orgA.organizationId, String(orgB.run.id))
    const missing = await adapter.authorize(orgA.ownerId, orgA.organizationId, '99999999')
    assert.isFalse(cross.allowed)
    assert.equal(cross.reasonCode, 'RUN_NOT_FOUND')
    assert.equal(cross.reasonCode, missing.reasonCode)
    assert.equal(cross.reasonMessage, missing.reasonMessage)
  })

  // ── §5.3 文件 / 报表导出 ────────────────────────────────────────────────────

  test('§5.3 文件详情与列表：他租项目 ID 不可见（Policy 之外的数据库层保障）', async ({
    assert,
  }) => {
    const fileService = await app.container.make(FileService)

    // 直接用他租 projectId 调 Service（模拟绕过 Controller/Policy 的内部调用路径）
    const cross = await captureError(() =>
      fileService.getById(orgA.organizationId, Number(orgB.project.id), Number(orgB.attachment.id)),
    )
    assert.equal((cross as { code?: string }).code, 'RESOURCE_NOT_FOUND')

    const listed = await fileService.list({
      organizationId: orgA.organizationId,
      projectId: Number(orgB.project.id),
    })
    assert.lengthOf(listed.data, 0)
    assert.equal(listed.meta.total, 0, 'meta.total 必须在 scope 之后计算')

    // 自己组织的照常可见
    const own = await fileService.list({
      organizationId: orgA.organizationId,
      projectId: Number(orgA.project.id),
    })
    assert.equal(own.meta.total, 1)
  })

  test('§5.3 报表导出状态写回：他租导出记录不可改写', async ({ assert }) => {
    const exportRecord = await ReportExport.create({
      organizationId: orgB.organizationId,
      projectId: Number(orgB.project.id),
      reportId: 1,
      versionId: 1,
      format: 'markdown',
      status: 'pending',
      fileHash: null,
      fileSize: null,
      mimeType: null,
      filePath: null,
      errorCategory: null,
      createdBy: orgB.ownerId,
      completedAt: null,
    })

    const cross = await captureError(() =>
      completeExport(Number(exportRecord.id), '# 越界内容', orgA.organizationId),
    )
    assert.equal((cross as { code?: string }).code, 'RESOURCE_NOT_FOUND')

    const untouched = await ReportExport.findOrFail(exportRecord.id)
    assert.equal(untouched.status, 'pending')
    assert.isNull(untouched.fileHash)
  })

  // ── §5.4 作业幂等 ───────────────────────────────────────────────────────────

  test('§5.4 OCR attempt 幂等：同一 key 在两组织各自成行，不改写他租行', async ({ assert }) => {
    // OCR attempt 挂在 job 上（两列均 NOT NULL），各组织建一条最小 job 行
    const jobIds: Record<'a' | 'b', number> = { a: 0, b: 0 }
    for (const [key, fixture] of [
      ['a', orgA],
      ['b', orgB],
    ] as const) {
      const [id] = await db
        .table('ocr_document_jobs')
        .returning('id')
        .insert({
          organization_id: fixture.organizationId,
          project_id: Number(fixture.project.id),
          source_kind: 'attachment',
          source_hash: 'shared-source-hash',
          created_by: fixture.ownerId,
          created_at: new Date(),
          updated_at: new Date(),
        })
      jobIds[key] = Number(typeof id === 'object' ? (id as { id: number }).id : id)
    }

    const recorder = new OcrProviderAttemptRecorder()
    const base = {
      attemptNumber: 1,
      provider: 'mock',
      model: 'mock-model',
      status: 'queued' as const,
      idempotencyKey: SHARED_KEY,
    }

    await recorder.record({
      ...base,
      organizationId: orgA.organizationId,
      projectId: Number(orgA.project.id),
      ocrJobId: jobIds.a,
    } as never)
    await recorder.record({
      ...base,
      organizationId: orgB.organizationId,
      projectId: Number(orgB.project.id),
      ocrJobId: jobIds.b,
      status: 'succeeded',
    } as never)

    const rowA = await OcrProviderAttempt.query()
      .where('organization_id', orgA.organizationId)
      .where('idempotency_key', SHARED_KEY)
      .firstOrFail()
    const rowB = await OcrProviderAttempt.query()
      .where('organization_id', orgB.organizationId)
      .where('idempotency_key', SHARED_KEY)
      .firstOrFail()

    assert.notEqual(Number(rowA.id), Number(rowB.id), '两组织必须各自成行')
    assert.equal(rowA.status, 'queued', 'orgB 的写入不得改写 orgA 的 attempt 状态')
    assert.equal(rowB.status, 'succeeded')
  })

  test('§5.4 OCR budget decision 幂等：同一 key 在两组织各自成行', async ({ assert }) => {
    const rows = [orgA, orgB].map(({ organizationId, project }) => ({
      organizationId,
      projectId: Number(project.id),
      ocrJobId: null,
      pageId: null,
      scope: 'job' as never,
      status: 'allowed' as never,
      estimatedCost: 1,
      currency: 'CNY',
      budgetLimit: null,
      budgetUsed: 0,
      softLimitAction: null,
      warningCodes: null as never,
      idempotencyKey: SHARED_KEY,
      metadata: null,
    }))
    for (const row of rows) {
      await OcrProviderBudgetDecision.create(row as never)
    }

    const scopedA = await boundary.countInTenant('ocr_provider_budget_decisions', {
      organizationId: orgA.organizationId,
    })
    assert.equal(scopedA, 1, '组织内幂等键唯一，但跨组织同键必须允许并互不可见')
  })

  // ── §5.5 遗留任务引用解析 ───────────────────────────────────────────────────

  test('§5.5 任务引用解析：跨租与不存在返回同一 reason（无存在性侧信道）', async ({ assert }) => {
    const task = await Task.create({
      projectId: orgB.project.id,
      name: '他租任务',
      status: 'not_started',
      priority: 'medium',
    })
    const resolver = new TaskReferenceResolver()

    const cross = await resolver.resolve(orgA.organizationId, `PROJ-${task.id}`)
    const missing = await resolver.resolve(orgA.organizationId, `PROJ-${Number(task.id) + 999999}`)
    assert.isFalse(cross.matched)
    assert.equal(cross.reason, missing.reason)
    assert.equal(cross.message, missing.message)
  })
})

/** 捕获异步异常对象（用于比较跨租与不存在两条路径的错误是否完全同形）。 */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('期望抛出异常但没有')
}
