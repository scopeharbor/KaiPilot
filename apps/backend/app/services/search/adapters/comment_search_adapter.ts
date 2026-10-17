// v2-advanced-search — Comment Search Adapter
// 支持评论摘要搜索、目标实体跳转；已删除/无权评论自动隐藏

import Comment from '#models/comment'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'

export default class CommentSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['comment']
  }

  get supportedFilters(): string[] {
    return ['projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = Comment.query().where('organization_id', ctx.organizationId).whereNull('deleted_at') // 不返回已删除评论

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.whereILike('body', kw)
    }

    if (query.dateFrom) {
      q.where('created_at', '>=', query.dateFrom)
    }
    if (query.dateTo) {
      q.where('created_at', '<=', query.dateTo)
    }

    q.orderBy('created_at', 'desc')
    q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const comments = await q

    const items: SearchResultItem[] = comments.map((c) => {
      const bodyStr = String((c as unknown as Record<string, unknown>).body ?? '')
      return makeSearchResultItem({
        entityType: 'comment',
        entityId: c.id,
        projectId: c.projectId,
        title: `评论 #${c.id}`,
        summary: toLowSensitivitySummary(bodyStr, { maxLength: 150 }),
        matchedFields: query.keyword ? ['body'] : [],
        updatedAt:
          (c as unknown as { updatedAt?: { toISO?: () => string } }).updatedAt?.toISO?.() ?? null,
        source: 'comment',
        metadata: {
          entityType: (c as unknown as Record<string, unknown>).entityType,
          entityId: (c as unknown as Record<string, unknown>).entityId,
        },
      })
    })

    return { items, total: items.length }
  }

  async suggest(_q: string, _limit: number, _ctx: SearchContext): Promise<AdapterResult> {
    // 评论不支持快速建议（搜索成本高且隐私敏感）
    return { items: [], total: 0 }
  }
}
