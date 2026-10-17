// v2-advanced-search — Project Search Adapter
// 复用项目可见性规则，搜索名称、编码、状态和更新时间

import Project from '#models/project'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { formatProjectCode, projectIdFromFallbackCode } from '@aiproj/types'
import { makeSearchResultItem } from '#services/search/search_dto_mapper'

export default class ProjectSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['project']
  }

  get supportedFilters(): string[] {
    return ['status', 'dateFrom', 'dateTo']
  }

  get requiresProjectMembership(): boolean {
    return false
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = Project.query().where('organization_id', ctx.organizationId).whereNull('deleted_at')

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      // 没设置 code 的项目以 `PROJ-{ID}` 作编号（见 formatProjectCode）
      const fallbackId = projectIdFromFallbackCode(query.keyword.trim())
      q.where((b) => {
        b.whereILike('name', kw).orWhereILike('code', kw).orWhereILike('description', kw)
        if (fallbackId !== null) b.orWhere((c) => c.where('id', fallbackId).whereNull('code'))
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

    q.whereExists((b) => {
      b.from('project_members')
        .whereRaw('project_members.project_id = projects.id')
        .where('project_members.user_id', ctx.userId)
    })

    q.orderBy('updated_at', 'desc')
    q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const projects = await q

    const items: SearchResultItem[] = projects.map((p) =>
      makeSearchResultItem({
        entityType: 'project',
        entityId: p.id,
        title: p.name,
        summary: p.description,
        matchedFields: query.keyword
          ? this.detectMatchedFields(p.name, p.code, p.description, query.keyword)
          : [],
        status: p.status,
        updatedAt: p.updatedAt?.toISO() ?? null,
        source: 'project',
        metadata: { code: formatProjectCode(p) },
      }),
    )

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const projects = await Project.query()
      .where('organization_id', ctx.organizationId)
      .whereNull('deleted_at')
      .where((b) => {
        b.whereILike('name', kw).orWhereILike('code', kw)
      })
      .whereExists((b) => {
        b.from('project_members')
          .whereRaw('project_members.project_id = projects.id')
          .where('project_members.user_id', ctx.userId)
      })
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = projects.map((p) =>
      makeSearchResultItem({
        entityType: 'project',
        entityId: p.id,
        title: p.name,
        summary: null,
        matchedFields: ['name'],
        updatedAt: p.updatedAt?.toISO() ?? null,
        source: 'project',
      }),
    )

    return { items, total: items.length }
  }

  private detectMatchedFields(
    name: string,
    code: string | null,
    description: string | null,
    keyword: string,
  ): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (name.toLowerCase().includes(lower)) fields.push('name')
    if (code?.toLowerCase().includes(lower)) fields.push('code')
    if (description?.toLowerCase().includes(lower)) fields.push('description')
    return fields
  }
}
