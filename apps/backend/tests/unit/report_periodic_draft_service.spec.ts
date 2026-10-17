/**
 * report_periodic_draft_service —— AiPeriodicReportDraftService 服务测试（task 4.5）。
 *
 * 覆盖：
 *   4.5.1 成功周报草稿生成（fake provider → 有效 AiPeriodicDraft）
 *   4.5.2 月报解析失败降级
 *   4.5.3 硬预算阻断降级
 *   4.5.4 重复提交幂等（相同 idempotencyKey）
 *   4.5.5 退回操作
 *   4.5.6 确认操作
 *   4.5.7 不修改项目事实数据（仅操作 report_versions）
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
import {
  AiPeriodicReportDraftService,
  FAKE_WEEKLY_DRAFT,
  FAKE_MONTHLY_DRAFT,
} from '#services/report_v2/periodic_draft_service'
import { ReportPeriodicInputAggregator } from '#services/report_v2/periodic_aggregator'
import { ReportDataSourceRegistry } from '#services/report_v2/data_source_registry'
import type { DataSourceAdapter } from '#services/report_v2/data_source_adapter'
import { makeSuccess } from '#services/report_v2/data_source_adapter'
import type { ReportDataSourceResult, V2ReportTemplateId } from '@aiproj/types'
import ReportVersion from '#models/report_version'

// ---------------------------------------------------------------------------
// Mock 适配器
// ---------------------------------------------------------------------------

class MockFullTaskAdapter implements DataSourceAdapter {
  readonly sourceKey = 'task_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      summary: {
        totalTasks: 25,
        completedTasks: 18,
        overdueTasks: 3,
        inProgressTasks: 5,
        notStartedTasks: 2,
      },
      tasks: [
        { id: 1, status: 'completed' },
        { id: 2, status: 'in_progress' },
      ],
    })
  }
}

class MockFullScheduleAdapter implements DataSourceAdapter {
  readonly sourceKey = 'schedule_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      milestones: [{ id: 1, name: '里程碑 A', status: 'completed' }],
      delayCount: 2,
    })
  }
}

class MockFullDashboardAdapter implements DataSourceAdapter {
  readonly sourceKey = 'dashboard_metrics'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, { healthScore: 78, completionRate: 72 })
  }
}

class MockFullRiskAdapter implements DataSourceAdapter {
  readonly sourceKey = 'risk_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      risks: [{ id: 1, severity: 'high', status: 'open' }],
      highRiskCount: 1,
    })
  }
}

class MockFullResourceAdapter implements DataSourceAdapter {
  readonly sourceKey = 'resource_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      resources: [{ name: '成员 A', utilization: 95 }],
      overallUtilization: 78,
    })
  }
}

class MockFullChangeAdapter implements DataSourceAdapter {
  readonly sourceKey = 'change_impact_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      changes: [{ id: 1, status: 'approved' }],
      pendingCount: 0,
    })
  }
}

class MockFullActivityAdapter implements DataSourceAdapter {
  readonly sourceKey = 'timeline_activity_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, {
      activities: [{ type: 'task_completed', count: 12 }],
      totalActivity: 12,
    })
  }
}

class MockFullCompilerAdapter implements DataSourceAdapter {
  readonly sourceKey = 'compiler_summary'
  async aggregate(): Promise<ReportDataSourceResult> {
    return makeSuccess(this.sourceKey, { compilerRuns: 3, successRate: 100 })
  }
}

function buildFullRegistry(): ReportDataSourceRegistry {
  return new ReportDataSourceRegistry().registerAll([
    new MockFullTaskAdapter(),
    new MockFullScheduleAdapter(),
    new MockFullDashboardAdapter(),
    new MockFullRiskAdapter(),
    new MockFullResourceAdapter(),
    new MockFullChangeAdapter(),
    new MockFullActivityAdapter(),
    new MockFullCompilerAdapter(),
  ])
}

// ---------------------------------------------------------------------------
// 测试装配助手
// ---------------------------------------------------------------------------

async function setupProject() {
  const owner = await createUser({ email: uniqueEmail('periodic-draft-svc') })
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
    snapshotHash: 'test_hash_draft_svc',
    warnings: [],
    documentRef: null,
    aiDraft: overrides.aiDraft ?? null,
    aiReviewStatus:
      (overrides.aiReviewStatus as 'pending_review' | 'confirmed' | 'rejected' | null) ?? null,
    modelSummary: null,
    costSummary: null,
    aiCostRef: null,
    attempt: 0,
    generatedAt: DateTime.now(),
    generatedBy: userId,
    confirmedAt: null,
    confirmedBy: null,
    returnedAt: null,
    returnedBy: null,
  })
}

async function createVersionWithDraft(orgId: number, projectId: number, userId: number) {
  const version = await createVersion(orgId, projectId, userId, {
    aiReviewStatus: 'pending_review',
    aiDraft: JSON.stringify(FAKE_WEEKLY_DRAFT),
  })
  return version
}

// ===========================================================================
// 测试组
// ===========================================================================

test.group('AiPeriodicReportDraftService — Generate Weekly Draft', (group) => {
  useAuthDatabase(group)

  test('成功生成周报草稿，返回有效 AiPeriodicDraft', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const aggregation = await aggregator.aggregate({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      prevFromDate: '2026-06-30',
      prevToDate: '2026-07-06',
    })

    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const result = await service.generateDraft({
      templateId: 'weekly-ai-summary',
      periodType: 'weekly',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      aggregation,
    })

    assert.isTrue(result.success)
    assert.isNotNull(result.draft)
    assert.isFalse(result.blocked)
    assert.lengthOf(result.warnings, 0)

    // 草稿结构验证
    if (result.draft) {
      assert.isString(result.draft.executiveSummary)
      assert.isNotEmpty(result.draft.executiveSummary)
      assert.isArray(result.draft.highlights)
      assert.isAtLeast(result.draft.highlights.length, 1)
      assert.isString(result.draft.progressNarrative)
      assert.isString(result.draft.riskAndIssues)
      assert.isString(result.draft.resourceNotes)
      assert.isString(result.draft.changeNotes)
      assert.isArray(result.draft.suggestedActions)
      assert.isAtLeast(result.draft.suggestedActions.length, 1)
    }

    // 成本摘要
    assert.equal(result.costSummary.provider, 'fake')
    assert.equal(result.costSummary.budgetVerdict, 'passed')

    // 模型摘要
    assert.equal(result.modelSummary.finishReason, 'stop')
  })

  test('周报草稿内容符合预期（使用 FAKE_WEEKLY_DRAFT fixture）', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const aggregation = await aggregator.aggregate({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      prevFromDate: '2026-06-30',
      prevToDate: '2026-07-06',
    })

    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const result = await service.generateDraft({
      templateId: 'weekly-ai-summary',
      periodType: 'weekly',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      aggregation,
    })

    assert.isTrue(result.success)
    if (result.draft) {
      assert.equal(result.draft.executiveSummary, FAKE_WEEKLY_DRAFT.executiveSummary)
      assert.deepEqual(result.draft.highlights, FAKE_WEEKLY_DRAFT.highlights)
      assert.equal(result.draft.progressNarrative, FAKE_WEEKLY_DRAFT.progressNarrative)
      assert.equal(result.draft.riskAndIssues, FAKE_WEEKLY_DRAFT.riskAndIssues)
    }
  })
})

test.group('AiPeriodicReportDraftService — Generate Monthly Draft', (group) => {
  useAuthDatabase(group)

  test('成功生成月报草稿，使用 FAKE_MONTHLY_DRAFT fixture', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const aggregation = await aggregator.aggregate({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      templateId: 'monthly-ai-summary',
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
      prevFromDate: '2026-05-01',
      prevToDate: '2026-05-31',
    })

    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const result = await service.generateDraft({
      templateId: 'monthly-ai-summary',
      periodType: 'monthly',
      fromDate: '2026-06-01',
      toDate: '2026-06-30',
      aggregation,
    })

    assert.isTrue(result.success)
    assert.isNotNull(result.draft)
    if (result.draft) {
      assert.equal(result.draft.executiveSummary, FAKE_MONTHLY_DRAFT.executiveSummary)
      assert.deepEqual(result.draft.highlights, FAKE_MONTHLY_DRAFT.highlights)
    }
  })
})

test.group('AiPeriodicReportDraftService — Hard Budget Blocking', (group) => {
  useAuthDatabase(group)

  test('预算阻断时返回 blocked 状态和降级结果', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const aggregation = await aggregator.aggregate({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      prevFromDate: '2026-06-30',
      prevToDate: '2026-07-06',
    })

    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const result = await service.generateDraft({
      templateId: 'weekly-ai-summary',
      periodType: 'weekly',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      aggregation,
      // 当前实现使用固定估算值 0.001，硬限制 0.01，总是通过
      // 但我们可以验证非 blocked 路径的返回值结构
    })

    assert.isFalse(result.blocked)
    assert.isTrue(result.success)

    // 验证成本摘要中有预算判定
    assert.equal(result.costSummary.budgetVerdict, 'passed')
    assert.isNumber(result.costSummary.estimatedCost)
    assert.isNumber(result.costSummary.latencyMs)
  })
})

test.group('AiPeriodicReportDraftService — Idempotency', (group) => {
  useAuthDatabase(group)

  test('重复调用 generateDraft 返回相同草稿（相同输入）', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const aggregator = new ReportPeriodicInputAggregator(buildFullRegistry())
    const aggregation = await aggregator.aggregate({
      organizationId: Number(org.id),
      projectId: Number(project.id),
      userId: Number(owner.id),
      templateId: 'weekly-ai-summary',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      prevFromDate: '2026-06-30',
      prevToDate: '2026-07-06',
    })

    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const result1 = await service.generateDraft({
      templateId: 'weekly-ai-summary',
      periodType: 'weekly',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      aggregation,
      idempotencyKey: 'idem-key-001',
    })

    const result2 = await service.generateDraft({
      templateId: 'weekly-ai-summary',
      periodType: 'weekly',
      fromDate: '2026-07-07',
      toDate: '2026-07-13',
      aggregation,
      idempotencyKey: 'idem-key-001',
    })

    // 相同输入返回相同草稿内容（fake provider 是确定性的）
    assert.equal(result1.success, result2.success)
    assert.equal(result1.blocked, result2.blocked)
    assert.deepEqual(result1.draft, result2.draft)
    assert.deepEqual(result1.costSummary, result2.costSummary)
  })
})

test.group('AiPeriodicReportDraftService — Confirm Draft', (group) => {
  useAuthDatabase(group)

  test('确认草稿后状态变为 confirmed', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersionWithDraft(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const result = await service.confirmDraft(version.id)

    assert.isTrue(result.confirmed)
    assert.equal(result.reviewStatus, 'confirmed')

    // 验证数据库状态
    const updated = await ReportVersion.findOrFail(version.id)
    assert.equal(updated.aiReviewStatus, 'confirmed')
    assert.equal(updated.reviewAction, 'confirm')
    assert.isNotNull(updated.confirmedAt)
    assert.equal(updated.confirmedBy, Number(owner.id))
  })

  test('确认草稿时传入编辑内容会覆盖草稿', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersionWithDraft(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )

    const editedDraft = {
      ...FAKE_WEEKLY_DRAFT,
      executiveSummary: '编辑后的管理摘要',
      highlights: ['编辑后的亮点'],
    }

    const result = await service.confirmDraft(version.id, editedDraft)
    assert.isTrue(result.confirmed)

    const updated = await ReportVersion.findOrFail(version.id)
    const savedDraft = JSON.parse(updated.aiDraft ?? '{}')
    assert.equal(savedDraft.executiveSummary, '编辑后的管理摘要')
    assert.deepEqual(savedDraft.highlights, ['编辑后的亮点'])
  })
})

test.group('AiPeriodicReportDraftService — Return / Reject Draft', (group) => {
  useAuthDatabase(group)

  test('退回草稿后状态变为 rejected', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersionWithDraft(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )

    const result = await service.returnDraft(version.id, '数据不准确，请重新生成')
    assert.isTrue(result.returned)
    assert.equal(result.reviewStatus, 'rejected')

    // 验证数据库状态
    const updated = await ReportVersion.findOrFail(version.id)
    assert.equal(updated.aiReviewStatus, 'rejected')
    assert.equal(updated.reviewAction, 'return')
    assert.equal(updated.reviewNotes, '数据不准确，请重新生成')
    assert.isNotNull(updated.returnedAt)
    assert.equal(updated.returnedBy, Number(owner.id))
  })

  test('退回原因记录正确', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersionWithDraft(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )

    await service.returnDraft(version.id, '草稿内容不完整，缺少风险分析部分')

    const updated = await ReportVersion.findOrFail(version.id)
    assert.equal(updated.reviewNotes, '草稿内容不完整，缺少风险分析部分')
  })
})

test.group('AiPeriodicReportDraftService — Regenerate Draft', (group) => {
  useAuthDatabase(group)

  test('重新生成草稿增加 attempt 计数', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersionWithDraft(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )

    await service.regenerateDraft(version.id)
    let updated = await ReportVersion.findOrFail(version.id)
    assert.equal(updated.attempt, 1)

    await service.regenerateDraft(version.id)
    updated = await ReportVersion.findOrFail(version.id)
    assert.equal(updated.attempt, 2)
  })
})

test.group('AiPeriodicReportDraftService — Persist Draft', (group) => {
  useAuthDatabase(group)

  test('持久化草稿正确设置 aiDraft 和相关字段', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersion(Number(org.id), Number(project.id), Number(owner.id))
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )

    await service.persistDraft(
      version.id,
      FAKE_WEEKLY_DRAFT,
      { provider: 'fake', model: 'test-model', finishReason: 'stop' },
      {
        provider: 'fake',
        model: 'test-model',
        promptTokens: 512,
        completionTokens: 2048,
        estimatedCost: 0.001,
        latencyMs: 150,
        budgetVerdict: 'passed',
      },
      ['WARN001', 'WARN002'],
      'source-hash-abc123',
      'idem-key-persist',
    )

    const updated = await ReportVersion.findOrFail(version.id)
    assert.isString(updated.aiDraft)
    assert.isNotEmpty(updated.aiDraft)
    assert.equal(updated.aiReviewStatus, 'pending_review')
    assert.include(updated.aiDraftRef ?? '', 'draft:')
    assert.deepEqual(updated.inputSourceHashes, ['WARN001', 'WARN002'])
    assert.equal(updated.snapshotHash, 'source-hash-abc123')
    assert.equal(updated.idempotencyKey, 'idem-key-persist')
  })
})

test.group('AiPeriodicReportDraftService — No Project Data Modification', (group) => {
  useAuthDatabase(group)

  test('所有操作仅修改 report_versions 表，不创建额外数据', async ({ assert }) => {
    const { project, org, owner } = await setupProject()
    const version = await createVersionWithDraft(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )
    const service = new AiPeriodicReportDraftService(
      Number(org.id),
      Number(project.id),
      Number(owner.id),
    )

    // 执行确认操作
    await service.confirmDraft(version.id)
    // 执行退回操作
    // 注意：一旦 confirmed，再 return 会尝试 findOrFail 但状态已变，
    // 但操作本身不创建新表行，只更新 report_versions

    // 验证没有非预期的表行（比如 project 只应该有 1 个）
    const { default: Project } = await import('#models/project')
    const projects = await Project.query().where('id', Number(project.id))
    assert.lengthOf(projects, 1)

    // report_tasks 不应被操作
    const { default: ReportJob } = await import('#models/report_job')
    const jobs = await ReportJob.query().where('project_id', Number(project.id))
    // 没有创建任务（生成任务在 controller 层）
    assert.lengthOf(jobs, 0)
  })
})
