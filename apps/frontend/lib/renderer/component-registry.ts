/**
 * component-registry —— 组件注册表（§4.2 P0）。
 *
 * 只包含产品内置组件和 Adapter 的显式注册。
 * 禁止动态 import、路径解析或代码执行。
 * 缺失组件走 fallback，不尝试动态加载。
 */

// ─── 已注册组件类型 ───────────────────────────────────
export type RegisteredComponentType =
  | 'dashboard'
  | 'list'
  | 'kanban'
  | 'gantt'
  | 'wbs'
  | 'calendar'
  | 'timeline'
  | 'risk-matrix'
  | 'resource'
  | 'dependency'
  | 'custom'

/** 视图渲染器注册信息 */
export interface ViewRendererEntry {
  type: RegisteredComponentType
  component: React.ComponentType<Record<string, unknown>>
  adapter: string // adapter key for props resolution
  supported: boolean // true = 完整支持, false = stubbed/unsupported
  label: string
}

// ─── Widget 渲染器注册信息 ────────────────────────────
export interface WidgetRendererEntry {
  type: string
  component: React.ComponentType<Record<string, unknown>>
  label: string
}

/**
 * ComponentRegistry —— 显式注册，禁止动态解析。
 *
 * 使用方式：
 *   const component = registry.getViewRenderer('dashboard')
 *   if (!component) → render fallback
 */
class ComponentRegistry {
  private views = new Map<RegisteredComponentType, ViewRendererEntry>()
  private widgets = new Map<string, WidgetRendererEntry>()

  /**
   * 注册视图渲染器。
   * 只应在应用初始化时从内置模块调用。
   */
  registerView(entry: ViewRendererEntry): void {
    if (this.views.has(entry.type)) {
      console.warn(`[Renderer] View type '${entry.type}' already registered, skipping`)
      return
    }
    this.views.set(entry.type, entry)
  }

  /**
   * 注册 widget 渲染器。
   */
  registerWidget(entry: WidgetRendererEntry): void {
    if (this.widgets.has(entry.type)) {
      return
    }
    this.widgets.set(entry.type, entry)
  }

  /**
   * 获取视图渲染器。
   * 返回 undefined 表示未注册，调用方应渲染 fallback。
   */
  getViewRenderer(type: string): ViewRendererEntry | undefined {
    return this.views.get(type as RegisteredComponentType)
  }

  /**
   * 获取 widget 渲染器。
   */
  getWidgetRenderer(type: string): WidgetRendererEntry | undefined {
    return this.widgets.get(type)
  }

  /**
   * 检查视图类型是否已注册。
   */
  hasView(type: string): boolean {
    return this.views.has(type as RegisteredComponentType)
  }

  /**
   * 列出所有已注册视图。
   */
  listViews(): ViewRendererEntry[] {
    return Array.from(this.views.values())
  }

  /**
   * 列出所有已注册 widget。
   */
  listWidgets(): WidgetRendererEntry[] {
    return Array.from(this.widgets.values())
  }
}

/** 全局单例 */
export const componentRegistry = new ComponentRegistry()

/**
 * 初始化注册：产品内置视图。
 * 在应用入口处调用一次。
 */
export function registerBuiltinRenderers(): void {
  const builtinViews: ViewRendererEntry[] = [
    {
      type: 'dashboard',
      component: DashboardViewRenderer,
      adapter: 'dashboard',
      supported: true,
      label: '仪表盘',
    },
    { type: 'list', component: ListViewRenderer, adapter: 'list', supported: true, label: '列表' },
    {
      type: 'kanban',
      component: KanbanViewRenderer,
      adapter: 'kanban',
      supported: true,
      label: '看板',
    },
    {
      type: 'gantt',
      component: GanttViewRenderer,
      adapter: 'gantt',
      supported: true,
      label: '甘特图',
    },
    { type: 'wbs', component: WbsViewRenderer, adapter: 'wbs', supported: true, label: 'WBS' },
    {
      type: 'calendar',
      component: CalendarViewRenderer,
      adapter: 'calendar',
      supported: true,
      label: '日历',
    },
    {
      type: 'timeline',
      component: TimelineViewRenderer,
      adapter: 'timeline',
      supported: false,
      label: '时间线',
    },
    {
      type: 'risk-matrix',
      component: RiskMatrixViewRenderer,
      adapter: 'risk-matrix',
      supported: false,
      label: '风险矩阵',
    },
    {
      type: 'resource',
      component: ResourceViewRenderer,
      adapter: 'resource',
      supported: false,
      label: '资源视图',
    },
    {
      type: 'dependency',
      component: DependencyViewRenderer,
      adapter: 'dependency',
      supported: false,
      label: '依赖视图',
    },
    {
      type: 'custom',
      component: CustomViewRenderer,
      adapter: 'custom',
      supported: false,
      label: '自定义',
    },
  ]

  for (const entry of builtinViews) {
    componentRegistry.registerView(entry)
  }
}

// ─── 占位组件（由实际视图组件替换）───────────────────
// 这些在实际实现中会被真正的视图组件替换。
// 目前作为安全的 fallback 占位。

function DashboardViewRenderer(_props: Record<string, unknown>) {
  return null // 占位
}
function ListViewRenderer(_props: Record<string, unknown>) {
  return null
}
function KanbanViewRenderer(_props: Record<string, unknown>) {
  return null
}
function GanttViewRenderer(_props: Record<string, unknown>) {
  return null
}
function WbsViewRenderer(_props: Record<string, unknown>) {
  return null
}
function CalendarViewRenderer(_props: Record<string, unknown>) {
  return null
}
function TimelineViewRenderer(_props: Record<string, unknown>) {
  return null
}
function RiskMatrixViewRenderer(_props: Record<string, unknown>) {
  return null
}
function ResourceViewRenderer(_props: Record<string, unknown>) {
  return null
}
function DependencyViewRenderer(_props: Record<string, unknown>) {
  return null
}
function CustomViewRenderer(_props: Record<string, unknown>) {
  return null
}
