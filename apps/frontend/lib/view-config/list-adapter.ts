/**
 * list-adapter —— 列表视图配置适配器（V2 custom-views-view-config）。
 *
 * 将列表视图的 URL searchParams + 本地状态捕获为 CustomViewConfig，
 * 并支持反向恢复与摘要生成。绝不捕获任务业务数据。
 */

import type { CustomViewConfig, CustomViewSort } from '@aiproj/types'
import type { ViewConfigAdapter } from './types'

export interface ListLocalState {
  /** 显示列 */
  columns?: string[]
  /** 密度模式 */
  density?: 'comfortable' | 'compact'
  /** 滚动位置 */
  scrollPosition?: { top: number; left: number }
}

/**
 * 从 URL sort 参数转换为 CustomViewSort 数组。
 * 格式 "+name,-endDate" → [{ field: "name", direction: "asc" }, ...]
 */
function listSortFromParams(searchParams: URLSearchParams): CustomViewSort[] | undefined {
  const raw = searchParams.get('sort')
  if (!raw) return undefined
  const terms = raw.split(',').filter(Boolean)
  const sorts: CustomViewSort[] = []
  for (const term of terms) {
    const direction = term.startsWith('-') ? 'desc' : 'asc'
    const field = term.slice(1)
    if (field) sorts.push({ field, direction })
  }
  return sorts.length ? sorts : undefined
}

/**
 * 将 CustomViewSort 数组序列化为 URL sort 参数。
 * [{ field: "name", direction: "asc" }] → "+name"
 */
function sortToParam(sorts?: CustomViewSort[]): string | undefined {
  if (!sorts?.length) return undefined
  return sorts.map((s) => (s.direction === 'desc' ? '-' : '+') + s.field).join(',')
}

export const listAdapter: ViewConfigAdapter<ListLocalState> = {
  capture(searchParams, localState) {
    const search = searchParams.get('search') || undefined
    const statuses = searchParams.get('status')?.split(',').filter(Boolean)
    const priorities = searchParams.get('priority')?.split(',').filter(Boolean)
    const assigneeIds = searchParams.get('assigneeId')
      ? searchParams
          .get('assigneeId')!
          .split(',')
          .map(Number)
          .filter((n) => n > 0)
      : undefined
    const dateFrom = searchParams.get('dateFrom') || undefined
    const dateTo = searchParams.get('dateTo') || undefined

    const filters: CustomViewConfig['filters'] = {}
    if (search) filters.search = search
    if (statuses?.length) filters.statuses = statuses
    if (priorities?.length) filters.priorities = priorities
    if (assigneeIds?.length) filters.assigneeIds = assigneeIds
    if (dateFrom) filters.dateFrom = dateFrom
    if (dateTo) filters.dateTo = dateTo

    return {
      schemaVersion: 1,
      baseViewType: 'list',
      filters: Object.keys(filters).length ? filters : undefined,
      sort: listSortFromParams(searchParams),
      display: {
        columns: localState.columns,
        density: localState.density ?? 'comfortable',
      },
      state: {
        scrollPosition: localState.scrollPosition,
      },
    }
  },

  apply(_config: CustomViewConfig) {
    // 消费方（页面组件）读取 config 并写入 URL 与本地状态。
    // 因列表视图的 URL 态由 useListViewUrlState 托管，
    // apply 由页面调度器调用 update() 将 filters/sort 写回 URL。
  },

  toSearchParams(config) {
    const params = new URLSearchParams()
    if (config.filters?.search) params.set('search', config.filters.search)
    if (config.filters?.statuses?.length) {
      params.set('status', config.filters.statuses.join(','))
    }
    if (config.filters?.priorities?.length) {
      params.set('priority', config.filters.priorities.join(','))
    }
    if (config.filters?.assigneeIds?.length) {
      params.set('assigneeId', config.filters.assigneeIds.join(','))
    }
    if (config.filters?.dateFrom) params.set('dateFrom', config.filters.dateFrom)
    if (config.filters?.dateTo) params.set('dateTo', config.filters.dateTo)
    const sort = sortToParam(config.sort)
    if (sort) params.set('sort', sort)
    return params
  },

  summarize(config) {
    const parts: string[] = []
    if (config.filters?.search) parts.push(`搜索"${config.filters.search}"`)
    if (config.filters?.statuses?.length) {
      parts.push(`${config.filters.statuses.length} 个状态`)
    }
    if (config.filters?.priorities?.length) {
      parts.push(`${config.filters.priorities.length} 个优先级`)
    }
    if (config.filters?.assigneeIds?.length) {
      parts.push(`${config.filters.assigneeIds.length} 个负责人`)
    }
    if (config.filters?.dateFrom || config.filters?.dateTo) {
      const range = [config.filters.dateFrom, config.filters.dateTo].filter(Boolean).join(' ~ ')
      parts.push(`截止日 ${range}`)
    }
    if (config.sort?.length) {
      const desc = config.sort
        .map((s) => `${s.field}${s.direction === 'desc' ? ' ↓' : ' ↑'}`)
        .join('，')
      parts.push(`排序：${desc}`)
    }
    if (config.display?.columns?.length) {
      parts.push(`${config.display.columns.length} 列`)
    }
    return parts.length ? parts.join('，') : '默认列表视图'
  },
}
