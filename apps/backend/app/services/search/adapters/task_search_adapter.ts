// v2-advanced-search — Task Search Adapter
// 复用任务项目归属规则，支持名称、描述、状态、负责人和日期筛选

import Task from '#models/task'
import {
  SearchSourceAdapter,
  type SearchContext,
  type AdapterResult,
} from '#services/search/search_source_adapter'
import type { SearchEntityType, SearchQuery, SearchResultItem } from '@aiproj/types'
import { formatProjectCode, matchTaskCodeKeyword } from '@aiproj/types'
import Project from '#models/project'
import { makeSearchResultItem, toLowSensitivitySummary } from '#services/search/search_dto_mapper'

export default class TaskSearchAdapter extends SearchSourceAdapter {
  get supportedEntityTypes(): SearchEntityType[] {
    return ['task']
  }

  get supportedFilters(): string[] {
    return ['status', 'assigneeIds', 'dateFrom', 'dateTo', 'projectIds']
  }

  async search(query: SearchQuery, ctx: SearchContext): Promise<AdapterResult> {
    const q = Task.query()
      .whereIn('project_id', ctx.projectIds ?? [])
      .whereNull('deleted_at')

    // 任务编号（`#128` / `PROJ-5#128`）：按任务号精确命中，不做模糊匹配
    const codeHit = query.keyword ? matchTaskCodeKeyword(query.keyword) : null
    if (codeHit) {
      q.where('id', codeHit.taskId)
    } else if (query.keyword) {
      const kw = `%${query.keyword}%`
      q.where((b) => {
        b.whereILike('name', kw).orWhereILike('description', kw)
      })
    }

    if (query.status && query.status.length > 0) {
      q.whereIn('status', query.status)
    }

    if (query.assigneeIds && query.assigneeIds.length > 0) {
      q.whereIn('assignee_id', query.assigneeIds)
    }

    if (query.dateFrom) {
      q.where('updated_at', '>=', query.dateFrom)
    }
    if (query.dateTo) {
      q.where('updated_at', '<=', query.dateTo)
    }

    if (query.projectIds && query.projectIds.length > 0) {
      q.whereIn('project_id', query.projectIds)
    }

    q.orderBy('updated_at', 'desc')
    q.limit(query.perPage ?? 20)
    if (query.page && query.page > 1) {
      q.offset((query.page - 1) * (query.perPage ?? 20))
    }

    const tasks = await q
    const projects = await loadProjectCodes(tasks.map((t) => Number(t.projectId)))
    // `PROJ-5#128` 里的项目编号与任务实际所属项目不符 → 不算命中
    const filtered = codeHit?.projectCode
      ? tasks.filter(
          (t) =>
            projects.get(Number(t.projectId))?.code.toLowerCase() ===
            codeHit.projectCode!.toLowerCase(),
        )
      : tasks

    const items: SearchResultItem[] = filtered.map((t) => {
      const project = projects.get(Number(t.projectId))
      return makeSearchResultItem({
        entityType: 'task',
        entityId: t.id,
        projectId: Number(t.projectId),
        title: t.name,
        summary: toLowSensitivitySummary(t.description),
        matchedFields: codeHit
          ? ['code']
          : query.keyword
            ? this.detectMatchedFields(t.name, t.description, query.keyword)
            : [],
        status: t.status,
        updatedAt: t.updatedAt?.toISO() ?? null,
        source: 'task',
        metadata: {
          code: project ? `${project.code}#${t.id}` : `#${t.id}`,
          ...(project ? { projectName: project.name } : {}),
        },
      })
    })

    return { items, total: items.length }
  }

  async suggest(q: string, limit: number, ctx: SearchContext): Promise<AdapterResult> {
    const kw = `%${q}%`
    const tasks = await Task.query()
      .whereIn('project_id', ctx.projectIds ?? [])
      .whereNull('deleted_at')
      .where((b) => b.whereILike('name', kw))
      .orderBy('updated_at', 'desc')
      .limit(limit)

    const items: SearchResultItem[] = tasks.map((t) =>
      makeSearchResultItem({
        entityType: 'task',
        entityId: t.id,
        projectId: Number(t.projectId),
        title: t.name,
        summary: null,
        matchedFields: ['name'],
        updatedAt: t.updatedAt?.toISO() ?? null,
        source: 'task',
      }),
    )

    return { items, total: items.length }
  }

  private detectMatchedFields(name: string, description: string | null, keyword: string): string[] {
    const fields: string[] = []
    const lower = keyword.toLowerCase()
    if (name.toLowerCase().includes(lower)) fields.push('name')
    if (description?.toLowerCase().includes(lower)) fields.push('description')
    return fields
  }
}

/** 任务所属项目的编号与名称（一次查询）。 */
async function loadProjectCodes(
  projectIds: number[],
): Promise<Map<number, { code: string; name: string }>> {
  const ids = [...new Set(projectIds)].filter((id) => Number.isInteger(id) && id > 0)
  if (ids.length === 0) return new Map()
  const projects = await Project.query().whereIn('id', ids).select('id', 'code', 'name')
  return new Map(projects.map((p) => [Number(p.id), { code: formatProjectCode(p), name: p.name }]))
}
