// v2-advanced-search — 搜索来源 Adapter 接口
//
// 每个实体来源必须实现此接口供 SearchService 编排。

import type { SearchEntityType, SearchResultItem, SearchQuery } from '@aiproj/types'

/**
 * Adapter 执行上下文（由 SearchService 注入）。
 */
export interface SearchContext {
  organizationId: number
  userId: number
  projectIds?: number[]
}

/**
 * Adapter 查询结果。
 */
export interface AdapterResult {
  items: SearchResultItem[]
  total: number
  /** 是否发生了降级（来源不可用或部分失败） */
  degraded?: boolean
  error?: string
}

/**
 * 搜索来源 Adapter 接口。
 *
 * 每个来源独立实现：
 * - 组织隔离（organization_id 过滤）
 * - 项目可见性检查
 * - 实体级权限校验
 * - 低敏摘要输出
 */
export abstract class SearchSourceAdapter {
  /**
   * 此 Adapter 支持的实体类型列表。
   */
  abstract get supportedEntityTypes(): SearchEntityType[]

  /**
   * 此 Adapter 支持的筛选字段列表。
   */
  abstract get supportedFilters(): string[]

  /**
   * 执行搜索。
   *
   * @param query 搜索查询（已通过 Validator 校验）
   * @param ctx 执行上下文（含组织/用户/项目信息）
   */
  abstract search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult>

  /**
   * 获取搜索建议（供命令面板使用）。
   *
   * @param q 关键词片段
   * @param limit 最大返回数
   * @param ctx 执行上下文
   */
  abstract suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult>

  /**
   * 该来源是否需要项目成员权限检查。
   */
  get requiresProjectMembership(): boolean {
    return true
  }

  /**
   * 该来源是否已具备完整组织隔离。
   */
  get hasOrgIsolation(): boolean {
    return true
  }
}
