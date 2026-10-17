// v2-advanced-search — 高级搜索服务
//
// 负责：
// - 接收搜索请求，构建执行上下文
// - 分发到已注册的来源 Adapter
// - 合并、排序、分页结果
// - 来源降级处理（部分来源失败不影响整体）
// - 低敏结果输出

import { inject } from '@adonisjs/core'
import type {
  SearchQuery,
  SearchResultItem,
  SearchResultMeta,
  SearchEntityType,
  SearchSuggestion,
} from '@aiproj/types'
import {
  SEARCH_DEFAULT_PER_PAGE,
  SEARCH_MAX_PER_SOURCE,
  getEntityTypePriority,
} from '@aiproj/types'
import { SearchSourceAdapter, type SearchContext } from '#services/search/search_source_adapter'
import { mergeAndSortResults, paginateResults, assignScores } from '#services/search/search_scoring'
// 自动注册所有内置 Adapter
import ProjectSearchAdapter from '#services/search/adapters/project_search_adapter'
import TaskSearchAdapter from '#services/search/adapters/task_search_adapter'
import FileSearchAdapter from '#services/search/adapters/file_search_adapter'
import RiskSearchAdapter from '#services/search/adapters/risk_search_adapter'
import ChangeRequestSearchAdapter from '#services/search/adapters/change_request_search_adapter'
import ReportSearchAdapter from '#services/search/adapters/report_search_adapter'
import CommentSearchAdapter from '#services/search/adapters/comment_search_adapter'
import ActivitySearchAdapter from '#services/search/adapters/activity_search_adapter'
import MilestoneSearchAdapter from '#services/search/adapters/milestone_search_adapter'
import TaskExternalLinkSearchAdapter from '#services/search/adapters/task_external_link_search_adapter'
import OcrDocumentSearchAdapter from '#services/search/adapters/ocr_document_search_adapter'
import DocumentSearchAdapter from '#services/search/adapters/document_search_adapter'

/**
 * 搜索服务（v2-advanced-search）。
 */
@inject()
export default class SearchService {
  private adapters: Map<string, SearchSourceAdapter> = new Map()

  constructor() {
    // 自动注册所有内置 Adapter
    this.registerAdapter('project', new ProjectSearchAdapter())
    this.registerAdapter('task', new TaskSearchAdapter())
    this.registerAdapter('file', new FileSearchAdapter())
    this.registerAdapter('risk', new RiskSearchAdapter())
    this.registerAdapter('change_request', new ChangeRequestSearchAdapter())
    this.registerAdapter('report', new ReportSearchAdapter())
    this.registerAdapter('comment', new CommentSearchAdapter())
    this.registerAdapter('activity', new ActivitySearchAdapter())
    this.registerAdapter('milestone', new MilestoneSearchAdapter())
    this.registerAdapter('task_external_link', new TaskExternalLinkSearchAdapter())
    this.registerAdapter('ocr_search_index', new OcrDocumentSearchAdapter())
    this.registerAdapter('document', new DocumentSearchAdapter())
  }

  /**
   * 注册一个搜索来源 Adapter。
   */
  registerAdapter(name: string, adapter: SearchSourceAdapter): void {
    this.adapters.set(name, adapter)
  }

  /**
   * 获取所有已注册的 Adapter。
   */
  getAdapters(): Map<string, SearchSourceAdapter> {
    return this.adapters
  }

  /**
   * 执行高级搜索。
   */
  async search(
    query: SearchQuery,
    organizationId: number,
    userId: number,
    allowedProjectIds?: number[],
  ): Promise<{ data: SearchResultItem[]; meta: SearchResultMeta }> {
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? SEARCH_DEFAULT_PER_PAGE, SEARCH_MAX_PER_SOURCE)

    const ctx: SearchContext = {
      organizationId,
      userId,
      projectIds: query.projectIds ?? allowedProjectIds,
    }

