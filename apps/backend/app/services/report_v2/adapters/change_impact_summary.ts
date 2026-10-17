/**
 * report_v2/adapters/change_impact_summary —— 变更影响分析统计数据源
 * （v2-change-management-impact-analysis §9.3-9.4）。
 *
 * 输出影响严重度分布、分析覆盖率、过期数、审批引用率和实施/关闭状态。
 * 仅聚合低敏统计，不输出单条影响项证据或规则正文。
 * 项目无变更请求时返回 empty，读取降级时附 warning。
 */
import ChangeImpactReportDataSource from '#services/change_impact/report_data_source'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeEmpty, makeWarning } from '../data_source_adapter.js'

export interface ChangeImpactSummaryData {
  /** 变更请求总数 */
  totalChangeRequests: number
  /** 已生成影响分析的变更请求数 */
  analyzedCount: number
  /** 分析覆盖率（百分比） */
  analysisCoverage: number
  /** 影响严重度分布（critical/high/medium/low/none） */
  severityDistribution: Record<string, number>
  /** 过期分析数 */
  staleCount: number
  /** 审批引用率（百分比） */
  approveReferenceRate: number
  /** 已实施/已关闭率（百分比） */
  implementedClosedRate: number
}

export class ChangeImpactSummaryAdapter implements DataSourceAdapter<ChangeImpactSummaryData> {
  readonly sourceKey = 'change_impact_summary'

  private dataSource = new ChangeImpactReportDataSource()

  async aggregate(
    organizationId: number,
    projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<ChangeImpactSummaryData>> {
    const stats = await this.dataSource.getStats(projectId, organizationId)

    const data: ChangeImpactSummaryData = {
      totalChangeRequests: stats.totalChangeRequests,
      analyzedCount: stats.analyzedCount,
      analysisCoverage: stats.analysisCoverage,
      severityDistribution: stats.severityDistribution,
      staleCount: stats.staleCount,
      approveReferenceRate: stats.approveReferenceRate,
      implementedClosedRate: stats.implementedClosedRate,
    }

    // 读取降级产生的 warning（如源数据读取失败）→ 部分聚合 warning
    const warnings = stats.warnings.map((message) =>
      makeWarning('REPORT_AGGREGATION_PARTIAL', 'warning', message),
    )

    // 空数据：项目暂无变更请求
    if (stats.totalChangeRequests === 0) {
      return makeEmpty(this.sourceKey, data, '项目暂无变更请求，变更影响统计为空')
    }

    return makeSuccess(this.sourceKey, data, warnings)
  }
}
