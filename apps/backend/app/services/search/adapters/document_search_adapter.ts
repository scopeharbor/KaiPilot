/**
 * DocumentSearchAdapter（v3-document-full-text-search §6）
 *
 * 搜索 document_search_entries 索引表——只搜索已索引的活跃文档。
 *
 * org/project/lifecycle 硬隔离；keyword 走 SQLite LIKE 子串匹配；
 * 不返回正文全文。
 */
import DocumentSearchEntry from '#models/document_search_entry'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'
import { extractSnippet } from '@aiproj/types'

export default class DocumentSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['document'] as SearchEntityType[]
  }

  get supportedFilters(): string[] {
    return ['projectIds', 'dateFrom', 'dateTo']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    // 空关键词：返回全部可索引文档（结构化筛选场景）
    let q = DocumentSearchEntry.query()
      .where('organization_id', ctx.organizationId)
      .where('lifecycle', 'active')
      .whereNull('deleted_at')

    if (query.projectIds && query.projectIds.length > 0) {
      q = q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q = q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword && query.keyword.trim().length > 0) {
      const kw = `%${query.keyword.toLowerCase()}%`
      q = q.where((b) => {
        b.whereRaw('LOWER(title) LIKE ?', [kw]).orWhereRaw('LOWER(content_text) LIKE ?', [kw])
      })
    }

    if (query.dateFrom) {
      q = q.where('updated_at', '>=', query.dateFrom)
    }
    if (query.dateTo) {
      q = q.where('updated_at', '<=', query.dateTo)
    }

    // 标题命中优先，其次更新时间降序
    q = q.orderBy('updated_at', 'desc')
    q = q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q = q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const entries = await q

    const keyword = query.keyword?.trim() ?? ''

    const items: SearchResultItem[] = entries.map((e) => {
      const snippet = keyword
        ? extractSnippet(e.contentText ?? '', keyword)
        : (e.contentText ?? '').substring(0, 120)
      return makeSearchResultItem({
        entityType: 'document',
        // 生成的 schema 把 bigInteger 列推断为 `number | bigint`；契约要求 number，
        // 显式收敛（SQLite/Postgres 大 id 下 bigint 会流到前端 JSON 里变成不可比较的值）。
        entityId: Number(e.documentId),
        projectId: Number(e.projectId),
        title: e.title,
        summary: toLowSensitivitySummary(snippet, { maxLength: 150 }),
        matchedFields: keyword ? this.#detectMatchedFields(e.title, e.contentText, keyword) : [],
        updatedAt: e.updatedAt?.toISO() ?? null,
        source: 'document',
        metadata: {
          documentType: 'document',
          truncated: e.truncated,
          contentLength: e.contentLength,
        },
      })
    })

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q.toLowerCase()}%`
    const entries = await DocumentSearchEntry.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('project_id', ctx.projectIds ?? [])
      .where('lifecycle', 'active')
      .whereNull('deleted_at')
      .where((b) => b.whereRaw('LOWER(title) LIKE ?', [kw]))
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = entries.map((e) =>
      makeSearchResultItem({
        entityType: 'document',
        entityId: Number(e.documentId),
        projectId: Number(e.projectId),
        title: e.title,
        summary: null,
        matchedFields: ['title'],
        updatedAt: e.updatedAt?.toISO() ?? null,
        source: 'document',
      }),
    )

    return { items, total: items.length }
  }

  #detectMatchedFields(title: string, contentText: string | null, keyword: string): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (title.toLowerCase().includes(lower)) fields.push('title')
    if (contentText?.toLowerCase().includes(lower)) fields.push('content')
    return fields
  }
}
