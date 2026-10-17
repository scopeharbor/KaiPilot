/**
 * gantt-adapter —— 甘特图视图配置适配器（V2 custom-views-view-config）。
 *
 * 将甘特视图的 URL searchParams + 本地状态（useGanttStore）捕获为 CustomViewConfig，
 * 并支持反向恢复与摘要生成。绝不捕获任务/依赖/基线等业务数据。
 */

import type { CustomViewConfig } from '@aiproj/types'
import type { ViewConfigAdapter } from './types'
import type { GanttGranularity, GanttEntry } from '@/lib/gantt/types'

export interface GanttLocalState {
  /** 时间粒度 */
  granularity?: GanttGranularity
  /** 双入口类型 */
  entry?: GanttEntry
  /** 全部依赖常显 */
  showAllDependencies?: boolean
  /** 问题链常显 */
  showProblemChain?: boolean
  /** 关键路径常显 */
  showCriticalPath?: boolean
  /** 基线对比开关 */
  compareBaseline?: boolean
  /** 任务条进度填充 */
  showProgress?: boolean
  /** 显示周末列 */
  showWeekends?: boolean
  /** 密度模式 */
  density?: 'comfortable' | 'compact'
  /** 展开的 WBS 节点 */
  expandedWbsNodes?: number[]
  /** 时间窗口起始（ISO 日期） */
  timeWindowStart?: string
  /** 时间窗口结束（ISO 日期） */
  timeWindowEnd?: string
}

/** GanttGranularity → CustomViewDisplay.mode 映射。quarter 回退为 month。 */
function granularityToMode(granularity: GanttGranularity | undefined): 'day' | 'week' | 'month' {
  if (granularity === 'day') return 'day'
  if (granularity === 'week') return 'week'
  return 'month' // 'month' | 'quarter' → 'month'
}

export const ganttAdapter: ViewConfigAdapter<GanttLocalState> = {
  capture(searchParams, localState) {
    const search = searchParams.get('search') || undefined
    const assigneeIds = searchParams.get('assigneeId')
      ? searchParams
          .get('assigneeId')!
          .split(',')
          .map(Number)
          .filter((n) => n > 0)
      : undefined
    const priorities = searchParams.get('priority')?.split(',').filter(Boolean)

    const filters: CustomViewConfig['filters'] = {}
    if (search) filters.search = search
    if (assigneeIds?.length) filters.assigneeIds = assigneeIds
    if (priorities?.length) filters.priorities = priorities

    return {
      schemaVersion: 1,
      baseViewType: 'gantt',
      display: {
        showDependencies: localState.showAllDependencies ?? false,
        showCriticalPath: localState.showCriticalPath ?? true,
        showBaseline: localState.compareBaseline ?? false,
        showProgress: localState.showProgress ?? true,
        showWeekends: localState.showWeekends ?? true,
        density: localState.density ?? 'comfortable',
        mode: granularityToMode(localState.granularity),
      },
      scope: {
        expandedNodes: localState.expandedWbsNodes?.length
          ? localState.expandedWbsNodes
          : undefined,
        timeRange: localState.timeWindowStart
          ? { start: localState.timeWindowStart, end: localState.timeWindowEnd ?? '' }
          : undefined,
      },
      filters: Object.keys(filters).length ? filters : undefined,
    }
  },

  apply(_config: CustomViewConfig) {
    // 消费方（页面组件 + useGanttStore）读取 config 并写入 Zustand store。
    // GanttViewState 的 setter 均已就绪，页面调度器形如：
    //   if (config.display?.showCriticalPath !== undefined)
    //     ganttStore.setShowCriticalPath(config.display.showCriticalPath)
  },

  toSearchParams(config) {
    const params = new URLSearchParams()
    if (config.filters?.search) params.set('search', config.filters.search)
    if (config.filters?.assigneeIds?.length) {
      params.set('assigneeId', config.filters.assigneeIds.join(','))
    }
    if (config.filters?.priorities?.length) {
      params.set('priority', config.filters.priorities.join(','))
    }
    return params
  },

  summarize(config) {
    const parts: string[] = []
    const displayMode = config.display?.mode
    const grainLabel = displayMode === 'week' ? '周' : displayMode === 'day' ? '日' : '月'
    parts.push(`${grainLabel}粒度`)
    if (config.display?.showCriticalPath) parts.push('关键路径')
    if (config.display?.showBaseline) parts.push('基线对比')
    if (config.display?.showDependencies) parts.push('全部依赖')
    if (config.display?.showWeekends === false) parts.push('隐藏周末')
    if (config.scope?.expandedNodes?.length) {
      parts.push(`${config.scope.expandedNodes.length} 节点展开`)
    }
    if (config.filters?.search) parts.push(`搜索"${config.filters.search}"`)
    if (config.filters?.assigneeIds?.length) {
      parts.push(`${config.filters.assigneeIds.length} 个负责人`)
    }
    return parts.length ? parts.join('，') : '默认甘特图视图'
  },
}
