/**
 * wbs-adapter —— WBS 树视图配置适配器（V2 custom-views-view-config）。
 *
 * 将 WBS 视图的 URL searchParams + 本地状态捕获为 CustomViewConfig，
 * 并支持反向恢复与摘要生成。绝不捕获任务业务数据。
 */

import type { CustomViewConfig } from '@aiproj/types'
import type { ViewConfigAdapter } from './types'

export interface WbsLocalState {
  /** 展开的 WBS 节点 ID 列表 */
  expandedNodes?: number[]
  /** 显示字段 */
  showFields?: string[]
  /** 密度模式 */
  density?: 'comfortable' | 'compact'
}

export const wbsAdapter: ViewConfigAdapter<WbsLocalState> = {
  capture(searchParams, localState) {
    const search = searchParams.get('search') || undefined

    const filters: CustomViewConfig['filters'] = {}
    if (search) filters.search = search

    return {
      schemaVersion: 1,
      baseViewType: 'wbs',
      scope: {
        expandedNodes: localState.expandedNodes?.length ? localState.expandedNodes : undefined,
      },
      display: {
        showFields: localState.showFields?.length
          ? localState.showFields
          : ['name', 'status', 'assignee', 'startDate', 'endDate'],
        density: localState.density ?? 'comfortable',
      },
      filters: Object.keys(filters).length ? filters : undefined,
    }
  },

  apply(_config: CustomViewConfig) {
    // 消费方（WbsTree 组件）读取 config 并写入展开态与显示配置。
    // 展开节点通过 useUpdateWbsNode 写入服务端 collapsed 字段，
    // showFields/density 写入本地状态。
  },

  toSearchParams(config) {
    const params = new URLSearchParams()
    if (config.filters?.search) params.set('search', config.filters.search)
    return params
  },

  summarize(config) {
    const parts: string[] = []
    if (config.scope?.expandedNodes?.length) {
      parts.push(`${config.scope.expandedNodes.length} 节点展开`)
    }
    if (config.display?.showFields?.length) {
      parts.push(`${config.display.showFields.length} 个字段`)
    }
    if (config.display?.density === 'compact') parts.push('紧凑模式')
    if (config.filters?.search) parts.push(`搜索"${config.filters.search}"`)
    return parts.length ? parts.join('，') : '默认 WBS 视图'
  },
}
