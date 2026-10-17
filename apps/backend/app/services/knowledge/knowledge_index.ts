/**
 * v3-four-layer-knowledge-system —— KnowledgeIndex 抽象接口（D5）。
 *
 * 定义知识检索的抽象接口，生产可插外部向量库，缺省用本机 SQLite 结构化过滤降级。
 * 语义相关性在降级态可下降，但结构化过滤、组织隔离、L3 排除不可降级。
 *
 * @aiproj/backend
 */
import type { KnowledgeQuery, KnowledgeItemLowSensitiveProjection } from '@aiproj/types'

/** 搜索结果。 */
export interface SearchResult {
  data: KnowledgeItemLowSensitiveProjection[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/**
 * 知识检索抽象接口。
 * 实现方必须保证：结构化过滤正确、组织隔离强制、L3 在非 evalContext 时排除。
 */
export interface KnowledgeIndex {
  /**
   * 检索知识——结构化过滤 + 可选语义匹配 + 组织隔离 + L3 排除。
   * 当 evalContext=true 时放行 L3；否则严格排除 L3。
   */
  search(organizationId: number, query: KnowledgeQuery): Promise<SearchResult>

  /**
   * 索引/更新一条知识记录（当外部向量库可用时）。
   * 降级实现可为 no-op——结构化过滤不依赖索引。
   */
  upsert(item: KnowledgeItemLowSensitiveProjection): Promise<void>
}
