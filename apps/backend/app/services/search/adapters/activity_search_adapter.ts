// v2-advanced-search — Activity/Audit Search Adapter
// 仅向具备对应权限的用户返回低敏活动或审计摘要

import AuditLog from '#models/audit_log'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem } from '#services/search/search_dto_mapper'

export default class ActivitySearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['activity']
  }

  get supportedFilters(): string[] {
    return ['projectIds', 'dateFrom', 'dateTo', 'status']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    // 活动/审计仅在有 audit:view 权限时可用
    // 此处由 SearchService 调用前通过 Policy 鉴权

    const q = AuditLog.query().where('organization_id', ctx.organizationId)

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    } else if (ctx.projectIds && ctx.projectIds.length > 0) {
      q.whereIn('project_id', ctx.projectIds)
    }

    if (query.keyword) {
      const rawKeyword = query.keyword.trim()
      const kw = `%${rawKeyword}%`
      q.where((b) => {
        b.whereILike('action', kw).orWhereILike('entity_type', kw)
        // 仅纯数字关键词才参与 entity_id 匹配；此前非数字关键词被
        // Number(kw) || 0 映射成 0，导致乱搜也命中 entity_id=0 的记录
        if (/^\d+$/.test(rawKeyword)) {
          b.orWhere('entity_id', String(Number(rawKeyword)))
        }
      })
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

    const logs = await q

    const items: SearchResultItem[] = logs.map((log) => {
      // 只返回低敏摘要
      return makeSearchResultItem({
        entityType: 'activity',
        entityId: log.id,
        projectId: log.projectId === null ? undefined : Number(log.projectId),
        title: `操作: ${log.action}`,
        summary: `实体: ${log.entityType ?? '未知'} #${log.entityId ?? '-'}`,
        // 命中字段如实标注：纯数字关键词匹配的是 entity_id，其余匹配 action/entity_type 文本
        matchedFields: query.keyword
          ? /^\d+$/.test(query.keyword.trim())
            ? ['entity_id']
            : ['action']
          : [],
        status: log.severity,
        updatedAt: log.createdAt.toISO()!,
        source: 'activity',
      })
    })

    return { items, total: items.length }
  }

  async suggest(_q: string, _limit: number, _ctx: SearchContext): Promise<AdapterResult> {
    // 活动日志不建议供命令面板使用（数量大且敏感）
    return { items: [], total: 0 }
  }
}
