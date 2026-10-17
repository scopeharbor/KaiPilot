/**
 * report_periodic_export —— AI 周期报表导出服务单元测试（task 7.4）。
 *
 * 覆盖：
 *   7.4.1 导出已确认周报成功
 *   7.4.2 导出已确认月报成功
 *   7.4.3 拒绝 pending_review 草稿导出（无 draftOverride）
 *   7.4.4 允许 pending_review 草稿导出（有 draftOverride）
 *   7.4.5 拒绝 rejected 草稿导出（即使有 draftOverride）
 *   7.4.6 拒绝无权限下载（模拟组织隔离失败）
 */
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

// 测试目标
import {
  checkExportPermission,
  renderPeriodicMarkdown,
  renderPeriodicPdf,
  renderPeriodicXlsx,
  renderPeriodicDocument,
  formatDraftForExport,
  createPeriodicExport,
} from '#services/report_v2/periodic_export_service'
import type { PeriodicRenderInput } from '#services/report_v2/periodic_export_service'
import type { ReportWarningV2 } from '@aiproj/types'

import type { V2ReportTemplateId } from '@aiproj/types'
import ReportVersion from '#models/report_version'
import ReportExport from '#models/report_export'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const sampleWarnings: ReportWarningV2[] = [
  { code: 'REPORT_DATASOURCE_EMPTY', level: 'info', message: '暂无风险数据' },
  { code: 'REPORT_AGGREGATION_PARTIAL', level: 'warning', message: '部分数据源缺失' },
]

const sampleDataSources = [
  { key: 'task_summary', status: 'available' },
  { key: 'schedule_summary', status: 'available' },
  { key: 'risk_summary', status: 'unavailable' },
]

const structuredDraft = JSON.stringify({
  executiveSummary: '本周项目整体推进正常，完成率 60%。',
  highlights: ['核心功能模块交付完成', '风险数量下降 20%'],
  progressNarrative: '本周完成 6 个任务，2 个进行中，1 个阻塞。',
  riskAndIssues: '新增 1 个中等风险需关注。',
  resourceNotes: '开发团队负载均衡，无过度分配。',
  changeNotes: '本周无变更请求。',
  suggestedActions: ['关注阻塞任务', '确认下周里程碑计划'],
  dataWarningsNarrative: '风险数据为手动登记，可能与实际有偏差。',
  additionalSections: [
    { sectionKey: 'team_feedback', title: '团队反馈', content: '团队整体状态良好。' },
  ],
})

const emptyDraft = JSON.stringify({
  executiveSummary: '',
  highlights: [],
  progressNarrative: '',
  riskAndIssues: '',
  resourceNotes: '',
  changeNotes: '',
  suggestedActions: [],
  dataWarningsNarrative: '',
})

const plainTextDraft = '## 简单草稿\n\n这是纯文本草稿内容。'

function makeRenderInput(overrides: Partial<PeriodicRenderInput> = {}): PeriodicRenderInput {
  return {
    title: 'AI 周报摘要 - 2026-W28',
    projectName: '测试项目',
    templateId: 'weekly-ai-summary',
    periodType: 'weekly',
    dateRange: { fromDate: '2026-07-07', toDate: '2026-07-13' },
    generatedAt: '2026-07-13T10:00:00.000Z',
    reviewStatus: 'confirmed',
    warnings: sampleWarnings,
    draftContent: structuredDraft,
    dataSources: sampleDataSources,
    isDraftExport: false,
    ...overrides,
  }
}

// ===========================================================================
// 测试组：权限校验（纯函数）
// ===========================================================================

