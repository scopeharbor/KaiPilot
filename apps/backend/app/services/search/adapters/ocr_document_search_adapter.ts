/**
 * OCR Document Search Adapter（v3-ocr-document-search-indexing §6.2）。
 *
 * SQLite 兼容的 OCR 搜索索引 Adapter，搜索 active OCR search index entries
 * 的 searchable_text 字段，按组织/项目隔离。
 *
 * 不搜索 OCR candidates、raw provider output、expired/tombstoned entries。
 */
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'
import { buildSearchResultMetadata, generateSearchSnippet } from '@aiproj/types'

export default class OcrDocumentSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['file'] as SearchEntityType[]
  }

  get supportedFilters(): string[] {
    return ['projectIds']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    if (!query.keyword || query.keyword.trim().length === 0) {
      return { items: [], total: 0 }
    }

    let q = OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ctx.organizationId)
      .where('status', 'active')

    if (query.projectIds && query.projectIds.length > 0) {
      q = q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q = q.whereIn('project_id', ctx.projectIds)
    }

    const kw = `%${query.keyword}%`
    q = q.where((b) => {
      b.whereILike('searchable_text', kw).orWhereILike('searchable_snippet', kw)
    })

    q = q.orderBy('updated_at', 'desc')
    q = q.limit(query.perPage ?? 20)

    const entries = await q

    const items: SearchResultItem[] = entries.map((e) => {
      const snippet = e.searchableSnippet
        ? e.searchableSnippet
        : generateSearchSnippet(e.searchableText, query.keyword ?? '')

      return makeSearchResultItem({
        entityType: 'file',
        entityId: e.id,
        projectId: e.projectId,
        title: `OCR 识别文本 · ${e.sourceKind === 'document' ? '文档' : '附件'} #${e.sourceId ?? e.extractionId}`,
        summary: toLowSensitivitySummary(snippet, { maxLength: 150 }),
        matchedFields: query.keyword
          ? this.#detectMatchedFields(e.searchableText, e.searchableSnippet, query.keyword)
          : [],
        updatedAt: e.updatedAt?.toISO() ?? null,
        source: 'ocr_search_index',
        metadata: buildSearchResultMetadata({
          sourceKind: e.sourceKind,
          sourceId: e.sourceId,
          extractionId: e.extractionId,
          pageRefs: e.pageRefsJson,
          selectedTextHash: e.selectedTextHash,
          indexContentHash: e.indexContentHash,
          matchedFields: query.keyword
            ? this.#detectMatchedFields(e.searchableText, e.searchableSnippet, query.keyword)
            : [],
        }),
      })
    })

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', ctx.organizationId)
      .whereIn('project_id', ctx.projectIds ?? [])
      .where('status', 'active')
      .where((b) => {
        b.whereILike('searchable_text', kw).orWhereILike('searchable_snippet', kw)
      })
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = entries.map((e) =>
      makeSearchResultItem({
        entityType: 'file',
        entityId: e.id,
        projectId: e.projectId,
        title: `OCR 识别文本 · ${e.sourceKind === 'document' ? '文档' : '附件'} #${e.sourceId ?? e.extractionId}`,
        summary: null,
        matchedFields: ['searchable_text'],
        updatedAt: e.updatedAt?.toISO() ?? null,
        source: 'ocr_search_index',
        metadata: buildSearchResultMetadata({
          sourceKind: e.sourceKind,
          sourceId: e.sourceId,
          extractionId: e.extractionId,
          pageRefs: e.pageRefsJson,
          selectedTextHash: e.selectedTextHash,
          indexContentHash: e.indexContentHash,
          matchedFields: ['searchable_text'],
        }),
      }),
    )

    return { items, total: items.length }
  }

  #detectMatchedFields(searchableText: string, snippet: string | null, keyword: string): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (searchableText.toLowerCase().includes(lower)) fields.push('searchable_text')
    if (snippet?.toLowerCase().includes(lower)) fields.push('searchable_snippet')
    return fields
  }
}
