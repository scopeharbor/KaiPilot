/**
 * view-config —— 视图配置适配器注册表入口（v2-custom-views-view-config）。
 *
 * 各基础视图（Kanban/List/Calendar/Gantt/WBS）的适配器在此注册，
 * 供自定义视图保存/恢复/切换时统一调度。
 */
export { type ViewConfigAdapter } from './types'

import { kanbanAdapter } from './kanban-adapter'
import { listAdapter } from './list-adapter'
import { calendarAdapter } from './calendar-adapter'
import { ganttAdapter } from './gantt-adapter'
import { wbsAdapter } from './wbs-adapter'
import { resourceAdapter } from './resource-adapter'
import type { ViewConfigAdapter } from './types'

/**
 * 视图配置适配器注册表。
 * key = CustomViewBaseType，value = 对应视图的适配器实例。
 */
export const viewConfigAdapters: Record<string, ViewConfigAdapter> = {
  kanban: kanbanAdapter as ViewConfigAdapter,
  list: listAdapter as ViewConfigAdapter,
  calendar: calendarAdapter as ViewConfigAdapter,
  gantt: ganttAdapter as ViewConfigAdapter,
  wbs: wbsAdapter as ViewConfigAdapter,
  resource: resourceAdapter as ViewConfigAdapter,
}
