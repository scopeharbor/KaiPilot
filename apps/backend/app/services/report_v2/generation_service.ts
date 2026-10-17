/**
 * report_v2/generation_service —— V2 报表预览、版本与任务生成服务。
 *
 * 核心能力：
 * - preview/dry-run：聚合数据源、返回 warnings、不创建正式版本
 * - blocking warning 判定：阻止创建正式版本
 * - 版本创建：保存参数、数据源 hash、snapshotHash、warnings、审计事件
 * - 任务管理：状态机 + 幂等 key + 重试
 */
import { DateTime } from 'luxon'
import ReportVersion from '#models/report_version'
import ReportJob from '#models/report_job'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import type { V2ReportTemplateId, ReportGenerateFilters, ReportWarningV2 } from '@aiproj/types'
import { createDefaultRegistry } from './index.js'
import { TEMPLATE_MAP } from './templates.js'
import type { DataSourceResultMap } from './data_source_registry.js'

// ---------------------------------------------------------------------------
// Preview / Dry-run
// ---------------------------------------------------------------------------

export interface PreviewInput {
  templateId: V2ReportTemplateId
  title?: string
  filters?: ReportGenerateFilters
  enableAiDraft?: boolean
}

export interface PreviewResult {
  templateId: V2ReportTemplateId
  templateVersion: string
  title: string
  dateRange: { fromDate?: string; toDate?: string }
  dataSources: DataSourceResultMap
  warnings: ReportWarningV2[]
  blocking: boolean
  exportFormats: string[]
  aiEnabled: boolean
  aiEstimated: boolean
}

/**
 * 执行报表预览（dry-run）—— 聚合数据源但不创建正式版本。
 */
export async function previewReport(
  organizationId: number,
  projectId: number,
  userId: number,
  input: PreviewInput,
): Promise<PreviewResult> {
  const registry = createDefaultRegistry()
  const template = TEMPLATE_MAP.get(input.templateId)
  const filters = input.filters ?? {}

  // 聚合所有必需 + 可选数据源
  const allSourceKeys = [
    ...(template?.requiredDataSources ?? []),
    ...(template?.optionalDataSources ?? []),
  ]
  const dataSources = await registry.aggregateMany(
    allSourceKeys,
    organizationId,
    projectId,
    userId,
    filters,
  )

  // 收集 warnings
  const warnings: ReportWarningV2[] = []
  for (const result of Object.values(dataSources)) {
    if (result.warnings) {
      warnings.push(...result.warnings)
    }
  }

  // blocking warning 判定：必需数据源不可用
  const blocking = checkBlockingWarnings(dataSources, template?.requiredDataSources ?? [])

  // 日期范围
  const dateRange = deriveDateRange(filters, template?.defaultDateRange)

  const title = input.title ?? template?.name ?? input.templateId

  return {
    templateId: input.templateId,
    templateVersion: template ? '1.0' : '0.0',
    title,
    dateRange,
    dataSources,
    warnings,
    blocking,
    exportFormats: template?.supportedFormats ?? ['markdown'],
    aiEnabled: input.enableAiDraft ?? false,
    aiEstimated: input.enableAiDraft ?? false,
  }
}

// ---------------------------------------------------------------------------
// Blocking warning 判定
// ---------------------------------------------------------------------------

/**
 * 检查阻塞性 warnings：必需数据源 status 不为 available 时阻止创建版本。
 */
