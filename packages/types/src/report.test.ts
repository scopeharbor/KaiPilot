import { describe, expect, expectTypeOf, test } from 'vitest'
import type {
  CreateReportRequest,
  CreateReportResponse,
  DelaySnapshot,
  ExportReportRequest,
  ExportReportResponse,
  GetReportResponse,
  ListReportsResponse,
  MilestoneSnapshot,
  ProgressSnapshot,
  Report,
  ReportExportFormat,
  ReportFormatConfig,
  ReportGenerateFilters,
  ReportListFilters,
  ReportSnapshot,
  ReportSnapshotMetadata,
  ReportTemplate,
  ReportTemplateVersion,
  ReportWarning,
  ReportWarningLevel,
  WorkloadSnapshot,
  V2ReportTemplateId,
  V2ReportExportFormat,
  ReportJobStatus,
  ReportAiReviewStatus,
  ReportDataSourceStatus,
  ReportWarningCode,
  ReportDataSourceResult,
  ReportDocument,
  ReportDocumentSection,
  ReportVersion,
  ReportJob,
  ReportExport,
  ReportTemplateEntry,
  ReportWarningV2,
} from './report.js'
import {
  REPORT_EXPORT_FORMATS,
  REPORT_TEMPLATES,
  REPORT_TEMPLATE_VERSION,
  REPORT_WARNING_LEVELS,
  isReportExportFormat,
  isReportTemplate,
  V2_REPORT_TEMPLATES,
  V2_REPORT_EXPORT_FORMATS,
  REPORT_JOB_STATUSES,
  REPORT_AI_REVIEW_STATUSES,
  REPORT_DATASOURCE_STATUSES,
  REPORT_WARNING_CODES,
  V1_TO_V2_TEMPLATE_ID,
  V2_TO_V1_TEMPLATE_TYPE,
  isV2ReportExportFormat,
  isV2ReportTemplate,
  isReportJobStatus,
  AI_PERIODIC_TEMPLATES,
  isAiPeriodicTemplate,
  PERIOD_TYPES,
  TEMPLATE_TO_PERIOD_TYPE,
  AI_REVIEW_ACTIONS,
} from './report.js'

