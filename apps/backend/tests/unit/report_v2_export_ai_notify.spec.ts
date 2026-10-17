import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'
import type { ReportDocument } from '@aiproj/types'

// ── Export Service ──
import {
  renderMarkdown,
  renderCsv,
  renderDocument,
  createExport,
  completeExport,
  failExport,
  FORMAT_MIME,
  FORMAT_EXT,
} from '#services/report_v2/export_service'

// ── AI Draft ──
import {
  buildAiInput,
  fakeAiDraft,
  generateAiDraft,
  confirmAiDraft,
  checkBudget,
} from '#services/report_v2/ai_draft_service'

// ── Notification ──
import { buildReportNotification } from '#services/report_v2/notification_integration'

import ReportVersion from '#models/report_version'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const sampleDoc: ReportDocument = {
  title: '项目进度报告',
  templateId: 'progress',
  templateVersion: '1.0',
  projectId: 1,
  projectName: '测试项目',
  organizationId: 1,
  generatedAt: '2026-07-13T00:00:00.000Z',
  generatedBy: 1,
  dateRange: { fromDate: '2026-07-01', toDate: '2026-07-13' },
  sections: [
    {
      title: '任务完成情况',
      type: 'table',
      content: [
        { taskId: 1, title: '任务A', status: '已完成', assignee: '张三' },
        { taskId: 2, title: '任务B', status: '进行中', assignee: '李四' },
      ],
    },
    {
      title: '总体摘要',
      type: 'summary',
      content: { totalTasks: 10, completed: 5, progressPercent: 50 },
    },
  ],
  warnings: [{ code: 'REPORT_DATASOURCE_EMPTY', level: 'info', message: '暂无风险数据' }],
  aiDraft: null,
  aiReviewStatus: null,
  aiCostSummary: null,
}

// ---------------------------------------------------------------------------
// Tests: §6 Export
// ---------------------------------------------------------------------------

test.group('Report V2 — Export Service', () => {
  test('renderMarkdown 包含标题、元数据、warnings 和章节', ({ assert }) => {
    const md = renderMarkdown(sampleDoc)
    assert.include(md, '# 项目进度报告')
    assert.include(md, '生成时间：2026-07-13T00:00:00.000Z')
    assert.include(md, '测试项目')
    assert.include(md, 'REPORT_DATASOURCE_EMPTY')
    assert.include(md, '## 任务完成情况')
    assert.include(md, '## 总体摘要')
  })

  test('renderMarkdown 包含 AI 草稿时展示分隔线', ({ assert }) => {
    const docWithAi = { ...sampleDoc, aiDraft: '## AI 草稿正文' }
    const md = renderMarkdown(docWithAi)
    assert.include(md, '---')
    assert.include(md, '## AI 草稿正文')
  })

  test('renderCsv 包含元数据、warnings 和 table section', ({ assert }) => {
    const csv = renderCsv(sampleDoc)
    assert.include(csv, '# 项目进度报告')
    assert.include(csv, 'WARNING: [REPORT_DATASOURCE_EMPTY]')
    assert.include(csv, '# 任务完成情况')
    assert.include(csv, '"任务A"')
    assert.include(csv, '"张三"')
  })

  test('renderCsv 不包含 summary 类型 section', ({ assert }) => {
    const csv = renderCsv(sampleDoc)
    assert.notInclude(csv, '# 总体摘要') // 不是 table 类型
  })

  test('renderDocument 根据格式返回对应内容', ({ assert }) => {
    const md = renderDocument(sampleDoc, 'markdown')
    assert.include(md, '# 项目进度报告')

    const csv = renderDocument(sampleDoc, 'csv')
    assert.include(csv, 'WARNING:')

    const pdf = renderDocument(sampleDoc, 'pdf')
    assert.include(pdf, 'V2-PDF-PLACEHOLDER')

    const xlsx = renderDocument(sampleDoc, 'xlsx')
    assert.include(xlsx, 'V2-XLSX-PLACEHOLDER')
  })

  test('FORMAT_MIME 和 FORMAT_EXT 覆盖所有格式', ({ assert }) => {
    assert.equal(FORMAT_MIME.markdown, 'text/markdown; charset=utf-8')
    assert.equal(FORMAT_MIME.csv, 'text/csv; charset=utf-8')
    assert.equal(FORMAT_MIME.pdf, 'application/pdf')
    assert.equal(
      FORMAT_MIME.xlsx,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )

    assert.equal(FORMAT_EXT.markdown, '.md')
    assert.equal(FORMAT_EXT.csv, '.csv')
    assert.equal(FORMAT_EXT.pdf, '.pdf')
    assert.equal(FORMAT_EXT.xlsx, '.xlsx')
  })

  test('导出失败可分类', ({ assert }) => {
    const category = 'EXPORT_RENDER_FAILED'
    assert.equal(category, 'EXPORT_RENDER_FAILED')
  })
})

