// v2-github-gitlab-light-links —— 外部链接搜索 Adapter
// 支持通过 provider、仓库、外部编号、标题、状态和关联任务标题搜索

import TaskExternalLink from '#models/task_external_link'
import Task from '#models/task'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'

export default class TaskExternalLinkSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['task'] as SearchEntityType[]
  }

  get supportedFilters(): string[] {
    return ['projectIds', 'status']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = TaskExternalLink.query()
      .whereIn('project_id', ctx.projectIds ?? [])
      .whereNotNull('task_id')

    if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('repository_owner', kw)
          .orWhereILike('repository_name', kw)
          .orWhereILike('external_title', kw)
          .orWhere('external_number', '=', Number.parseInt(query.keyword ?? '', 10) || 0)
          .orWhereILike('external_id', kw)
          .orWhereILike('external_status', kw)
      })
    }

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    }

    if (query.status && query.status.length > 0) {
      q.whereIn('external_status', query.status)
    }

    q.orderBy('updated_at', 'desc')
    q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const links = await q

    // 批量查询关联任务标题
    const taskIds = [...new Set(links.map((l) => l.taskId))]
    const tasks =
      taskIds.length > 0 ? await Task.query().whereIn('id', taskIds).select('id', 'name') : []
    const taskTitleMap = new Map(tasks.map((t) => [t.id, t.name]))

    const items: SearchResultItem[] = links.map((link) => {
      const taskTitle = taskTitleMap.get(link.taskId) ?? `任务 #${link.taskId}`
      const matchedFields = this.detectMatchedFields(link, query.keyword)
      return makeSearchResultItem({
        entityType: 'task',
        entityId: link.taskId,
        projectId: Number(link.projectId),
        title: `${link.provider}/${link.repositoryOwner}/${link.repositoryName}#${link.externalNumber}`,
        summary: link.externalTitle
          ? toLowSensitivitySummary(link.externalTitle)
          : `关联任务：${taskTitle}`,
        matchedFields,
        status: link.externalStatus,
        updatedAt: link.updatedAt?.toISO() ?? null,
        source: 'task_external_link',
        metadata: {
          provider: link.provider,
          repositoryOwner: link.repositoryOwner,
          repositoryName: link.repositoryName,
          externalNumber: link.externalNumber,
          externalStatus: link.externalStatus,
          linkedTaskTitle: taskTitle,
          linkedTaskId: link.taskId,
          externalLinkId: link.id,
        },
      })
    })

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const links = await TaskExternalLink.query()
      .whereIn('project_id', ctx.projectIds ?? [])
      .where((b) => {
        b.whereILike('repository_owner', kw)
          .orWhereILike('repository_name', kw)
          .orWhereILike('external_title', kw)
      })
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = links.map((link) =>
      makeSearchResultItem({
        entityType: 'task',
        entityId: link.taskId,
        projectId: Number(link.projectId),
        title: `${link.provider}/${link.repositoryOwner}/${link.repositoryName}#${link.externalNumber}`,
        summary: link.externalTitle ?? null,
        matchedFields: ['repository_owner', 'repository_name'],
        updatedAt: link.updatedAt?.toISO() ?? null,
        source: 'task_external_link',
        metadata: { externalLinkId: link.id },
      }),
    )

    return { items, total: items.length }
  }

  private detectMatchedFields(link: any, keyword?: string): string[] {
    if (!keyword) return []
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (link.repositoryOwner?.toLowerCase().includes(lower)) fields.push('repository_owner')
    if (link.repositoryName?.toLowerCase().includes(lower)) fields.push('repository_name')
    if (link.externalTitle?.toLowerCase().includes(lower)) fields.push('external_title')
    if (String(link.externalNumber) === keyword) fields.push('external_number')
    if (link.externalId?.toLowerCase().includes(lower)) fields.push('external_id')
    if (link.externalStatus?.toLowerCase().includes(lower)) fields.push('external_status')
    return fields
  }
}
