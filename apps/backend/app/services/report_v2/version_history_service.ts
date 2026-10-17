/**
 * report_v2/version_history_service —— 报表版本历史服务。
 *
 * 扩展版本历史响应，包含周期类型、周期范围、审核状态、warnings 摘要、
 * 模型摘要和成本摘要。
 */
import ReportVersion from '#models/report_version'
import type { ReportWarningV2, V2ReportExportFormat, V2ReportTemplateId } from '@aiproj/types'
import { TEMPLATE_MAP } from './templates.js'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface VersionHistoryItem {
  id: number
  templateId: V2ReportTemplateId
  templateVersion: string
  title: string
  dateRange: { fromDate?: string; toDate?: string } | null
  // 周期报表字段
  periodType?: 'weekly' | 'monthly' | null
  periodRange?: { fromDate: string; toDate: string } | null
  prevPeriodRange?: { fromDate: string; toDate: string } | null
  // AI 审核状态
  aiReviewStatus?: string | null
  warningsSummary: ReportWarningV2[]
  costSummary: Record<string, unknown> | null
  modelSummary: Record<string, unknown> | null
  // 审计
  snapshotHash: string
  generatedBy: number | null
  generatedAt: string
  confirmedAt: string | null
  confirmedBy: number | null
  returnedAt: string | null
  returnedBy: number | null
  // 导出格式
  availableFormats: V2ReportExportFormat[]
  createdAt: string
  updatedAt: string | null
}

export interface VersionHistoryFilters {
  templateId?: string
  page?: number
  perPage?: number
  sort?: string
}

export interface VersionHistoryResult {
  data: VersionHistoryItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

/**
 * 获取报表版本历史列表。
 * 包含周期报表和 AI 相关字段。
 */
export async function getVersionHistory(
  organizationId: number,
  projectId: number,
  filters: VersionHistoryFilters,
): Promise<VersionHistoryResult> {
  const page = filters.page ?? 1
  const perPage = filters.perPage ?? 20
  const sort = filters.sort ?? '-createdAt'

  const query = ReportVersion.query()
    .where('organization_id', organizationId)
    .where('project_id', projectId)

  if (filters.templateId) {
    query.where('template_id', filters.templateId)
  }

  // 排序
  const sortDir = sort.startsWith('-') ? 'desc' : 'asc'
  const sortCol = sort.replace(/^[-+]/, '')
  query.orderBy(sortCol, sortDir)

  const pageResult = await query.paginate(page, perPage)

  const data: VersionHistoryItem[] = pageResult.all().map((rv) => {
    const template = TEMPLATE_MAP.get(rv.templateId)
    const periodType = rv.periodType as 'weekly' | 'monthly' | null | undefined

    // costSummary 和 modelSummary 仅在 AI 草稿版本才返回
    const hasAiDraft = !!rv.aiDraft
    const costSummary = hasAiDraft ? (rv.costSummary as Record<string, unknown> | null) : null
    const modelSummary = hasAiDraft ? (rv.modelSummary as Record<string, unknown> | null) : null

    return {
      id: rv.id,
      templateId: rv.templateId,
      templateVersion: rv.templateVersion,
      title: rv.title,
      dateRange: rv.dateRange as { fromDate?: string; toDate?: string } | null,
      periodType,
      periodRange: rv.dateRange as { fromDate: string; toDate: string } | null,
      prevPeriodRange: rv.prevDateRange as { fromDate: string; toDate: string } | null,
      aiReviewStatus: rv.aiReviewStatus,
      warningsSummary: rv.warnings as ReportWarningV2[],
      costSummary,
      modelSummary,
      snapshotHash: rv.snapshotHash,
      generatedBy: rv.generatedBy,
      generatedAt: rv.generatedAt.toISO?.() ?? String(rv.generatedAt),
      confirmedAt: rv.confirmedAt?.toISO?.() ?? null,
      confirmedBy: rv.confirmedBy,
      returnedAt: rv.returnedAt?.toISO?.() ?? null,
      returnedBy: rv.returnedBy,
      availableFormats: (template?.supportedFormats ?? ['markdown']) as V2ReportExportFormat[],
      createdAt: rv.createdAt.toISO?.() ?? String(rv.createdAt),
      updatedAt: rv.updatedAt?.toISO?.() ?? null,
    }
  })

  return {
    data,
    meta: {
      total: pageResult.total,
      page: pageResult.currentPage,
      perPage: pageResult.perPage,
      totalPages: pageResult.lastPage,
    },
  }
}