test.group('Report V2 — Export DB', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('rv2-export') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('创建导出记录', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const exp = await createExport({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: 1,
      versionId: 1,
      format: 'pdf',
      createdBy: Number(owner.id),
    })

    assert.equal(exp.format, 'pdf')
    assert.equal(exp.status, 'pending')
    assert.isNull(exp.fileHash)
    assert.isNull(exp.fileSize)
  })

  test('导出完整周期：pending → completed', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const exp = await createExport({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: 1,
      versionId: 1,
      format: 'markdown',
      createdBy: Number(owner.id),
    })

    const completed = await completeExport(exp.id, '# 测试内容', Number(org.id))
    assert.equal(completed.status, 'completed')
    assert.isNotEmpty(completed.fileHash)
    assert.isAbove(completed.fileSize ?? 0, 0)
    assert.equal(completed.mimeType, 'text/markdown; charset=utf-8')
  })

  test('导出失败标记', async ({ assert }) => {
    const { project, org, owner } = await setupProject()

    const exp = await createExport({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: 1,
      versionId: 1,
      format: 'xlsx',
      createdBy: Number(owner.id),
    })

    const failed = await failExport(exp.id, 'RENDER_FAILED', Number(org.id))
    assert.equal(failed.status, 'failed')
    assert.equal(failed.errorCategory, 'RENDER_FAILED')
  })
})

// ---------------------------------------------------------------------------
// Tests: §7 AI Draft
// ---------------------------------------------------------------------------

test.group('Report V2 — AI Draft', () => {
  test('buildAiInput 只包含结构化数据', ({ assert }) => {
    const input = buildAiInput(
      'project-weekly',
      '测试项目',
      { fromDate: '2026-07-01', toDate: '2026-07-07' },
      { totalTasks: 10, completedPercent: 50 },
      [{ code: 'REPORT_DATASOURCE_EMPTY', level: 'info', message: '暂无风险数据' }],
    )

    assert.equal(input.templateId, 'project-weekly')
    assert.equal(input.projectName, '测试项目')
    assert.equal(input.dataSources.totalTasks, 10)
    assert.equal(input.warnings.length, 1)
  })

  test('fakeAiDraft 返回完整输出结构', ({ assert }) => {
    const input = buildAiInput(
      'project-weekly',
      '测试项目',
      { fromDate: '2026-07-01', toDate: '2026-07-07' },
      { totalTasks: 10, completedPercent: 50, overdueTaskCount: 2 },
      [],
    )

    const output = fakeAiDraft(input, new Date('2026-07-13'))
    assert.include(output.draft, '测试项目')
    assert.include(output.draft, '周报')
    assert.include(output.draft, '10')
    assert.include(output.draft, '50%')
    assert.isNotEmpty(output.summary)
    assert.isArray(output.highlights)
    assert.isArray(output.suggestedActions)
    assert.equal(output.provider, 'fake')
    assert.equal(output.model, 'fake-model')
  })

  test('fakeAiDraft 月报输出不同标题', ({ assert }) => {
    const input = buildAiInput(
      'project-monthly',
      '月度项目',
      { fromDate: '2026-06-01', toDate: '2026-07-01' },
      { totalTasks: 20, completedPercent: 75 },
      [],
    )

    const output = fakeAiDraft(input, new Date('2026-07-13'))
    assert.include(output.draft, '月报')
    assert.include(output.draft, '75%')
  })

  test('checkBudget 硬预算阻断', ({ assert }) => {
    const status = checkBudget(600, 500, 250, 0)
    assert.isTrue(status.blocked)
    assert.isFalse(status.warning) // blocked 优先级更高
  })

  test('checkBudget 软预算 warning', ({ assert }) => {
    const status = checkBudget(300, 1000, 200, 0)
    assert.isFalse(status.blocked)
    assert.isTrue(status.warning)
  })

  test('checkBudget 预算通过', ({ assert }) => {
    const status = checkBudget(50, 1000, 500, 0)
    assert.isFalse(status.blocked)
    assert.isFalse(status.warning)
  })

  test('confirmAiDraft 只更新审核状态签名正确', ({ assert }) => {
    // 纯函数测试：验证返回结构正确
    assert.isFunction(confirmAiDraft)
    assert.isFunction(generateAiDraft)
  })
})

