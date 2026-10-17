/**
 * report_v2/adapters/resource_summary —— 资源摘要数据源。
 *
 * 输出资源分配和负载概览。资源完整能力未实现时返回 unavailable warning。
 */
import Resource from '#models/resource'
import ResourceAllocation from '#models/resource_allocation'
import type { ReportGenerateFilters, ReportDataSourceResult } from '@aiproj/types'
import type { DataSourceAdapter } from '../data_source_adapter.js'
import { makeSuccess, makeUnavailable } from '../data_source_adapter.js'

export interface ResourceSummaryData {
  totalResources: number
  allocatedResources: number
  availableResources: number
  overallUtilizationPercent: number
}

export class ResourceSummaryAdapter implements DataSourceAdapter<ResourceSummaryData> {
  readonly sourceKey = 'resource_summary'

  async aggregate(
    _organizationId: number,
    projectId: number,
    _userId: number,
    _filters: ReportGenerateFilters,
  ): Promise<ReportDataSourceResult<ResourceSummaryData>> {
    // 探测资源模块可用性
    const resourceCount = (await Resource.query()
      .where('project_id', projectId)
      .count('id as count')
      .first()) ?? { $extras: { count: 0 } }

    const totalCount = Number(resourceCount.$extras?.count ?? 0)

    if (totalCount === 0) {
      return makeUnavailable(this.sourceKey, '资源模块未启用或无资源记录，资源摘要不可用')
    }

    const allocationCount = await ResourceAllocation.query()
      .where('project_id', projectId)
      .count('id as count')
      .first()

    const allocatedCount = Number(allocationCount?.$extras.count ?? 0)

    const data: ResourceSummaryData = {
      totalResources: totalCount,
      allocatedResources: allocatedCount,
      availableResources: totalCount - allocatedCount,
      overallUtilizationPercent:
        totalCount > 0 ? Math.round((allocatedCount / totalCount) * 10000) / 100 : 0,
    }

    return makeSuccess(this.sourceKey, data)
  }
}
