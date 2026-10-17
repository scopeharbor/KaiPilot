// v2-advanced-search — 搜索 API 控制器
// - POST  /api/v1/search              高级搜索
// - GET   /api/v1/search/suggestions   搜索建议

import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type {
  SearchEntityType,
  SearchSortField,
  SearchSortDirection,
  SearchScope,
} from '@aiproj/types'
import { computeKeywordHash } from '@aiproj/types'
import SearchService from '#services/search_service'
import SearchPolicy from '#policies/search_policy'
import AuditService from '#services/audit_service'
import { AuditEvent } from '#services/audit_service'
import { searchValidator, suggestionsValidator, SEARCH_MAX_PER_PAGE } from '#validators/search'

@inject()
export default class SearchController {
  constructor(
    private searchService: SearchService,
    private policy: SearchPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * POST /api/v1/search
   * 高级搜索：统一跨实体搜索入口。
   */
  async search(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const body = ctx.request.body()

    // 校验请求
    const filters = await ctx.request.validateUsing(searchValidator, { data: body })

    // 授权
    await this.policy.authorize(user, organizationId)

    // 获取用户有权限的项目
    const allowedProjectIds = await this.policy.getAllowedProjectIds(user, organizationId)

    // 执行搜索
    const result = await this.searchService.search(
      {
        keyword: filters.keyword,
        entityTypes: (filters.entityTypes ?? undefined) as SearchEntityType[] | undefined,
        projectIds: filters.projectIds,
        status: filters.status,
        assigneeIds: filters.assigneeIds,
        tagIds: filters.tagIds,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        scope: (filters.scope ?? undefined) as SearchScope | undefined,
        sort: filters.sort as
          { field: SearchSortField; direction: SearchSortDirection }[] | undefined,
        page: filters.page ?? 1,
        perPage: Math.min(filters.perPage ?? 20, SEARCH_MAX_PER_PAGE),
      },
      organizationId,
      user.id,
      allowedProjectIds,
    )

    // 低敏审计
    await this.audit.log({
      event: AuditEvent.SEARCH_EXECUTED,
      userId: user.id,
      organizationId,
      severity: 'info',
      metadata: {
        hasKeyword: Boolean(filters.keyword),
        entityTypes: filters.entityTypes?.join(',') ?? 'all',
        resultCount: result.meta.total,
        resultCountRange: this.resultCountRange(result.meta.total),
      },
    })

    // 文档搜索额外低敏审计（v3-document-full-text-search §9.2）
    const entityTypes = filters.entityTypes ?? []
    if (entityTypes.length === 0 || entityTypes.includes('document' as SearchEntityType)) {
      const keywordHash = filters.keyword ? computeKeywordHash(filters.keyword) : null
      await this.audit.log({
        event: AuditEvent.DOCUMENT_SEARCH_QUERIED,
        userId: user.id,
        organizationId,
        severity: 'info',
        metadata: {
          keywordHash,
          keywordPrefix: filters.keyword ? filters.keyword.substring(0, 4) : null,
          resultCount: result.meta.total,
          resultCountRange: this.resultCountRange(result.meta.total),
        },
      })
    }

    return ctx.response.ok(result)
  }

  /**
   * GET /api/v1/search/suggestions
   * 搜索建议（供命令面板使用）。
   */
  async suggestions(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId
    const raw = ctx.request.qs()
    const params = await ctx.request.validateUsing(suggestionsValidator, { data: raw })

    // 授权
    await this.policy.authorize(user, organizationId)

    // 获取用户有权限的项目
    const allowedProjectIds = await this.policy.getAllowedProjectIds(user, organizationId)

    // 获取建议
    const suggestions = await this.searchService.suggest(
      params.q,
      params.limit ?? 5,
      organizationId,
      user.id,
      allowedProjectIds,
    )

    return ctx.response.ok({ data: suggestions })
  }

  /**
   * 将结果数量映射到区间，避免精确计数泄露。
   */
  private resultCountRange(count: number): string {
    if (count === 0) return '0'
    if (count <= 5) return '1-5'
    if (count <= 20) return '6-20'
    if (count <= 50) return '21-50'
    if (count <= 100) return '51-100'
    return '100+'
  }
}