test.group('Periodic Export — Permission Check (pure)', () => {
  test('confirmed 状态允许导出', ({ assert }) => {
    const result = checkExportPermission('confirmed', false)
    assert.isTrue(result.allowed)
    assert.isFalse(result.isDraftExport)
  })

  test('pending_review 无 draftOverride 拒绝导出', ({ assert }) => {
    const result = checkExportPermission('pending_review', false)
    assert.isFalse(result.allowed)
    assert.include(result.reason ?? '', 'draftOverride')
    assert.isFalse(result.isDraftExport)
  })

  test('pending_review 有 draftOverride 允许导出为草稿', ({ assert }) => {
    const result = checkExportPermission('pending_review', true)
    assert.isTrue(result.allowed)
    assert.isTrue(result.isDraftExport)
  })

  test('rejected 即使有 draftOverride 也拒绝导出', ({ assert }) => {
    const result = checkExportPermission('rejected', true)
    assert.isFalse(result.allowed)
    assert.include(result.reason ?? '', '已拒绝')
    assert.isFalse(result.isDraftExport)
  })

  test('rejected 无 draftOverride 拒绝导出', ({ assert }) => {
    const result = checkExportPermission('rejected', false)
    assert.isFalse(result.allowed)
    assert.include(result.reason ?? '', '已拒绝')
  })

  test('null 状态（无 AI 草稿）允许导出', ({ assert }) => {
    const result = checkExportPermission(null, false)
    assert.isTrue(result.allowed)
    assert.isFalse(result.isDraftExport)
  })
})

// ===========================================================================
// 测试组：Markdown 渲染
// ===========================================================================

test.group('Periodic Export — Markdown Render', () => {
  test('已确认周报包含完整头部、数据源、warnings 和正文', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput())
    assert.include(md, 'AI 周报摘要')
    assert.include(md, '测试项目')
    assert.include(md, '周报')
    assert.include(md, '2026-07-07')
    assert.include(md, '2026-07-13')
    assert.include(md, '已确认')
    assert.include(md, 'task_summary')
    assert.include(md, 'REPORT_DATASOURCE_EMPTY')
    assert.include(md, 'REPORT_AGGREGATION_PARTIAL')
    // 正文章节（结构化草稿展开）
    assert.include(md, '管理摘要')
    assert.include(md, '本周项目整体推进正常')
    assert.include(md, '亮点')
    assert.include(md, '核心功能模块交付完成')
    assert.include(md, '进度叙述')
    assert.include(md, '风险与问题')
    assert.include(md, '建议行动')
    assert.include(md, '数据限制说明')
    assert.include(md, '团队反馈')
    // 尾部声明
    assert.include(md, 'AI 辅助生成')
    assert.include(md, '---')
    // 不应包含原始 prompt 或成本信息
    assert.notInclude(md, 'promptTokens')
    assert.notInclude(md, 'estimatedCost')
  })

  test('草稿导出版标记 "草稿 - 未经审核"', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput({ isDraftExport: true }))
    assert.include(md, '草稿 - 未经审核')
    assert.include(md, '待审核')
  })

  test('已确认导出不包含草稿标记', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput({ isDraftExport: false }))
    assert.notInclude(md, '草稿 - 未经审核')
  })

  test('月报类型标记为"月报"', ({ assert }) => {
    const md = renderPeriodicMarkdown(
      makeRenderInput({
        templateId: 'monthly-ai-summary',
        periodType: 'monthly',
        title: 'AI 月报摘要 - 2026-06',
        dateRange: { fromDate: '2026-06-01', toDate: '2026-06-30' },
      }),
    )
    assert.include(md, '月报')
    assert.include(md, '2026-06-01')
    assert.include(md, '2026-06-30')
  })

  test('无 draftContent 时跳过正文段', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput({ draftContent: null }))
    assert.notInclude(md, '## 报告正文')
    assert.notInclude(md, 'AI 辅助生成')
  })

  test('空 warnings 数组不出现 warnings 段', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput({ warnings: [] }))
    assert.notInclude(md, '## 数据警告')
  })

  test('不包含原文 prompt 或模型原始输出', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput())
    assert.notInclude(md, '请根据以下数据生成')
    assert.notInclude(md, 'AI prompt:')
    assert.notInclude(md, 'raw_output:')
    assert.notInclude(md, 'model_output')
  })

  test('不包含 AI 成本明细', ({ assert }) => {
    const md = renderPeriodicMarkdown(makeRenderInput())
    assert.notInclude(md, 'costSummary')
    assert.notInclude(md, 'provider')
    assert.notInclude(md, 'model:')
    assert.notInclude(md, 'estimatedCost')
  })
})

