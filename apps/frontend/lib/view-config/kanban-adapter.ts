/**
 * kanban-adapter —— 看板视图配置适配器（V2 custom-views-view-config）。
 *
 * 将看板视图的 URL searchParams + 本地状态捕获为 CustomViewConfig，
 * 并支持反向恢复与摘要生成。绝不捕获任务业务数据（状态、kanban_rank）。
 */

import type { CustomViewConfig } from '@aiproj/types'
import type { ViewConfigAdapter } from './types'

export interface KanbanLocalState {
  /** 各列折叠状态（列 ID → 是否折叠） */
  columnCollapsed?: Record<string, boolean>
  /** 各列当前分页 */
  columnPages?: Record<string, number>
}

export const kanbanAdapter: ViewConfigAdapter<KanbanLocalState> = {
  capture(searchParams, localState) {
    // 构建 filters——只设非空值
    const assigneeId = searchParams.get('assigneeId')
    const priority = searchParams.get('priority')
    const search = searchParams.get('search') || undefined
    const assigneeIds = assigneeId ? [Number(assigneeId)] : undefined
    const priorities = priority ? priority.split(',') : undefined

    const filters: CustomViewConfig['filters'] = {}
    if (search) filters.search = search
    if (assigneeIds?.length) filters.assigneeIds = assigneeIds
    if (priorities?.length) filters.priorities = priorities

    // 构建 columnDisplay
    const collapsed = localState.columnCollapsed
    const columnDisplay: Record<string, { collapsed: boolean }> = {}
    if (collapsed) {
      for (const [key, value] of Object.entries(collapsed)) {
        columnDisplay[key] = { collapsed: value }
      }
    }

    return {
      schemaVersion: 1,
      baseViewType: 'kanban',
      filters: Object.keys(filters).length ? filters : undefined,
      display: {
        columnDisplay: Object.keys(columnDisplay).length > 0 ? columnDisplay : undefined,
        density: 'comfortable',
      },
      state: {
        columnPage: localState.columnPages,
      },
    }
  },

  apply(_config: CustomViewConfig) {
    // 消费方（页面组件）读取 config 并写入对应的本地状态/URL。
    // 因 Kanban 的本地状态分散在多个 useState 中，apply 由页面调度器组合执行。
  },

  toSearchParams(config) {
    const params = new URLSearchParams()
    if (config.filters?.search) params.set('search', config.filters.search)
    if (config.filters?.assigneeIds?.length) {
      params.set('assigneeId', String(config.filters.assigneeIds[0]))
    }
    if (config.filters?.priorities?.length) {
      params.set('priority', config.filters.priorities.join(','))
    }
    return params
  },

  summarize(config) {
    const parts: string[] = []
    if (config.filters?.search) parts.push(`搜索"${config.filters.search}"`)
    if (config.filters?.assigneeIds?.length) {
      parts.push(`${config.filters.assigneeIds.length} 个负责人`)
    }
    if (config.filters?.priorities?.length) {
      parts.push(`${config.filters.priorities.length} 个优先级`)
    }
    if (config.display?.columnDisplay) {
      const count = Object.keys(config.display.columnDisplay).length
      if (count > 0) parts.push(`${count} 列配置`)
    }
    return parts.length ? parts.join('，') : '默认看板视图'
  },
}