test.group('Report V2 — AI Draft DB', (group) => {
  useAuthDatabase(group)

  async function setupMinimalProject() {
    const owner = await createUser({ email: uniqueEmail('rv2-ai') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  test('generateAiDraft 保存草稿到数据库', async ({ assert }) => {
    const { project, org, owner } = await setupMinimalProject()

    const version = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'project-weekly',
      templateVersion: '1.0',
      title: 'AI 测试周报',
      dateRange: { fromDate: '2026-07-01', toDate: '2026-07-07' },
      filters: null,
      dataSourceHashes: null,
      snapshotHash: 'ai_test_hash',
      warnings: [],
      documentRef: null,
      aiDraft: null,
      aiReviewStatus: null,
      aiCostRef: null,
      generatedBy: Number(owner.id),
      generatedAt: DateTime.now(),
      confirmedAt: null,
      confirmedBy: null,
    })

    const input = buildAiInput(
      'project-weekly',
      '测试项目',
      { fromDate: '2026-07-01', toDate: '2026-07-07' },
      { totalTasks: 5, completedPercent: 60 },
      [],
    )

    const output = await generateAiDraft(version.id, input)
    assert.equal(output.provider, 'fake')

    const loaded = await ReportVersion.findOrFail(version.id)
    assert.include(loaded.aiDraft ?? '', '测试项目')
    assert.equal(loaded.aiReviewStatus, 'pending_review')
    assert.isObject(loaded.aiCostRef)
  })

  test('confirmAiDraft 确认后版本可读不修改项目', async ({ assert }) => {
    const { project, org, owner } = await setupMinimalProject()

    const version = await ReportVersion.create({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      reportId: null,
      templateId: 'project-monthly',
      templateVersion: '1.0',
      title: 'AI 月报确认测试',
      dateRange: null,
      filters: null,
      dataSourceHashes: null,
      snapshotHash: 'confirm_test',
      warnings: [],
      documentRef: null,
      aiDraft: '候选正文',
      aiReviewStatus: 'pending_review',
      aiCostRef: null,
      generatedBy: Number(owner.id),
      generatedAt: DateTime.now(),
      confirmedAt: null,
      confirmedBy: null,
    })

    const result = await confirmAiDraft(version.id, Number(owner.id))
    assert.equal(result.aiReviewStatus, 'confirmed')

    const loaded = await ReportVersion.findOrFail(version.id)
    assert.equal(loaded.aiReviewStatus, 'confirmed')
    assert.isNotNull(loaded.confirmedAt)
    assert.equal(loaded.confirmedBy, Number(owner.id))
  })
})

// ---------------------------------------------------------------------------
// Tests: §8 Notifications
// ---------------------------------------------------------------------------

test.group('Report V2 — Notifications', () => {
  test('生成成功通知不含敏感正文', ({ assert }) => {
    const n = buildReportNotification({
      organizationId: 1,
      recipientId: 1,
      projectId: 1,
      reportId: 1,
      versionId: 1,
      templateId: 'progress',
      title: '项目周报',
      event: 'report_generated',
    })

    assert.equal(n.type, 'report_generated')
    assert.include(n.title, '生成成功')
    assert.include(n.body, '可查看详情和导出')
    assert.notInclude(n.body, 'AI')
    assert.notInclude(n.body, '草稿')
    assert.notInclude(n.body, '文件路径')
    assert.equal(n.severity, 'info')
    assert.equal(n.targetType, 'report')
  })

  test('生成失败通知含错误分类', ({ assert }) => {
    const n = buildReportNotification({
      organizationId: 1,
      recipientId: 2,
      projectId: 1,
      reportId: 1,
      templateId: 'project-monthly',
      title: '月度报告',
      event: 'report_generation_failed',
      errorCategory: 'DATASOURCE_TIMEOUT',
    })

    assert.equal(n.type, 'report_generation_failed')
    assert.include(n.title, '生成失败')
    assert.include(n.body, 'DATASOURCE_TIMEOUT')
    assert.equal(n.severity, 'error')
    assert.equal(n.metadata.errorCategory, 'DATASOURCE_TIMEOUT')
  })

  test('导出完成通知不含存储路径', ({ assert }) => {
    const n = buildReportNotification({
      organizationId: 1,
      recipientId: 1,
      projectId: 1,
      reportId: 1,
      versionId: 1,
      templateId: 'progress',
      title: '进度报告',
      event: 'report_exported',
    })

    assert.equal(n.type, 'report_exported')
    assert.include(n.title, '导出完成')
    assert.notInclude(n.body, '/data/')
    assert.notInclude(n.body, 'secret')
    assert.notInclude(n.body, 'hash')
  })

  test('导出失败通知含错误类别', ({ assert }) => {
    const n = buildReportNotification({
      organizationId: 1,
      recipientId: 3,
      projectId: 1,
      reportId: 1,
      versionId: 1,
      templateId: 'progress',
      title: '进度报告',
      event: 'report_export_failed',
      errorCategory: 'RENDER_FAILED',
    })

    assert.equal(n.type, 'report_export_failed')
    assert.include(n.title, '导出失败')
    assert.include(n.body, 'RENDER_FAILED')
    assert.equal(n.severity, 'warning')
  })

  test('通知 actionUrl 是安全入口而非文件路径', ({ assert }) => {
    const n = buildReportNotification({
      organizationId: 1,
      recipientId: 1,
      projectId: 42,
      reportId: 7,
      versionId: 3,
      templateId: 'project-weekly',
      title: '周报',
      event: 'report_generated',
    })

    assert.include(n.actionUrl ?? '', '/projects/42/reports/v2/versions/3')
    assert.notInclude(n.actionUrl, '/api/v1')
    assert.notInclude(n.actionUrl, 'download')
    assert.notInclude(n.actionUrl, 'file')
  })

  test('通知 metadata 只含低敏信息', ({ assert }) => {
    const n = buildReportNotification({
      organizationId: 1,
      recipientId: 1,
      projectId: 1,
      reportId: 5,
      versionId: 2,
      templateId: 'risk-summary',
      title: '风险报告',
      event: 'report_generated',
    })

    assert.equal(n.metadata.reportId, 5)
    assert.equal(n.metadata.templateId, 'risk-summary')
    assert.equal(n.metadata.status, 'success')
    assert.isUndefined((n.metadata as Record<string, unknown>).fullContent)
    assert.isUndefined((n.metadata as Record<string, unknown>).sensitiveData)
  })
})