describe('report type contract', () => {
  // -----------------------------------------------------------------------
  // 常量 - V1
  // -----------------------------------------------------------------------

  test('REPORT_TEMPLATE_VERSION is 1.0', () => {
    expectTypeOf(REPORT_TEMPLATE_VERSION).toEqualTypeOf<ReportTemplateVersion>()
    expect(REPORT_TEMPLATE_VERSION).toBe('1.0')
  })

  test('REPORT_TEMPLATES 包含四个 V1 白名单模板', () => {
    const templates: readonly string[] = REPORT_TEMPLATES
    expect(templates).toContain('progress')
    expect(templates).toContain('delay')
    expect(templates).toContain('workload')
    expect(templates).toContain('milestone')
    expect(templates).toHaveLength(4)
  })

  test('REPORT_EXPORT_FORMATS 仅包含 markdown 与 csv', () => {
    const formats: readonly string[] = REPORT_EXPORT_FORMATS
    expect(formats).toContain('markdown')
    expect(formats).toContain('csv')
    expect(formats).toHaveLength(2)
  })

  test('REPORT_WARNING_LEVELS 包含三档严重度', () => {
    const levels: readonly string[] = REPORT_WARNING_LEVELS
    expect(levels).toContain('info')
    expect(levels).toContain('warning')
    expect(levels).toContain('critical')
    expect(levels).toHaveLength(3)
  })

  // -----------------------------------------------------------------------
  // 常量 - V2
  // -----------------------------------------------------------------------

  test('V2_REPORT_TEMPLATES 包含 V1 四模板 + V2 九模板', () => {
    expect(V2_REPORT_TEMPLATES).toContain('progress')
    expect(V2_REPORT_TEMPLATES).toContain('delay')
    expect(V2_REPORT_TEMPLATES).toContain('workload')
    expect(V2_REPORT_TEMPLATES).toContain('milestone')
    expect(V2_REPORT_TEMPLATES).toContain('project-weekly')
    expect(V2_REPORT_TEMPLATES).toContain('project-monthly')
    expect(V2_REPORT_TEMPLATES).toContain('milestone-tracking')
    expect(V2_REPORT_TEMPLATES).toContain('resource-summary')
    expect(V2_REPORT_TEMPLATES).toContain('risk-summary')
    expect(V2_REPORT_TEMPLATES).toContain('health-summary')
    expect(V2_REPORT_TEMPLATES).toContain('stakeholder-briefing')
    expect(V2_REPORT_TEMPLATES).toContain('weekly-ai-summary')
    expect(V2_REPORT_TEMPLATES).toContain('monthly-ai-summary')
    expect(V2_REPORT_TEMPLATES).toHaveLength(13)
  })

  test('V2_REPORT_EXPORT_FORMATS 包含 markdown/csv/pdf/xlsx', () => {
    expect(V2_REPORT_EXPORT_FORMATS).toContain('markdown')
    expect(V2_REPORT_EXPORT_FORMATS).toContain('csv')
    expect(V2_REPORT_EXPORT_FORMATS).toContain('pdf')
    expect(V2_REPORT_EXPORT_FORMATS).toContain('xlsx')
    expect(V2_REPORT_EXPORT_FORMATS).toHaveLength(4)
  })

  test('REPORT_JOB_STATUSES 包含五状态', () => {
    expect(REPORT_JOB_STATUSES).toContain('queued')
    expect(REPORT_JOB_STATUSES).toContain('running')
    expect(REPORT_JOB_STATUSES).toContain('succeeded')
    expect(REPORT_JOB_STATUSES).toContain('failed')
    expect(REPORT_JOB_STATUSES).toContain('cancelled')
    expect(REPORT_JOB_STATUSES).toHaveLength(5)
  })

  test('REPORT_AI_REVIEW_STATUSES 包含四状态', () => {
    expect(REPORT_AI_REVIEW_STATUSES).toContain('pending_review')
    expect(REPORT_AI_REVIEW_STATUSES).toContain('editing')
    expect(REPORT_AI_REVIEW_STATUSES).toContain('confirmed')
    expect(REPORT_AI_REVIEW_STATUSES).toContain('rejected')
    expect(REPORT_AI_REVIEW_STATUSES).toHaveLength(4)
  })

  test('REPORT_DATASOURCE_STATUSES 包含四状态', () => {
    expect(REPORT_DATASOURCE_STATUSES).toContain('available')
    expect(REPORT_DATASOURCE_STATUSES).toContain('unavailable')
    expect(REPORT_DATASOURCE_STATUSES).toContain('forbidden')
    expect(REPORT_DATASOURCE_STATUSES).toContain('timeout')
    expect(REPORT_DATASOURCE_STATUSES).toHaveLength(4)
  })

  test('REPORT_WARNING_CODES 包含所有 V2 warning code', () => {
    expect(REPORT_WARNING_CODES.DATASOURCE_UNAVAILABLE).toBe('REPORT_DATASOURCE_UNAVAILABLE')
    expect(REPORT_WARNING_CODES.DATASOURCE_FORBIDDEN).toBe('REPORT_DATASOURCE_FORBIDDEN')
    expect(REPORT_WARNING_CODES.DATASOURCE_TIMEOUT).toBe('REPORT_DATASOURCE_TIMEOUT')
    expect(REPORT_WARNING_CODES.DATASOURCE_EMPTY).toBe('REPORT_DATASOURCE_EMPTY')
    expect(REPORT_WARNING_CODES.AI_BUDGET_HARD).toBe('REPORT_AI_BUDGET_HARD')
    expect(REPORT_WARNING_CODES.AI_BUDGET_BLOCKED).toBe('REPORT_AI_BUDGET_BLOCKED')
    expect(REPORT_WARNING_CODES.AI_PARSE_FAILED).toBe('REPORT_AI_PARSE_FAILED')
    expect(REPORT_WARNING_CODES.AI_DRAFT_FAILED).toBe('REPORT_AI_DRAFT_FAILED')
    expect(REPORT_WARNING_CODES.EXPORT_RENDER_FAILED).toBe('REPORT_EXPORT_RENDER_FAILED')
    expect(REPORT_WARNING_CODES.HEALTH_DIAGNOSIS_UNAVAILABLE).toBe('HEALTH_DIAGNOSIS_UNAVAILABLE')
  })

  test('AI_PERIODIC_TEMPLATES 包含两个 AI 模板', () => {
    expect(AI_PERIODIC_TEMPLATES).toContain('weekly-ai-summary')
    expect(AI_PERIODIC_TEMPLATES).toContain('monthly-ai-summary')
    expect(AI_PERIODIC_TEMPLATES).toHaveLength(2)
  })

  test('isAiPeriodicTemplate 返回 true 仅对 AI 周期模板', () => {
    expect(isAiPeriodicTemplate('weekly-ai-summary')).toBe(true)
    expect(isAiPeriodicTemplate('monthly-ai-summary')).toBe(true)
    expect(isAiPeriodicTemplate('progress')).toBe(false)
    expect(isAiPeriodicTemplate('project-weekly')).toBe(false)
    expect(isAiPeriodicTemplate('')).toBe(false)
  })

  test('PERIOD_TYPES 包含 weekly 和 monthly', () => {
    expect(PERIOD_TYPES).toContain('weekly')
    expect(PERIOD_TYPES).toContain('monthly')
    expect(PERIOD_TYPES).toHaveLength(2)
  })

  test('TEMPLATE_TO_PERIOD_TYPE 正确映射', () => {
    expect(TEMPLATE_TO_PERIOD_TYPE['weekly-ai-summary']).toBe('weekly')
    expect(TEMPLATE_TO_PERIOD_TYPE['monthly-ai-summary']).toBe('monthly')
  })

  test('AI_REVIEW_ACTIONS 包含三动作', () => {
    expect(AI_REVIEW_ACTIONS).toContain('confirm')
    expect(AI_REVIEW_ACTIONS).toContain('return')
    expect(AI_REVIEW_ACTIONS).toContain('edit')
    expect(AI_REVIEW_ACTIONS).toHaveLength(3)
  })

  test('V2ReportTemplateId 包含 13 模板', () => {
    expectTypeOf<V2ReportTemplateId>().toEqualTypeOf<
      | 'progress'
      | 'delay'
      | 'workload'
      | 'milestone'
      | 'project-weekly'
      | 'project-monthly'
      | 'milestone-tracking'
      | 'resource-summary'
      | 'risk-summary'
      | 'health-summary'
      | 'stakeholder-briefing'
      | 'weekly-ai-summary'
      | 'monthly-ai-summary'
    >()
  })

  // -----------------------------------------------------------------------
  // V1→V2 映射
  // -----------------------------------------------------------------------

  test('V1_TO_V2_TEMPLATE_ID 四模板全部映射', () => {
    expect(V1_TO_V2_TEMPLATE_ID['progress']).toBe('progress')
    expect(V1_TO_V2_TEMPLATE_ID['delay']).toBe('delay')
    expect(V1_TO_V2_TEMPLATE_ID['workload']).toBe('workload')
    expect(V1_TO_V2_TEMPLATE_ID['milestone']).toBe('milestone')
    expect(Object.keys(V1_TO_V2_TEMPLATE_ID)).toHaveLength(4)
  })

  test('V2_TO_V1_TEMPLATE_TYPE 只含 V1 等价模板', () => {
    expect(V2_TO_V1_TEMPLATE_TYPE['progress']).toBe('progress')
    expect(V2_TO_V1_TEMPLATE_TYPE['project-weekly']).toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // 运行时守卫
  // -----------------------------------------------------------------------

  test('isReportTemplate 返回 true 仅对白名单值', () => {
    expect(isReportTemplate('progress')).toBe(true)
    expect(isReportTemplate('delay')).toBe(true)
    expect(isReportTemplate('workload')).toBe(true)
    expect(isReportTemplate('milestone')).toBe(true)
    expect(isReportTemplate('custom')).toBe(false)
    expect(isReportTemplate('project-weekly')).toBe(false) // V2 模板不进 V1 守卫
    expect(isReportTemplate('')).toBe(false)
  })

  test('isReportTemplate 类型收窄为 ReportTemplate', () => {
    const value = 'progress'
    if (isReportTemplate(value)) {
      expectTypeOf(value).toEqualTypeOf<ReportTemplate>()
    }
  })

  test('isReportExportFormat 返回 true 仅对 V1 格式', () => {
    expect(isReportExportFormat('markdown')).toBe(true)
    expect(isReportExportFormat('csv')).toBe(true)
    expect(isReportExportFormat('pdf')).toBe(false)
    expect(isReportExportFormat('xlsx')).toBe(false)
  })

  test('isV2ReportExportFormat 返回 true 对所有 V2 格式', () => {
    expect(isV2ReportExportFormat('markdown')).toBe(true)
    expect(isV2ReportExportFormat('csv')).toBe(true)
    expect(isV2ReportExportFormat('pdf')).toBe(true)
    expect(isV2ReportExportFormat('xlsx')).toBe(true)
    expect(isV2ReportExportFormat('html')).toBe(false)
  })

  test('isV2ReportTemplate 返回 true 对所有 V2 模板', () => {
    expect(isV2ReportTemplate('progress')).toBe(true)
    expect(isV2ReportTemplate('project-weekly')).toBe(true)
    expect(isV2ReportTemplate('custom')).toBe(false)
  })

  test('isReportJobStatus 返回 true 对五状态', () => {
    expect(isReportJobStatus('queued')).toBe(true)
    expect(isReportJobStatus('running')).toBe(true)
    expect(isReportJobStatus('succeeded')).toBe(true)
    expect(isReportJobStatus('failed')).toBe(true)
    expect(isReportJobStatus('cancelled')).toBe(true)
    expect(isReportJobStatus('unknown')).toBe(false)
  })

  // -----------------------------------------------------------------------
  // 类型结构 - V1
  // -----------------------------------------------------------------------

  test("ReportTemplate 是 'progress' | 'delay' | 'workload' | 'milestone'", () => {
    expectTypeOf<ReportTemplate>().toEqualTypeOf<'progress' | 'delay' | 'workload' | 'milestone'>()
  })

  test("ReportExportFormat 是 'markdown' | 'csv'", () => {
    expectTypeOf<ReportExportFormat>().toEqualTypeOf<'markdown' | 'csv'>()
  })

  test('ReportWarningLevel 是三档联合', () => {
    expectTypeOf<ReportWarningLevel>().toEqualTypeOf<'info' | 'warning' | 'critical'>()
  })

  test('ReportWarning 包含 level、message 和可选 context', () => {
    expectTypeOf<ReportWarning>().toMatchTypeOf<{ level: ReportWarningLevel; message: string }>()
    expectTypeOf<ReportWarning>().toHaveProperty('context')
    type HasContext = { context?: Record<string, unknown> }
    expectTypeOf<ReportWarning['context']>().toMatchTypeOf<HasContext['context']>()
  })

  test('ReportSnapshotMetadata 包含必填的可追溯字段', () => {
    expectTypeOf<ReportSnapshotMetadata['templateVersion']>().toEqualTypeOf<ReportTemplateVersion>()
    expectTypeOf<ReportSnapshotMetadata['generatedAt']>().toBeString()
    expectTypeOf<ReportSnapshotMetadata['generatedBy']>().toEqualTypeOf<number | null>()
    expectTypeOf<ReportSnapshotMetadata['sourceRange']>().toEqualTypeOf<ReportGenerateFilters>()
    expectTypeOf<ReportSnapshotMetadata['sourceDataHash']>().toBeString()
    expectTypeOf<ReportSnapshotMetadata['warnings']>().toEqualTypeOf<ReportWarning[]>()
  })

  // -----------------------------------------------------------------------
  // V1 四类快照结构
  // -----------------------------------------------------------------------

  test('ProgressSnapshot 类型结构', () => {
    expectTypeOf<ProgressSnapshot['template']>().toEqualTypeOf<'progress'>()
    expectTypeOf<ProgressSnapshot['summary']['overallProgressPercent']>().toBeNumber()
    expectTypeOf<ProgressSnapshot['summary']['totalTasks']>().toBeNumber()
    expectTypeOf<ProgressSnapshot['summary']['completedTasks']>().toBeNumber()
    expectTypeOf<ProgressSnapshot['statusDistribution']>().toBeArray()
    expectTypeOf<ProgressSnapshot['wbsSummaries']>().toBeArray()
    expectTypeOf<ProgressSnapshot['blockers']>().toBeArray()
  })

  test('DelaySnapshot 类型结构', () => {
    expectTypeOf<DelaySnapshot['template']>().toEqualTypeOf<'delay'>()
    expectTypeOf<DelaySnapshot['summary']['overdueTasks']>().toBeNumber()
    expectTypeOf<DelaySnapshot['summary']['delayRatePercent']>().toBeNumber()
    expectTypeOf<DelaySnapshot['overdueTasks']>().toBeArray()
    expectTypeOf<DelaySnapshot['upcomingTasks']>().toBeArray()
    expectTypeOf<DelaySnapshot['dependencyWarnings']>().toBeArray()
  })

  test('WorkloadSnapshot 类型结构', () => {
    expectTypeOf<WorkloadSnapshot['template']>().toEqualTypeOf<'workload'>()
    expectTypeOf<WorkloadSnapshot['summary']['totalAssignees']>().toBeNumber()
    expectTypeOf<WorkloadSnapshot['summary']['totalPlannedHours']>().toBeNumber()
    expectTypeOf<WorkloadSnapshot['byAssignee']>().toBeArray()
  })

  test('MilestoneSnapshot 类型结构', () => {
    expectTypeOf<MilestoneSnapshot['template']>().toEqualTypeOf<'milestone'>()
    expectTypeOf<MilestoneSnapshot['summary']['totalMilestones']>().toBeNumber()
    expectTypeOf<MilestoneSnapshot['summary']['completedMilestones']>().toBeNumber()
    expectTypeOf<MilestoneSnapshot['milestones']>().toBeArray()
    expectTypeOf<MilestoneSnapshot['risks']>().toBeArray()
  })

  test('ReportSnapshot 是四类快照的联合', () => {
    expectTypeOf<ReportSnapshot>().toEqualTypeOf<
      ProgressSnapshot | DelaySnapshot | WorkloadSnapshot | MilestoneSnapshot
    >()
  })

  // -----------------------------------------------------------------------
  // 类型结构 - V2
  // -----------------------------------------------------------------------

  test('V2ReportTemplateId 包含 11 模板', () => {
    expectTypeOf<V2ReportTemplateId>().toEqualTypeOf<
      | 'progress'
      | 'delay'
      | 'workload'
      | 'milestone'
      | 'project-weekly'
      | 'project-monthly'
      | 'milestone-tracking'
      | 'resource-summary'
      | 'risk-summary'
      | 'health-summary'
      | 'stakeholder-briefing'
    >()
  })

  test('V2ReportExportFormat 包含四格式', () => {
    expectTypeOf<V2ReportExportFormat>().toEqualTypeOf<'markdown' | 'csv' | 'pdf' | 'xlsx'>()
  })

  test('ReportJobStatus 包含五状态', () => {
    expectTypeOf<ReportJobStatus>().toEqualTypeOf<
      'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    >()
  })

  test('ReportAiReviewStatus 包含四状态', () => {
    expectTypeOf<ReportAiReviewStatus>().toEqualTypeOf<
      'pending_review' | 'editing' | 'confirmed' | 'rejected'
    >()
  })

  test('ReportDataSourceStatus 包含四状态', () => {
    expectTypeOf<ReportDataSourceStatus>().toEqualTypeOf<
      'available' | 'unavailable' | 'forbidden' | 'timeout'
    >()
  })

  test('ReportWarningV2 继承 V1 并添加 code', () => {
    expectTypeOf<ReportWarningV2>().toMatchTypeOf<ReportWarning>()
    expectTypeOf<ReportWarningV2['code']>().toEqualTypeOf<ReportWarningCode>()
  })

  test('ReportDataSourceResult 泛型结构', () => {
    const result: ReportDataSourceResult = {
      sourceKey: 'task_summary',
      status: 'available',
      generatedAt: '2026-07-13T00:00:00.000Z',
      data: null,
      warnings: [],
      sourceHash: 'abc123',
    }
    expect(result.sourceKey).toBe('task_summary')
    expect(result.status).toBe('available')
    expect(result.warnings).toEqual([])

    // typed variant
    interface TaskData {
      count: number
    }
    const typed: ReportDataSourceResult<TaskData> = {
      sourceKey: 'task_summary',
      status: 'available',
      generatedAt: '2026-07-13T00:00:00.000Z',
      data: { count: 42 },
      warnings: [],
      sourceHash: 'abc123',
    }
    expectTypeOf(typed.data).toEqualTypeOf<TaskData | null>()
  })

  test('ReportDocumentSection 结构', () => {
    expectTypeOf<ReportDocumentSection['title']>().toBeString()
    expectTypeOf<ReportDocumentSection['type']>().toEqualTypeOf<
      'summary' | 'table' | 'list' | 'text' | 'warnings'
    >()
  })

  test('ReportDocument 结构', () => {
    expectTypeOf<ReportDocument['templateId']>().toEqualTypeOf<V2ReportTemplateId>()
    expectTypeOf<ReportDocument['sections']>().toBeArray()
    expectTypeOf<ReportDocument['warnings']>().toEqualTypeOf<ReportWarningV2[]>()
  })

  test('ReportVersion 结构', () => {
    expectTypeOf<ReportVersion['id']>().toBeNumber()
    expectTypeOf<ReportVersion['templateId']>().toEqualTypeOf<V2ReportTemplateId>()
    expectTypeOf<ReportVersion['snapshotHash']>().toBeString()
    expectTypeOf<ReportVersion['warnings']>().toEqualTypeOf<ReportWarningV2[]>()
  })

  test('ReportJob 结构', () => {
    expectTypeOf<ReportJob['id']>().toBeNumber()
    expectTypeOf<ReportJob['status']>().toEqualTypeOf<ReportJobStatus>()
    expectTypeOf<ReportJob['idempotencyKey']>().toEqualTypeOf<string | null>()
  })

  test('ReportExport 结构', () => {
    expectTypeOf<ReportExport['id']>().toBeNumber()
    expectTypeOf<ReportExport['format']>().toEqualTypeOf<V2ReportExportFormat>()
    expectTypeOf<ReportExport['fileHash']>().toEqualTypeOf<string | null>()
  })

  test('ReportTemplateEntry 结构', () => {
    expectTypeOf<ReportTemplateEntry['templateId']>().toEqualTypeOf<V2ReportTemplateId>()
    expectTypeOf<ReportTemplateEntry['supportedFormats']>().toEqualTypeOf<V2ReportExportFormat[]>()
    expectTypeOf<ReportTemplateEntry['requiredDataSources']>().toBeArray()
  })

  // -----------------------------------------------------------------------
  // AI 周期报表类型
  // -----------------------------------------------------------------------

  test('AiPeriodicDraft 包含所有必需章节', () => {
    interface AiPeriodicDraft {
      executiveSummary: string
      highlights: string[]
      progressNarrative: string
      riskAndIssues: string
      resourceNotes: string
      changeNotes: string
      suggestedActions: string[]
      dataWarningsNarrative: string
      additionalSections?: Array<{ sectionKey: string; title: string; content: string }>
    }
    type Check = AiPeriodicDraft
    expectTypeOf<Check['executiveSummary']>().toBeString()
    expectTypeOf<Check['highlights']>().toEqualTypeOf<string[]>()
    expectTypeOf<Check['suggestedActions']>().toEqualTypeOf<string[]>()
  })

  test('AiCostSummary 包含预算和成本字段', () => {
    expectTypeOf<{
      provider: string
      model: string
      promptTokens: number
      completionTokens: number
      estimatedCost: number
      latencyMs: number
      budgetVerdict: 'passed' | 'hard_blocked' | 'soft_warning'
    }>().toMatchTypeOf<{ provider: string; model: string }>()
  })

  test('PeriodComparison 包含所有对比字段', () => {
    interface PeriodComparison {
      completedDelta: number
      overdueDelta: number
      riskDelta: number
      resourceDelta: number
      changeDelta: number
      activityDelta: number
      currentCompletionRate: number
      previousCompletionRate: number
    }
    expectTypeOf<PeriodComparison['completedDelta']>().toBeNumber()
    expectTypeOf<PeriodComparison['overdueDelta']>().toBeNumber()
    expectTypeOf<PeriodComparison['currentCompletionRate']>().toBeNumber()
  })

  test('ReportVersion 包含新增周期报表字段', () => {
    // periodType should be optional
    type HasPeriodType = { periodType?: 'weekly' | 'monthly' | null }
    expectTypeOf<HasPeriodType['periodType']>().toMatchTypeOf<
      ('weekly' | 'monthly' | null) | undefined
    >()
  })

  test('isV2ReportTemplate 识别 AI 周期模板', () => {
    expect(isV2ReportTemplate('weekly-ai-summary')).toBe(true)
    expect(isV2ReportTemplate('monthly-ai-summary')).toBe(true)
  })

  // -----------------------------------------------------------------------
  // V1 API 请求/响应
  // -----------------------------------------------------------------------

  test('CreateReportRequest 结构', () => {
    expectTypeOf<CreateReportRequest['template']>().toEqualTypeOf<ReportTemplate>()
    expectTypeOf<CreateReportRequest['filters']>().toEqualTypeOf<
      ReportGenerateFilters | undefined
    >()
  })

  test('CreateReportResponse.data 包含 Report', () => {
    expectTypeOf<CreateReportResponse['data']>().toEqualTypeOf<Report>()
  })

  test('ListReportsResponse 含分页 meta', () => {
    expectTypeOf<ListReportsResponse['data']>().toEqualTypeOf<Report[]>()
    expectTypeOf<ListReportsResponse['meta']['total']>().toBeNumber()
    expectTypeOf<ListReportsResponse['meta']['page']>().toBeNumber()
    expectTypeOf<ListReportsResponse['meta']['perPage']>().toBeNumber()
    expectTypeOf<ListReportsResponse['meta']['totalPages']>().toBeNumber()
  })

  test('ExportReportRequest 结构', () => {
    expectTypeOf<ExportReportRequest['format']>().toEqualTypeOf<ReportExportFormat>()
  })

  test('ExportReportResponse 含下载信息', () => {
    expectTypeOf<ExportReportResponse['data']['downloadUrl']>().toBeString()
    expectTypeOf<ExportReportResponse['data']['filename']>().toBeString()
    expectTypeOf<ExportReportResponse['data']['size']>().toBeNumber()
  })
})
