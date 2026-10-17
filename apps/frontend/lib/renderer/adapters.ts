/**
 * adapters —— 视图 Adapter 配置解析器（§4.3 P0，§4.4 P1）。
 *
 * 将受信任的 ViewConfig 转换为对应视图组件的 props。
 * 每个视图类型有自己的 Adapter，复用现有组件和 API 数据。
 */
import type { ProjectViewConfig, ViewConfig, DashboardWidgetConfig } from '@aiproj/types'

// ─── Adapter 注册表 ───────────────────────────────────
type AdapterFn = (config: ViewConfig, projectConfig: ProjectViewConfig) => Record<string, unknown>

const adapterRegistry = new Map<string, AdapterFn>()

export function registerAdapter(type: string, fn: AdapterFn): void {
  if (adapterRegistry.has(type)) return
  adapterRegistry.set(type, fn)
}

export function getAdapter(type: string): AdapterFn | undefined {
  return adapterRegistry.get(type)
}

export async function resolveAdapterProps(
  config: ViewConfig,
  projectConfig: ProjectViewConfig,
): Promise<Record<string, unknown>> {
  const adapter = getAdapter(config.type)
  if (!adapter) {
    throw new Error(`Adapter not found for view type: ${config.type}`)
  }
  return adapter(config, projectConfig)
}

// ═══════════════════════════════════════════════════════
// 内置 Adapter 实现
// ═══════════════════════════════════════════════════════

// ─── Dashboard Adapter ───────────────────────────────
registerAdapter('dashboard', (config) => {
  const dashboardConfig = config.config.config as { widgets: DashboardWidgetConfig[] }
  return {
    viewId: config.id,
    title: config.title,
    widgets: dashboardConfig.widgets || [],
    icon: config.icon,
  }
})

// ─── List Adapter ─────────────────────────────────────
registerAdapter('list', (config) => {
  const listConfig = config.config.config as {
    columns?: string[]
    groupBy?: string
    showSearch?: boolean
    defaultSort?: { field: string; direction: 'asc' | 'desc' }
  }
  return {
    viewId: config.id,
    title: config.title,
    columns: listConfig.columns ?? ['name', 'status', 'priority', 'assignee', 'due_date'],
    groupBy: listConfig.groupBy,
    showSearch: listConfig.showSearch ?? true,
    defaultSort: listConfig.defaultSort,
    icon: config.icon,
  }
})

// ─── Gantt Adapter ────────────────────────────────────
registerAdapter('gantt', (config) => {
  const ganttConfig = config.config.config as {
    showDependencies?: boolean
    showCriticalPath?: boolean
    showBaseline?: boolean
    showProgress?: boolean
    showWeekends?: boolean
    timeScale?: string
  }
  return {
    viewId: config.id,
    title: config.title,
    showDependencies: ganttConfig.showDependencies ?? true,
    showCriticalPath: ganttConfig.showCriticalPath ?? false,
    showBaseline: ganttConfig.showBaseline ?? false,
    showProgress: ganttConfig.showProgress ?? true,
    showWeekends: ganttConfig.showWeekends ?? false,
    timeScale: ganttConfig.timeScale ?? 'week',
    icon: config.icon,
  }
})

// ─── WBS Adapter ──────────────────────────────────────
registerAdapter('wbs', (config) => {
  const wbsConfig = config.config.config as {
    showFields?: string[]
    expandedLevel?: number
    showCompletion?: boolean
  }
  return {
    viewId: config.id,
    title: config.title,
    showFields: wbsConfig.showFields ?? ['name', 'status', 'assignee'],
    expandedLevel: wbsConfig.expandedLevel ?? 2,
    showCompletion: wbsConfig.showCompletion ?? true,
    icon: config.icon,
  }
})

// ─── Kanban Adapter ───────────────────────────────────
registerAdapter('kanban', (config) => {
  const kanbanConfig = config.config.config as {
    columnField?: string
    swimlaneField?: string
    collapsedColumns?: string[]
    showEmptyColumns?: boolean
  }
  return {
    viewId: config.id,
    title: config.title,
    columnField: kanbanConfig.columnField ?? 'status',
    swimlaneField: kanbanConfig.swimlaneField,
    collapsedColumns: kanbanConfig.collapsedColumns ?? [],
    showEmptyColumns: kanbanConfig.showEmptyColumns ?? true,
    icon: config.icon,
  }
})

// ─── Calendar Adapter ─────────────────────────────────
registerAdapter('calendar', (config) => {
  const calConfig = config.config.config as {
    mode?: 'month' | 'week' | 'day'
    showWeekends?: boolean
  }
  return {
    viewId: config.id,
    title: config.title,
    mode: calConfig.mode ?? 'month',
    showWeekends: calConfig.showWeekends ?? false,
    icon: config.icon,
  }
})

// ─── Timeline Adapter（P1: stubbed）───────────────────
registerAdapter('timeline', (config) => ({
  viewId: config.id,
  title: config.title,
  supported: false as const,
  message: '时间线视图即将推出',
  icon: config.icon,
}))

// ─── Risk Matrix Adapter（P1: stubbed）────────────────
registerAdapter('risk-matrix', (config) => ({
  viewId: config.id,
  title: config.title,
  supported: false as const,
  message: '风险矩阵视图即将推出',
  icon: config.icon,
}))

// ─── Resource View Adapter（P1: stubbed）──────────────
registerAdapter('resource', (config) => ({
  viewId: config.id,
  title: config.title,
  supported: false as const,
  message: '资源视图即将推出',
  icon: config.icon,
}))

// ─── Dependency View Adapter（P1: stubbed）────────────
registerAdapter('dependency', (config) => ({
  viewId: config.id,
  title: config.title,
  supported: false as const,
  message: '依赖视图即将推出',
  icon: config.icon,
}))

// ─── Custom Adapter（P1: stubbed）─────────────────────
registerAdapter('custom', (config) => ({
  viewId: config.id,
  title: config.title,
  supported: false as const,
  message: '不支持的自定义视图类型',
  icon: config.icon,
}))
