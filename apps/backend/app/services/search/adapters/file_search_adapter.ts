// v2-advanced-search — File Search Adapter
// 搜索文件名、标签、安全文本摘要和关联实体摘要
// 禁止解析复杂二进制内容（PDF/Office/图片 → 只搜索元数据）

import FileSearchEntry from '#models/file_search_entry'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'

export default class FileSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['file']
  }

  get supportedFilters(): string[] {
    return ['projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = FileSearchEntry.query().where('organization_id', ctx.organizationId)

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('file_name', kw)
          .orWhereILike('tags_text', kw)
          .orWhereILike('content_snippet', kw)
          .orWhereILike('entity_refs', kw)
      })
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

    const entries = await q

    const items: SearchResultItem[] = entries.map((e) =>
      makeSearchResultItem({
        entityType: 'file',
        entityId: e.id,
        projectId: e.projectId,
        title: e.fileName,
        summary: toLowSensitivitySummary(e.contentSnippet, { maxLength: 150 }),
        matchedFields: query.keyword
          ? this.detectMatchedFields(
              e.fileName,
              e.tagsText,
              e.contentSnippet,
              e.entityRefs,
              query.keyword,
            )
          : [],
        updatedAt: e.updatedAt?.toISO() ?? null,
        source: 'file',
        metadata: { mimeType: e.mimeType, tags: e.tagsText },
      }),
    )

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const entries = await FileSearchEntry.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('project_id', ctx.projectIds ?? [])
      .where((b) => b.whereILike('file_name', kw))
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = entries.map((e) =>
      makeSearchResultItem({
        entityType: 'file',
        entityId: e.id,
        projectId: e.projectId,
        title: e.fileName,
        summary: null,
        matchedFields: ['file_name'],
        updatedAt: e.updatedAt?.toISO() ?? null,
        source: 'file',
      }),
    )

    return { items, total: items.length }
  }

  private detectMatchedFields(
    fileName: string,
    tagsText: string | null,
    contentSnippet: string | null,
    entityRefs: string | null,
    keyword: string,
  ): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (fileName.toLowerCase().includes(lower)) fields.push('file_name')
    if (tagsText?.toLowerCase().includes(lower)) fields.push('tags')
    if (contentSnippet?.toLowerCase().includes(lower)) fields.push('content')
    if (entityRefs?.toLowerCase().includes(lower)) fields.push('entity_refs')
    return fields
  }
}
