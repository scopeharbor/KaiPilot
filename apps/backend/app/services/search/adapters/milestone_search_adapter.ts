// v2-advanced-search — Milestone Search Adapter
// 支持里程碑名称、描述、状态、计划日期和项目范围筛选

import Milestone from '#models/milestone'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem } from '#services/search/search_dto_mapper'

export default class MilestoneSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['milestone']
  }

  get supportedFilters(): string[] {
    return ['status', 'projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = Milestone.query()

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('name', kw).orWhereILike('description', kw)
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

    const milestones = await q

    const items: SearchResultItem[] = milestones.map((m) =>
      makeSearchResultItem({
        entityType: 'milestone',
        entityId: m.id,
        projectId: Number(m.projectId),
        title: m.name,
        summary: m.description,
        matchedFields: query.keyword
          ? this.detectMatchedFields(m.name, m.description, query.keyword)
          : [],
        status: m.status,
        updatedAt: m.updatedAt?.toISO() ?? null,
        source: 'milestone',
      }),
    )

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const milestones = await Milestone.query()
      .whereIn('project_id', ctx.projectIds ?? [])
      .where((b) => b.whereILike('name', kw))
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = milestones.map((m) =>
      makeSearchResultItem({
        entityType: 'milestone',
        entityId: m.id,
        projectId: Number(m.projectId),
        title: m.name,
        summary: null,
        matchedFields: ['name'],
        updatedAt: m.updatedAt?.toISO() ?? null,
        source: 'milestone',
      }),
    )

    return { items, total: items.length }
  }

  private detectMatchedFields(name: string, description: string | null, keyword: string): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (name.toLowerCase().includes(lower)) fields.push('name')
    if (description?.toLowerCase().includes(lower)) fields.push('description')
    return fields
  }
}
