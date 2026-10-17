// v2-advanced-search — Change Request Search Adapter
// 支持变更标题、编号、状态、优先级和时间范围筛选

import ChangeRequest from '#models/change_request'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'

export default class ChangeRequestSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['change_request']
  }

  get supportedFilters(): string[] {
    return ['status', 'projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = ChangeRequest.query().where('organization_id', ctx.organizationId)

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('title', kw).orWhereILike('cr_number', kw).orWhereILike('description', kw)
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

    const crs = await q

    const items: SearchResultItem[] = crs.map((cr) => {
      const title = (cr as unknown as { title?: string }).title ?? ''
      const description = (cr as unknown as { description?: string | null }).description ?? null
      const status = (cr as unknown as { status?: string }).status ?? ''
      const priority = (cr as unknown as { priority?: string }).priority ?? ''
      const crNumber = (cr as unknown as { crNumber?: string | null }).crNumber ?? null
      const updatedAt =
        (cr as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null
      return makeSearchResultItem({
        entityType: 'change_request',
        entityId: cr.id,
        projectId: Number(cr.projectId),
        title,
        summary: toLowSensitivitySummary(description),
        matchedFields: query.keyword
          ? this.detectMatchedFields(title, description, crNumber, query.keyword)
          : [],
        status,
        updatedAt,
        source: 'change_request',
        metadata: { priority },
      })
    })

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const crs = await ChangeRequest.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('project_id', ctx.projectIds ?? [])
      .where((b) => b.whereILike('title', kw).orWhereILike('cr_number', kw))
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = crs.map((cr) => {
      const title = (cr as unknown as { title?: string }).title ?? ''
      const updatedAt =
        (cr as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null
      return makeSearchResultItem({
        entityType: 'change_request',
        entityId: cr.id,
        projectId: Number(cr.projectId),
        title,
        summary: null,
        matchedFields: ['title'],
        updatedAt,
        source: 'change_request',
      })
    })

    return { items, total: items.length }
  }

  private detectMatchedFields(
    title: string,
    description: string | null,
    crNumber: string | null,
    keyword: string,
  ): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (title.toLowerCase().includes(lower)) fields.push('title')
    if (crNumber?.toLowerCase().includes(lower)) fields.push('cr_number')
    if (description?.toLowerCase().includes(lower)) fields.push('description')
    return fields
  }
}
