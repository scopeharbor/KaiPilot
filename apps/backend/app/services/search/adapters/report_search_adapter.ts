// v2-advanced-search — Report Search Adapter
// 支持报表标题、模板、生成者、时间范围和低敏报告摘要

import Report from '#models/report'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem } from '#services/search/search_dto_mapper'

export default class ReportSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['report']
  }

  get supportedFilters(): string[] {
    return ['projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = Report.query()
      .join('projects', 'reports.project_id', 'projects.id')
      .where('projects.organization_id', ctx.organizationId)

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('reports.project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('reports.project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('reports.title', kw).orWhereILike('reports.report_type', kw)
      })
    }

    if (query.dateFrom) {
      q.where('reports.updated_at', '>=', query.dateFrom)
    }
    if (query.dateTo) {
      q.where('reports.updated_at', '<=', query.dateTo)
    }

    q.select('reports.*')
    q.orderBy('reports.updated_at', 'desc')
    q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const reports = await q

    const items: SearchResultItem[] = reports.map((r) => {
      const report = r as unknown as { title?: string; reportType?: string; report_type?: string }
      return makeSearchResultItem({
        entityType: 'report',
        entityId: r.id,
        projectId: Number(r.projectId),
        title: report.title ?? '',
        summary: null,
        matchedFields: query.keyword
          ? this.detectMatchedFields(
              report.title ?? '',
              report.reportType ?? report.report_type ?? '',
              query.keyword,
            )
          : [],
        updatedAt:
          (r as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null,
        source: 'report',
        metadata: { reportType: report.reportType ?? report.report_type ?? '' },
      })
    })

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const reports = await Report.query()
      .join('projects', 'reports.project_id', 'projects.id')
      .where('projects.organization_id', ctx.organizationId)
      .whereIn('reports.project_id', ctx.projectIds ?? [])
      .where((b) => b.whereILike('reports.title', kw))
      .orderBy('reports.updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = reports.map((r) => {
      const report = r as unknown as { title?: string }
      return makeSearchResultItem({
        entityType: 'report',
        entityId: r.id,
        projectId: Number(r.projectId),
        title: report.title ?? '',
        summary: null,
        matchedFields: ['title'],
        updatedAt:
          (r as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null,
        source: 'report',
      })
    })

    return { items, total: items.length }
  }

  private detectMatchedFields(title: string, reportType: string, keyword: string): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (title.toLowerCase().includes(lower)) fields.push('title')
    if (reportType.toLowerCase().includes(lower)) fields.push('report_type')
    return fields
  }
}
