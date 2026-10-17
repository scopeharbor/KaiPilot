/**
 * v3-four-layer-knowledge-system —— SqliteKnowledgeIndex（D5 降级实现）。
 *
 * 本机 SQLite 结构化过滤降级——无外部向量库时核心流程不中断。
 * 语义相关性在降级态不可用（仅结构化过滤 + 关键词 LIKE），
 * 但组织隔离、L3 排除、结构化过滤 MUST 保持正确。
 *
 * @aiproj/backend
 */
import type { KnowledgeIndex, SearchResult } from './knowledge_index.js'
import type { KnowledgeQuery, KnowledgeItemLowSensitiveProjection } from '@aiproj/types'
import KnowledgeItem from '#models/knowledge_item'

export default class SqliteKnowledgeIndex implements KnowledgeIndex {
  /**
   * 结构化过滤检索——SQLite WHERE 组合过滤 + 组织隔离 + L3 排除。
   */
  async search(organizationId: number, query: KnowledgeQuery): Promise<SearchResult> {
    const page = query.page ?? 1
    const perPage = query.perPage ?? 20

    let q = KnowledgeItem.forOrganization(organizationId)

    // ── 结构化过滤 ──
    if (query.layer) {
      q = q.where('layer', query.layer)
    }
    if (query.domain) {
      q = q.where('domain', query.domain)
    }
    if (query.purpose) {
      q = q.where('purpose', query.purpose)
    }
    if (query.complexity) {
      q = q.where('complexity', query.complexity)
    }

    // ── L3 合成隔离红线（存储层强约束，D2）──
    // 默认排除 L3；只有 evalContext=true 才放行
    if (!query.evalContext) {
      q = q.whereNot('layer', 'L3')
    }

    // ── 关键词模糊匹配（降级态：LIKE 回退）──
    if (query.keyword && query.keyword.trim() !== '') {
      const kw = `%${query.keyword.trim()}%`
      q = q.where((builder) => {
        builder.where('title', 'like', kw).orWhere('content', 'like', kw)
      })
    }

    // ── 状态过滤（契约：status 参数，默认 active）──
    // 未指定时维持默认行为只返回 active；显式传值（如治理视图查待审/草稿）按状态过滤。
    q = q.where('status', query.status ?? 'active')

    // ── 分页 ──
    const totalQuery = q.clone()
    const totalCount = await totalQuery.count('* as total')
    const total = Number(totalCount[0].$extras.total)

    const results = await q
      .orderBy('updated_at', 'desc')
      .offset((page - 1) * perPage)
      .limit(perPage)

    const data: KnowledgeItemLowSensitiveProjection[] = results.map((item) => ({
      id: item.id,
      layer: item.layer,
      title: item.title,
      status: item.status,
      domain: item.domain,
      purpose: item.purpose,
      complexity: item.complexity ?? undefined,
      provenance: item.provenance,
      isSynthetic: Boolean(item.isSynthetic),
      createdAt: item.createdAt.toISO()!,
      updatedAt: item.updatedAt.toISO()!,
    }))

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  /**
   * 降级实现——no-op。SQLite 结构化过滤不依赖外部索引。
   */
  async upsert(_item: KnowledgeItemLowSensitiveProjection): Promise<void> {
    // no-op：降级实现不建向量索引
  }
}