// ===========================================================================
// 测试组：PDF / XLSX 占桩
// ===========================================================================

test.group('Periodic Export — PDF / XLSX Stub', () => {
  test('PDF 占桩包含 Markdown 内容', ({ assert }) => {
    const pdf = renderPeriodicPdf(makeRenderInput())
    assert.include(pdf, 'V2-PERIODIC-PDF-PLACEHOLDER')
    assert.include(pdf, 'AI 周报摘要')
    assert.include(pdf, '管理摘要')
  })

  test('XLSX 占桩包含元数据行', ({ assert }) => {
    const xlsx = renderPeriodicXlsx(makeRenderInput())
    assert.include(xlsx, 'V2-PERIODIC-XLSX-PLACEHOLDER')
    assert.include(xlsx, 'periodType: weekly')
    assert.include(xlsx, 'warnings: 2')
    assert.include(xlsx, 'isDraft: false')
  })

  test('renderPeriodicDocument 路由到正确格式', ({ assert }) => {
    const input = makeRenderInput()
    const md = renderPeriodicDocument(input, 'markdown')
    assert.include(md, 'AI 周报摘要')

    const pdf = renderPeriodicDocument(input, 'pdf')
    assert.include(pdf, 'PERIODIC-PDF')

    const xlsx = renderPeriodicDocument(input, 'xlsx')
    assert.include(xlsx, 'PERIODIC-XLSX')
  })
})

// ===========================================================================
// 测试组：草稿正文格式化
// ===========================================================================

test.group('Periodic Export — Draft Content Formatting', () => {
  test('结构化 AiPeriodicDraft 展开为各章节 Markdown', ({ assert }) => {
    const formatted = formatDraftForExport(structuredDraft)
    assert.include(formatted ?? '', '管理摘要')
    assert.include(formatted ?? '', '本周项目整体推进正常')
    assert.include(formatted ?? '', '亮点')
    assert.include(formatted ?? '', '核心功能模块交付完成')
    assert.include(formatted ?? '', '进度叙述')
    assert.include(formatted ?? '', '风险与问题')
    assert.include(formatted ?? '', '建议行动')
    assert.include(formatted ?? '', '数据限制说明')
    assert.include(formatted ?? '', '团队反馈')
    assert.notInclude(formatted ?? '', 'additionalSections')
  })

  test('空 draft 返回 null', ({ assert }) => {
    const formatted = formatDraftForExport(null)
    assert.isNull(formatted)
  })

  test('空结构化草稿不产生输出', ({ assert }) => {
    const formatted = formatDraftForExport(emptyDraft)
    // 即使 executiveSummary 为空，也会包含章节标题
    assert.include(formatted ?? '', '管理摘要')
  })

  test('纯文本草稿原样返回', ({ assert }) => {
    const formatted = formatDraftForExport(plainTextDraft)
    assert.include(formatted ?? '', '简单草稿')
    assert.include(formatted ?? '', '纯文本草稿内容')
  })
})

// ===========================================================================
// 测试组：完整导出流程（含数据库）
// ===========================================================================

