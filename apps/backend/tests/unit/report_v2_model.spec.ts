import ReportVersion from '#models/report_version'
import ReportJob from '#models/report_job'
import ReportExport from '#models/report_export'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import { DateTime } from 'luxon'
import type { ReportWarningV2 } from '@aiproj/types'

test.group('V2 Report Model — schema & default', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rv2-model') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  // ------------------------------------------------------------------
  // ReportVersion
  // ------------------------------------------------------------------

  test('ReportVersion 创建与读取基本字段', async ({ assert }) => {
    const { project, org } = await setupProject()
    const now = DateTime.now()

    const rv = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'project-weekly',
      templateVersion: '1.0',
      title: '测试版本',
      dateRange: { fromDate: '2026-07-01', toDate: '2026-07-07' },
      filters: null,
      dataSourceHashes: { task_summary: 'abc123' },
      snapshotHash: 'def456',
      warnings: [],
      documentRef: null,
      aiDraft: null,
      aiReviewStatus: null,
      aiCostRef: null,
      generatedBy: null,
      generatedAt: now,
      confirmedAt: null,
      confirmedBy: null,
    })

    const loaded = await ReportVersion.findOrFail(rv.id)
    assert.equal(loaded.templateId, 'project-weekly')
    assert.equal(loaded.title, '测试版本')
    assert.equal(loaded.snapshotHash, 'def456')
    assert.deepEqual(loaded.dataSourceHashes, { task_summary: 'abc123' })
    assert.deepEqual(loaded.warnings, [])
  })

  test('ReportVersion JSON 列写入回读为对象', async ({ assert }) => {
    const { project, org } = await setupProject()
    const now = DateTime.now()

    const warnings: ReportWarningV2[] = [
      { code: 'REPORT_DATASOURCE_EMPTY', level: 'info', message: '暂无数据' },
    ]
    const rv = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'progress',
      templateVersion: '1.0',
      title: 'Warnings 测试',
      dateRange: null,
      filters: { fromDate: '2026-07-01' },
      dataSourceHashes: null,
      snapshotHash: 'snap123',
      warnings,
      documentRef: { sectionCount: 3 },
      aiDraft: null,
      aiReviewStatus: 'pending_review',
      aiCostRef: { provider: 'fake', cost: 0 },
      generatedBy: null,
      generatedAt: now,
      confirmedAt: null,
      confirmedBy: null,
    })

    const loaded = await ReportVersion.findOrFail(rv.id)
    assert.deepEqual(loaded.warnings, warnings)
    assert.deepEqual(loaded.documentRef, { sectionCount: 3 })
    assert.equal(loaded.aiReviewStatus, 'pending_review')
  })

  test('ReportVersion timestamp 字段正确', async ({ assert }) => {
    const { project, org } = await setupProject()
    const now = DateTime.now()

    const rv = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'risk-summary',
      templateVersion: '1.0',
      title: 'Timestamp 测试',
      dateRange: null,
      filters: null,
      dataSourceHashes: null,
      snapshotHash: 'ts_hash',
      warnings: [],
      documentRef: null,
      aiDraft: null,
      aiReviewStatus: null,
      aiCostRef: null,
      generatedBy: null,
      generatedAt: now,
      confirmedAt: null,
      confirmedBy: null,
    })

    assert.isTrue(DateTime.isDateTime(rv.generatedAt))
    assert.isTrue(DateTime.isDateTime(rv.createdAt))
    assert.isNull(rv.confirmedAt)
  })

  // ------------------------------------------------------------------
  // ReportJob
  // ------------------------------------------------------------------

  test('ReportJob 创建与状态默认值', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const job = await ReportJob.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      versionId: null,
      templateId: 'project-monthly',
      requestedBy: Number(owner.id),
      status: 'queued',
      attempt: 1,
      idempotencyKey: null,
      progress: null,
      errorCategory: null,
      errorDetail: null,
      startedAt: null,
      finishedAt: null,
    })

    const loaded = await ReportJob.findOrFail(job.id)
    assert.equal(loaded.status, 'queued')
    assert.equal(loaded.attempt, 1)
    assert.isNull(loaded.startedAt)
    assert.isNull(loaded.finishedAt)
  })

  test('ReportJob 状态流转', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const now = DateTime.now()

    const job = await ReportJob.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      versionId: null,
      templateId: 'progress',
      requestedBy: Number(owner.id),
      status: 'queued',
      attempt: 1,
      idempotencyKey: 'idem-001',
      progress: null,
      errorCategory: null,
      errorDetail: null,
      startedAt: null,
      finishedAt: null,
    })

    // → running
    job.status = 'running'
    job.startedAt = now
    await job.save()
    const running = await ReportJob.findOrFail(job.id)
    assert.equal(running.status, 'running')
    assert.isTrue(DateTime.isDateTime(running.startedAt))

    // → succeeded
    job.status = 'succeeded'
    job.finishedAt = DateTime.now()
    job.progress = '完成'
    await job.save()
    const done = await ReportJob.findOrFail(job.id)
    assert.equal(done.status, 'succeeded')
    assert.isTrue(DateTime.isDateTime(done.finishedAt))
    assert.equal(done.progress, '完成')
  })

  // ------------------------------------------------------------------
  // ReportExport
  // ------------------------------------------------------------------

  test('ReportExport 创建与基本字段', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const exportRecord = await ReportExport.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: 0,
      versionId: null,
      format: 'pdf',
      status: 'pending',
      fileHash: null,
      fileSize: null,
      mimeType: null,
      filePath: null,
      errorCategory: null,
      createdBy: Number(owner.id),
      completedAt: null,
    })

    const loaded = await ReportExport.findOrFail(exportRecord.id)
    assert.equal(loaded.format, 'pdf')
    assert.equal(loaded.status, 'pending')
    assert.isNull(loaded.fileHash)
    assert.isNull(loaded.fileSize)
  })

  test('ReportExport 状态与文件信息更新', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const exportRecord = await ReportExport.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: 0,
      versionId: null,
      format: 'xlsx',
      status: 'pending',
      fileHash: null,
      fileSize: null,
      mimeType: null,
      filePath: null,
      errorCategory: null,
      createdBy: Number(owner.id),
      completedAt: null,
    })

    // → processing
    exportRecord.status = 'processing'
    await exportRecord.save()
    assert.equal(exportRecord.status, 'processing')

    // → completed
    exportRecord.status = 'completed'
    exportRecord.fileHash = 'xlsx_hash_abc123'
    exportRecord.fileSize = 4096
    exportRecord.mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    exportRecord.completedAt = DateTime.now()
    await exportRecord.save()

    const loaded = await ReportExport.findOrFail(exportRecord.id)
    assert.equal(loaded.status, 'completed')
    assert.equal(loaded.fileHash, 'xlsx_hash_abc123')
    assert.equal(loaded.fileSize, 4096)
    assert.equal(
      loaded.mimeType,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    assert.isTrue(DateTime.isDateTime(loaded.completedAt))
  })

  test('ReportExport filePath 序列化时被隐藏', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const exportRecord = await ReportExport.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: 0,
      versionId: null,
      format: 'csv',
      status: 'completed',
      fileHash: 'csv_hash',
      fileSize: 1024,
      mimeType: 'text/csv',
      filePath: '/data/reports/secret.csv',
      errorCategory: null,
      createdBy: Number(owner.id),
      completedAt: DateTime.now(),
    })

    const serialized = exportRecord.serialize()
    assert.isUndefined(serialized.filePath)
  })

  // ------------------------------------------------------------------
  // AI 周期报表扩展字段
  // ------------------------------------------------------------------

  test('ReportVersion AI 周期报表字段为空态兼容', async ({ assert }) => {
    const { project, org } = await setupProject()
    const now = DateTime.now()

    // 创建不含周期字段的版本（模拟旧版本兼容）
    const rv = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'progress',
      templateVersion: '1.0',
      title: '旧版本',
      dateRange: null,
      filters: null,
      dataSourceHashes: null,
      snapshotHash: 'old_hash',
      warnings: [],
      documentRef: null,
      aiDraft: null,
      aiReviewStatus: null,
      aiCostRef: null,
      generatedBy: null,
      generatedAt: now,
      confirmedAt: null,
      confirmedBy: null,
    })

    const loaded = await ReportVersion.findOrFail(rv.id)
    assert.isNull(loaded.periodType)
    assert.isNull(loaded.prevDateRange)
    assert.isNull(loaded.aiDraftRef)
    assert.isNull(loaded.inputSourceHashes)
    assert.isNull(loaded.modelSummary)
    assert.isNull(loaded.costSummary)
    assert.isNull(loaded.idempotencyKey)
    assert.equal(loaded.attempt, 1)
    assert.isNull(loaded.reviewNotes)
    assert.isNull(loaded.reviewAction)
    assert.isNull(loaded.returnedAt)
    assert.isNull(loaded.returnedBy)
  })

  test('ReportVersion AI 周期报表字段完整填充', async ({ assert }) => {
    const { project, org } = await setupProject()
    const now = DateTime.now()

    const rv = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'weekly-ai-summary',
      templateVersion: '1.0',
      title: 'AI 周报测试',
      dateRange: { fromDate: '2026-07-07', toDate: '2026-07-13' },
      periodType: 'weekly',
      prevDateRange: { fromDate: '2026-06-30', toDate: '2026-07-06' },
      filters: null,
      dataSourceHashes: { task_summary: 'hash1', dashboard_metrics: 'hash2' },
      snapshotHash: 'ai_snap_001',
      warnings: [],
      documentRef: null,
      aiDraft:
        '{"executiveSummary":"测试摘要","highlights":[],"progressNarrative":"","riskAndIssues":"","resourceNotes":"","changeNotes":"","suggestedActions":[],"dataWarningsNarrative":""}',
      aiReviewStatus: 'pending_review',
      aiDraftRef: 'ref_001',
      inputSourceHashes: ['source_hash_1', 'source_hash_2'],
      modelSummary: { provider: 'fake', model: 'test-model', finishReason: 'stop' },
      costSummary: {
        provider: 'fake',
        model: 'test-model',
        promptTokens: 100,
        completionTokens: 200,
        estimatedCost: 0.001,
        latencyMs: 150,
        budgetVerdict: 'passed',
      },
      aiCostRef: { provider: 'fake', cost: 0.001 },
      attempt: 1,
      idempotencyKey: 'idem-weekly-001',
      reviewNotes: null,
      reviewAction: 'confirm',
      generatedBy: null,
      generatedAt: now,
      confirmedAt: now,
      confirmedBy: 1,
      returnedAt: null,
      returnedBy: null,
    })

    const loaded = await ReportVersion.findOrFail(rv.id)
    assert.equal(loaded.templateId, 'weekly-ai-summary')
    assert.equal(loaded.periodType, 'weekly')
    assert.deepEqual(loaded.prevDateRange, { fromDate: '2026-06-30', toDate: '2026-07-06' })
    assert.equal(loaded.aiDraftRef, 'ref_001')
    assert.deepEqual(loaded.inputSourceHashes, ['source_hash_1', 'source_hash_2'])
    assert.deepEqual(loaded.modelSummary, {
      provider: 'fake',
      model: 'test-model',
      finishReason: 'stop',
    })
    assert.deepEqual(loaded.costSummary, {
      provider: 'fake',
      model: 'test-model',
      promptTokens: 100,
      completionTokens: 200,
      estimatedCost: 0.001,
      latencyMs: 150,
      budgetVerdict: 'passed',
    })
    assert.equal(loaded.aiReviewStatus, 'pending_review')
    assert.equal(loaded.idempotencyKey, 'idem-weekly-001')
    assert.equal(loaded.attempt, 1)
    assert.equal(loaded.reviewAction, 'confirm')
    assert.ok(loaded.confirmedAt)
  })
})