    const entityTypes = this.resolveEntityTypes(query.entityTypes)
    const results = await this.dispatchToAdapters(query, ctx, entityTypes)
    const allItems = results.flat()
    const scored = query.keyword ? assignScores(allItems, query.keyword) : allItems
    const sorted = pinExactCodeHits(mergeAndSortResults(scored, query.sort), query.keyword)
    const { items, total, totalPages } = paginateResults(sorted, page, perPage)

    const meta: SearchResultMeta = {
      total,
      page,
      perPage,
      totalPages,
    }

    return { data: items, meta }
  }

  /**
   * 获取搜索建议（供命令面板使用）。
   */
  async suggest(
    q: string,
    limit: number,
    organizationId: number,
    userId: number,
    allowedProjectIds?: number[],
  ): Promise<SearchSuggestion[]> {
    const ctx: SearchContext = {
      organizationId,
      userId,
      projectIds: allowedProjectIds,
    }

    const maxLimit = Math.min(limit, 10)
    const suggestions: SearchSuggestion[] = []

    const promises: Promise<void>[] = []
    for (const [, adapter] of this.adapters) {
      promises.push(
        (async () => {
          try {
            const result = await adapter.suggest(q, maxLimit, ctx)
            for (const item of result.items) {
              suggestions.push({
                entityType: item.entityType,
                entityId: item.entityId,
                title: item.title,
                summary: item.summary,
                target: item.target,
                projectId: item.projectId,
              })
            }
          } catch {
            // 单个 Adapter 失败不影响其他建议
          }
        })(),
      )
    }

    await Promise.all(promises)
    suggestions.sort(
      (a, b) => getEntityTypePriority(a.entityType) - getEntityTypePriority(b.entityType),
    )
    return suggestions.slice(0, maxLimit)
  }

  /**
   * 解析要搜索的实体类型列表。
   */
  private resolveEntityTypes(
    requested?: SearchEntityType[],
  ): { name: string; adapter: SearchSourceAdapter; types: SearchEntityType[] }[] {
    const selected: { name: string; adapter: SearchSourceAdapter; types: SearchEntityType[] }[] = []

    for (const [name, adapter] of this.adapters) {
      const supported = adapter.supportedEntityTypes
      if (requested && requested.length > 0) {
        const intersection = supported.filter((t) => requested.includes(t))
        if (intersection.length > 0) {
          selected.push({ name, adapter, types: intersection })
        }
      } else {
        selected.push({ name, adapter, types: [...supported] })
      }
    }

    return selected
  }

  /**
   * 并行分发到各 Adapter。
   */
  private async dispatchToAdapters(
    query: SearchQuery,
    ctx: SearchContext,
    targets: { name: string; adapter: SearchSourceAdapter; types: SearchEntityType[] }[],
  ): Promise<SearchResultItem[]> {
    const promises = targets.map(async ({ adapter, types }) => {
      try {
        const scopedQuery: SearchQuery = {
          ...query,
          entityTypes: types,
          perPage: Math.min(query.perPage ?? SEARCH_MAX_PER_SOURCE, SEARCH_MAX_PER_SOURCE),
        }
        const result = await adapter.search(scopedQuery, ctx)
        return result.items || []
      } catch {
        return [] as SearchResultItem[]
      }
    })

    const nested = await Promise.all(promises)
    const allResults: SearchResultItem[] = []
    for (const items of nested) {
      allResults.push(...items)
    }
    return allResults
  }
}

/** 关键词正好是某个项目 / 任务编号时，把精确命中排到最前（编号搜索要一步到位）。 */
export function pinExactCodeHits(
  items: SearchResultItem[],
  keyword: string | undefined,
): SearchResultItem[] {
  const needle = keyword?.trim().toLowerCase()
  if (!needle) return items
  const isExact = (item: SearchResultItem) => {
    const code = item.metadata?.code
    if (typeof code !== 'string') return false
    const lower = code.toLowerCase()
    return lower === needle || (needle.startsWith('#') && lower.endsWith(needle))
  }
  return [...items.filter(isExact), ...items.filter((item) => !isExact(item))]
}
