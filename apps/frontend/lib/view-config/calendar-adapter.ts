/**
 * calendar-adapter —— 日历视图配置适配器（V2 custom-views-view-config）。
 *
 * 将日历视图的 URL searchParams + 本地状态捕获为 CustomViewConfig，
 * 并支持反向恢复与摘要生成。绝不捕获任务业务数据。
 */

import type { CustomViewConfig } from '@aiproj/types'
import type { ViewConfigAdapter } from './types'
import type { CalendarView, CalendarMode } from '@/lib/api/calendar'

export interface CalendarLocalState {
  /** 当前展示日期（ISO 日期字符串） */
  currentDate?: string
  /** 当前视图模式 */
  viewMode?: CalendarView
  /** 当前日历模式（截止日/排程） */
  calendarMode?: CalendarMode
  /** 可见时间窗口（禁止无界窗口） */
  visibleRange?: { start: string; end: string }
}

export const calendarAdapter: ViewConfigAdapter<CalendarLocalState> = {
  capture(searchParams, localState) {
    const view = (searchParams.get('view') as CalendarView | undefined) ?? localState.viewMode
    const anchorDate = searchParams.get('anchorDate') ?? localState.currentDate

    const search = searchParams.get('search') || undefined
    const statuses = searchParams.get('status')?.split(',').filter(Boolean)
    const priorities = searchParams.get('priority')?.split(',').filter(Boolean)
    const assigneeIds = searchParams.get('assigneeId')
      ? [Number(searchParams.get('assigneeId'))]
      : undefined

    const filters: CustomViewConfig['filters'] = {}
    if (search) filters.search = search
    if (statuses?.length) filters.statuses = statuses
    if (priorities?.length) filters.priorities = priorities
    if (assigneeIds?.length) filters.assigneeIds = assigneeIds

    return {
      schemaVersion: 1,
      baseViewType: 'calendar',
      scope: {
        anchorDate: anchorDate,
        timeRange: localState.visibleRange
          ? { start: localState.visibleRange.start, end: localState.visibleRange.end }
          : undefined,
      },
      display: {
        mode: view ?? 'month',
      },
      filters: Object.keys(filters).length ? filters : undefined,
    }
  },

  apply(_config: CustomViewConfig) {
    // 消费方（日历页面组件）读取 config 并写回 URL 与本地状态。
    // 因日历视图的 URL 态由 parseCalendarState/serializeCalendarState 托管，
    // apply 由页面调度器组合执行。
  },

  toSearchParams(config) {
    const params = new URLSearchParams()
    if (config.display?.mode && config.display.mode !== 'month') {
      params.set('view', config.display.mode)
    }
    if (config.scope?.anchorDate) params.set('anchorDate', config.scope.anchorDate)
    if (config.scope?.timeRange) {
      const start = config.scope.timeRange.start
      const end = config.scope.timeRange.end
      if (start) params.set('dateFrom', start)
      if (end) params.set('dateTo', end)
    }
    if (config.filters?.search) params.set('search', config.filters.search)
    if (config.filters?.statuses?.length) {
      params.set('status', config.filters.statuses.join(','))
    }
    if (config.filters?.priorities?.length) {
      params.set('priority', config.filters.priorities.join(','))
    }
    if (config.filters?.assigneeIds?.length) {
      params.set('assigneeId', String(config.filters.assigneeIds[0]))
    }
    return params
  },

  summarize(config) {
    const parts: string[] = []
    const mode = config.display?.mode
    const modeLabel = mode === 'week' ? '周视图' : mode === 'day' ? '日视图' : '月视图'
    parts.push(modeLabel)
    if (config.scope?.anchorDate) parts.push(`锚点 ${config.scope.anchorDate}`)
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
    return parts.length ? parts.join('，') : '默认日历视图'
  },
}