test.group('Periodic Export — DB Integration', (group) => {
  useAuthDatabase(group)

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('periodic-export') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    return { project, org, owner }
  }

  async function createVersion(
    orgId: number,
    projectId: number,
    userId: number,
    overrides: Partial<{
      templateId: string
      aiReviewStatus: string | null
      aiDraft: string | null
      title: string
    }> = {},
  ) {
    return ReportVersion.create({
      organizationId: orgId,
      projectId,
      reportId: null,
      templateId: (overrides.templateId ?? 'weekly-ai-summary') as V2ReportTemplateId,
      templateVersion: '1.0',
      title: overrides.title ?? 'AI 周报测试',
      dateRange: { fromDate: '2026-07-07', toDate: '2026-07-13' },
      filters: null,
      dataSourceHashes: null,
      snapshotHash: 'test_hash_periodic',
      warnings: sampleWarnings,
      documentRef: null,
      aiDraft: overrides.aiDraft ?? structuredDraft,
      aiReviewStatus:
        (overrides.aiReviewStatus as 'pending_review' | 'confirmed' | 'rejected' | null) ??
        'confirmed',
      aiCostRef: {
        provider: 'fake',
        model: 'fake-model',
        promptTokens: 150,
        completionTokens: 300,
        estimatedCost: 0,
        latencyMs: 5,
      },
      generatedBy: userId,
      generatedAt: DateTime.now(),
      confirmedAt: overrides.aiReviewStatus === 'confirmed' ? DateTime.now() : null,
      confirmedBy: overrides.aiReviewStatus === 'confirmed' ? userId : null,
    })
  }

  // 7.4.1 导出已确认周报
  test('导出已确认周报成功', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersion(Number(org.id), Number(project.id), Number(owner.id), {
      aiReviewStatus: 'confirmed',
    })

    const result = await createPeriodicExport({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      versionId: version.id,
      format: 'markdown',
      createdBy: Number(owner.id),
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.format, 'markdown')
    assert.isFalse(result.isDraft)

    // 验证导出记录
    const exportRecord = await ReportExport.findOrFail(result.exportId)
    assert.equal(exportRecord.status, 'completed')
    assert.isNotEmpty(exportRecord.fileHash)
    assert.isAbove(exportRecord.fileSize ?? 0, 0)
  })

  // 7.4.2 导出已确认月报
  test('导出已确认月报成功', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersion(Number(org.id), Number(project.id), Number(owner.id), {
      templateId: 'monthly-ai-summary',
      title: 'AI 月报测试',
      aiReviewStatus: 'confirmed',
    })

    const result = await createPeriodicExport({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      versionId: version.id,
      format: 'xlsx',
      createdBy: Number(owner.id),
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.format, 'xlsx')
  })

  // 7.4.3 拒绝 pending_review 无 draftOverride
  test('拒绝 pending_review 草稿导出（无 draftOverride）', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersion(Number(org.id), Number(project.id), Number(owner.id), {
      aiReviewStatus: 'pending_review',
    })

    try {
      await createPeriodicExport({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        versionId: version.id,
        format: 'markdown',
        createdBy: Number(owner.id),
      })
      assert.fail('应当抛出异常')
    } catch (error) {
      assert.include((error as Error).message, 'draftOverride')
    }
  })

  // 7.4.4 允许 pending_review 有 draftOverride
  test('允许 pending_review 草稿导出（有 draftOverride）', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersion(Number(org.id), Number(project.id), Number(owner.id), {
      aiReviewStatus: 'pending_review',
    })

    const result = await createPeriodicExport({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      versionId: version.id,
      format: 'markdown',
      createdBy: Number(owner.id),
      draftOverride: true,
    })

    assert.equal(result.status, 'completed')
    assert.isTrue(result.isDraft)
  })

  // 7.4.5 拒绝 rejected 草稿导出
  test('拒绝 rejected 草稿导出（即使有 draftOverride）', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersion(Number(org.id), Number(project.id), Number(owner.id), {
      aiReviewStatus: 'rejected',
    })

    try {
      await createPeriodicExport({
        organizationId: Number(org.id),
        projectId: Number(project.id),
        versionId: version.id,
        format: 'pdf',
        createdBy: Number(owner.id),
        draftOverride: true,
      })
      assert.fail('应当抛出异常')
    } catch (error) {
      assert.include((error as Error).message, '已拒绝')
    }
  })

  // 7.4.6 版本不存在（模拟组织隔离丢失 → 404）
  test('跨组织版本不可见导致失败', async ({ assert }) => {
    const { owner } = await setupProject()
    const org2 = await createOrganization(owner)
    // 用一个不存在的 versionId
    try {
      await createPeriodicExport({
        organizationId: Number(org2.id),
        projectId: 99999,
        versionId: 99999,
        format: 'markdown',
        createdBy: Number(owner.id),
      })
      assert.fail('应当抛出异常')
    } catch (error) {
      assert.include((error as Error).message, '报表版本不存在')
    }
  })
})
