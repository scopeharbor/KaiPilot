// v2-advanced-search — Risk Search Adapter
// 支持风险标题、描述、状态、严重度和项目范围筛选

import Risk from '#models/risk'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'

export default class RiskSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['risk']
  }

  get supportedFilters(): string[] {
    return ['status', 'projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = Risk.query().where('organization_id', ctx.organizationId)

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('title', kw).orWhereILike('description', kw).orWhereILike('risk_code', kw)
      })
    }

    if (query.status && query.status.length > 0) {
      q.whereIn('status', query.status)
    }

    if (query.dateFrom) {
      q.where('updated_at', '>=', query.dateFrom)
    }
    if (query.dateTo) {
      q.where('updated_at', '<=', query.dateTo)
    }

    q.orderBy('updated_at', 'desc')
    q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const risks = await q

    const items: SearchResultItem[] = risks.map((r) =>
      makeSearchResultItem({
        entityType: 'risk',
        entityId: r.id,
        projectId: r.projectId,
        title: r.title,
        summary: toLowSensitivitySummary(r.description),
        matchedFields: query.keyword
          ? this.detectMatchedFields(r.title, r.description, r.riskCode, query.keyword)
          : [],
        status: r.status,
        updatedAt:
          (r as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null,
        source: 'risk',
        metadata: { severity: r.riskLevel, score: r.score },
      }),
    )

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const risks = await Risk.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('project_id', ctx.projectIds ?? [])
      .where((b) => b.whereILike('title', kw))
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = risks.map((r) =>
      makeSearchResultItem({
        entityType: 'risk',
        entityId: r.id,
        projectId: r.projectId,
        title: r.title,
        summary: null,
        matchedFields: ['title'],
        updatedAt:
          (r as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null,
        source: 'risk',
      }),
    )

    return { items, total: items.length }
  }

  private detectMatchedFields(
    title: string,
    description: string | null,
    riskCode: string | null,
    keyword: string,
  ): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (title.toLowerCase().includes(lower)) fields.push('title')
    if (description?.toLowerCase().includes(lower)) fields.push('description')
    if (riskCode?.toLowerCase().includes(lower)) fields.push('risk_code')
    return fields
  }
}
