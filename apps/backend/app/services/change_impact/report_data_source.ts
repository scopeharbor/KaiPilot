import ChangeImpactAnalysis from '#models/change_impact_analysis'
import ChangeRequest from '#models/change_request'
import { inject } from '@adonisjs/core'

/**
 * 变更影响分析报表数据源（v2-change-management-impact-analysis §9.3-9.4）。
 * 为预设报表/V2 报表读取变更影响统计，权限过滤，低敏摘要。
 */
@inject()
export default class ChangeImpactReportDataSource {
  /**
   * 获取项目的变更影响分析统计数据。
   */
  async getStats(
    projectId: number,
    organizationId: number,
  ): Promise<{
    totalChangeRequests: number
    analyzedCount: number
    analysisCoverage: number
    severityDistribution: Record<string, number>
    staleCount: number
    approveReferenceRate: number
    implementedClosedRate: number
    warnings: string[]
  }> {
    const warnings: string[] = []

    // 统计变更请求
    let totalChangeRequests = 0
    let analyzedCount = 0
    let implementedClosedCount = 0
    try {
      const crs = await ChangeRequest.query()
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereNull('deleted_at')
        .select('id', 'status', 'current_impact_analysis_id', 'approve_ref_analysis_id')

      totalChangeRequests = crs.length
      analyzedCount = crs.filter((cr) => cr.currentImpactAnalysisId).length
      implementedClosedCount = crs.filter(
        (cr) => cr.status === 'implemented' || cr.status === 'closed',
      ).length
    } catch {
      warnings.push('变更请求数据读取失败')
    }

    // 分析覆盖率
    const analysisCoverage =
      totalChangeRequests > 0 ? Math.round((analyzedCount / totalChangeRequests) * 100) : 0

    // 严重度分布
    const severityDistribution: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    }
    let staleCount = 0
    let approveRefCount = 0

    try {
      const analyses = await ChangeImpactAnalysis.query()
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .select('id', 'status', 'summary')

      for (const a of analyses) {
        if (a.status === 'stale') staleCount++
        const summary = a.summary
        if (summary?.severityDistribution) {
          const dist = summary.severityDistribution as Record<string, number>
          for (const key of Object.keys(dist)) {
            if (key in severityDistribution) {
              severityDistribution[key] = (severityDistribution[key] ?? 0) + (dist[key] ?? 0)
            }
          }
        }
      }
    } catch {
      warnings.push('影响分析数据读取失败')
    }

    // 审批引用率
    try {
      const refCount = await ChangeRequest.query()
        .where('project_id', projectId)
        .where('organization_id', organizationId)
        .whereNotNull('approve_ref_analysis_id')
        .count('* as total')
      approveRefCount = Number(
        (refCount[0] as any)?.$extras?.total ?? (refCount[0] as any)?.total ?? 0,
      )
    } catch {
      // ignore
    }
    const approveReferenceRate =
      totalChangeRequests > 0 ? Math.round((approveRefCount / totalChangeRequests) * 100) : 0
    const implementedClosedRate =
      totalChangeRequests > 0 ? Math.round((implementedClosedCount / totalChangeRequests) * 100) : 0

    return {
      totalChangeRequests,
      analyzedCount,
      analysisCoverage,
      severityDistribution,
      staleCount,
      approveReferenceRate,
      implementedClosedRate,
      warnings,
    }
  }
}