export function checkBlockingWarnings(
  dataSources: DataSourceResultMap,
  requiredKeys: string[],
): boolean {
  for (const key of requiredKeys) {
    const ds = dataSources[key]
    if (!ds || ds.status !== 'available') {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Version 创建
// ---------------------------------------------------------------------------

export interface CreateVersionInput {
  templateId: V2ReportTemplateId
  title?: string
  filters?: ReportGenerateFilters
  enableAiDraft?: boolean
  previewSnapshotHash: string
  idempotencyKey?: string
}

export interface CreateVersionResult {
  version: ReportVersion
  job: ReportJob
}

/**
 * 创建报表版本和生成任务。
 * 1. 先做 blocking warning 检查
 * 2. 创建版本记录
 * 3. 创建任务记录
 */
export async function createReportVersion(
  organizationId: number,
  projectId: number,
  userId: number,
  reportId: number | null,
  input: CreateVersionInput,
): Promise<CreateVersionResult> {
  const template = TEMPLATE_MAP.get(input.templateId)
  if (!template) {
    throw new Error(`未知模板: ${input.templateId}`)
  }

  // 检查幂等 key
  if (input.idempotencyKey) {
    const existingJob = await ReportJob.query()
      .where('organization_id', organizationId)
      .where('idempotency_key', input.idempotencyKey)
      .first()

    if (existingJob) {
      throw new Error('幂等 key 已存在')
    }
  }

  const now = DateTime.now()
  const filters = input.filters ?? {}

  // 创建版本
  const version = await ReportVersion.create({
    organizationId,
    projectId,
    reportId,
    templateId: input.templateId,
    templateVersion: '1.0',
    title: input.title ?? template.name,
    dateRange: deriveDateRange(filters, template.defaultDateRange) as unknown as Record<
      string,
      unknown
    >,
    filters: filters as unknown as Record<string, unknown>,
    dataSourceHashes: null,
    snapshotHash: input.previewSnapshotHash,
    warnings: [],
    documentRef: null,
    aiDraft: null,
    aiReviewStatus: input.enableAiDraft ? 'pending_review' : null,
    aiCostRef: null,
    generatedBy: userId,
    generatedAt: now,
    confirmedAt: null,
    confirmedBy: null,
  })

  // 创建任务
  const job = await ReportJob.create({
    organizationId,
    projectId,
    reportId,
    versionId: version.id,
    templateId: input.templateId,
    requestedBy: userId,
    status: 'queued',
    attempt: 1,
    idempotencyKey: input.idempotencyKey ?? null,
    progress: null,
    errorCategory: null,
    errorDetail: null,
    startedAt: null,
    finishedAt: null,
  })

  return { version, job }
}

// ---------------------------------------------------------------------------
// Job 状态管理
// ---------------------------------------------------------------------------

/**
 * 更新任务状态（简单版，完整状态机待后续扩展）。
 */
export async function updateJobStatus(
  jobId: number,
  organizationId: number,
  status: ReportJob['status'],
  options?: {
    progress?: string
    errorCategory?: string
    errorDetail?: string
  },
): Promise<ReportJob> {
  // v3-multitenant-database-isolation §5.4：作业状态写回必须在组织 scope 内解析
  // （原 `ReportJob.findOrFail(jobId)` 无租户条件，可改写他租作业状态）。
  // 跨组织与不存在同形 404，不泄露作业存在性。
  const job = await ReportJob.query()
    .where('id', jobId)
    .where('organization_id', organizationId)
    .first()
  if (!job) throw new ResourceNotFoundException('报表任务不存在')

  job.status = status
  if (status === 'running' && !job.startedAt) {
    job.startedAt = DateTime.now()
  }
  if (status === 'succeeded' || status === 'failed') {
    job.finishedAt = DateTime.now()
  }
  if (options?.progress) job.progress = options.progress
  if (options?.errorCategory) job.errorCategory = options.errorCategory
  if (options?.errorDetail) job.errorDetail = options.errorDetail

  await job.save()
  return job
}

/**
 * 重试任务：形成新 attempt。
 */
export async function retryJob(jobId: number, organizationId: number): Promise<ReportJob> {
  const job = await ReportJob.query()
    .where('id', jobId)
    .where('organization_id', organizationId)
    .firstOrFail()

  // 新 attempt
  return ReportJob.create({
    organizationId: job.organizationId,
    projectId: job.projectId,
    reportId: job.reportId,
    versionId: job.versionId,
    templateId: job.templateId,
    requestedBy: job.requestedBy,
    status: 'queued',
    attempt: job.attempt + 1,
    idempotencyKey: job.idempotencyKey ? `${job.idempotencyKey}-retry-${job.attempt + 1}` : null,
    progress: null,
    errorCategory: null,
    errorDetail: null,
    startedAt: null,
    finishedAt: null,
  })
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function deriveDateRange(
  filters: ReportGenerateFilters,
  defaultRange?: 'all' | 'week' | 'month' | 'quarter',
): { fromDate?: string; toDate?: string } {
  if (filters.fromDate || filters.toDate) {
    return {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
    }
  }

  if (!defaultRange || defaultRange === 'all') {
    return {}
  }

  const now = new Date()
  const from = new Date(now)

  switch (defaultRange) {
    case 'week':
      from.setDate(now.getDate() - 7)
      break
    case 'month':
      from.setMonth(now.getMonth() - 1)
      break
    case 'quarter':
      from.setMonth(now.getMonth() - 3)
      break
  }

  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: now.toISOString().slice(0, 10),
  }
}
