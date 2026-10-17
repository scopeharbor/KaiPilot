/**
 * report_v2/adapters/risk_summary —— 风险摘要数据源。
 *
 * 输出风险矩阵、等级分布与缓解状态。
 * 风险完整能力未实现时返回 unavailable warning。
 */
import Risk from '#models/risk'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeUnavailable } from '../data_source_adapter.js'

export interface RiskSummaryData {
  totalRisks: number
  criticalRisks: number
  highRisks: number
  mediumRisks: number
  lowRisks: number
  openRisks: number
  mitigatedRisks: number
}

export class RiskSummaryAdapter implements DataSourceAdapter<RiskSummaryData> {
  readonly sourceKey = 'risk_summary'

  async aggregate(
    _organizationId: number,
    projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<RiskSummaryData>> {
    const totalCount = await Risk.query()
      .where('project_id', projectId)
      .count('id as count')
      .first()

    const total = Number(totalCount?.$extras.count ?? 0)

    if (total === 0) {
      return makeUnavailable(this.sourceKey, '风险模块未启用或无风险记录，风险摘要不可用')
    }

    const critical = await Risk.query()
      .where('project_id', projectId)
      .where('severity', 'critical')
      .count('id as count')
      .first()
    const high = await Risk.query()
      .where('project_id', projectId)
      .where('severity', 'high')
      .count('id as count')
      .first()
    const medium = await Risk.query()
      .where('project_id', projectId)
      .where('severity', 'medium')
      .count('id as count')
      .first()
    const low = await Risk.query()
      .where('project_id', projectId)
      .where('severity', 'low')
      .count('id as count')
      .first()

    const mitigated = await Risk.query()
      .where('project_id', projectId)
      .where('status', 'mitigated')
      .count('id as count')
      .first()

    const data: RiskSummaryData = {
      totalRisks: total,
      criticalRisks: Number(critical?.$extras.count ?? 0),
      highRisks: Number(high?.$extras.count ?? 0),
      mediumRisks: Number(medium?.$extras.count ?? 0),
      lowRisks: Number(low?.$extras.count ?? 0),
      openRisks: total - Number(mitigated?.$extras.count ?? 0),
      mitigatedRisks: Number(mitigated?.$extras.count ?? 0),
    }

    return makeSuccess(this.sourceKey, data)
  }
}
