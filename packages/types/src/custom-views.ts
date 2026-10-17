/**
 * custom-views —— V2 自定义视图配置共享契约（前后端共享）。
 *
 * 定义 CustomViewConfig 基类型与各基础视图配置子类型。
 * 服务端白名单 schema 在 `apps/backend/app/validators/custom_view.ts` 中实现。
 */

// ─── 基础视图类型枚举 ───────────────────────────────
export type CustomViewBaseType = 'kanban' | 'list' | 'calendar' | 'gantt' | 'wbs' | 'resource'

// ─── 可见性枚举 ─────────────────────────────────────
export type CustomViewVisibility = 'personal' | 'shared'

// ─── 排序方向 ────────────────────────────────────────
export type SortDirection = 'asc' | 'desc'

// ─── 排序项 ──────────────────────────────────────────
export interface CustomViewSort {
  field: string
  direction: SortDirection
}

// ─── 筛选条件基 ──────────────────────────────────────
export interface CustomViewFilter {
  field: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: string | number | boolean | (string | number)[]
}

// ─── 视图配置块 ──────────────────────────────────────
export interface CustomViewFilters {
  search?: string
  statuses?: string[]
  priorities?: string[]
  assigneeIds?: number[]
  dateFrom?: string
  dateTo?: string
  roles?: string[]
  skills?: string[]
  loadStatuses?: string[]
  [key: string]: unknown
}

export interface CustomViewDisplay {
  // Kanban
  columnDisplay?: Record<string, { collapsed?: boolean; label?: string }>
  // List
  columns?: string[]
  density?: 'comfortable' | 'compact'
  // Gantt
  showDependencies?: boolean
  showCriticalPath?: boolean
  showBaseline?: boolean
  showProgress?: boolean
  showWeekends?: boolean
  // WBS
  showFields?: string[]
  // Calendar
  mode?: 'month' | 'week' | 'day'
  // Resource workbench
  resourceViewMode?: 'matrix' | 'requirements' | 'conflicts'
  // 通用
  [key: string]: unknown
}

export interface CustomViewScope {
  expandedNodes?: number[]
  anchorDate?: string
  timeRange?: { start: string; end: string }
  [key: string]: unknown
}

export interface CustomViewState {
  columnPage?: Record<string, number>
  scrollPosition?: { top: number; left: number }
  [key: string]: unknown
}

// ─── 顶层配置契约 ────────────────────────────────────
export interface CustomViewConfig {
  schemaVersion: number
  baseViewType: CustomViewBaseType
  filters?: CustomViewFilters
  sort?: CustomViewSort[]
  display?: CustomViewDisplay
  scope?: CustomViewScope
  state?: CustomViewState
}

// ─── 当前版本 ─────────────────────────────────────────
export const CURRENT_CUSTOM_VIEW_SCHEMA_VERSION = 1

// ─── API 响应 ─────────────────────────────────────────
export interface CustomViewResponse {
  id: number
  organizationId: number
  projectId: number
  ownerUserId: number
  name: string
  baseViewType: CustomViewBaseType
  visibility: CustomViewVisibility
  config: CustomViewConfig
  schemaVersion: number
  position: number
  isDefault: boolean
  createdAt: string
  updatedAt: string | null
}

export interface CustomViewListResponse {
  personal: CustomViewResponse[]
  shared: CustomViewResponse[]
}

// ─── 创建/更新请求 ──────────────────────────────────
export interface CreateCustomViewRequest {
  name: string
  baseViewType: CustomViewBaseType
  visibility: CustomViewVisibility
  config: CustomViewConfig
}

export interface UpdateCustomViewRequest {
  name?: string
  config?: CustomViewConfig
  visibility?: CustomViewVisibility
}

export interface ReorderCustomViewsRequest {
  viewIds: number[]
}

export interface CloneCustomViewRequest {
  name?: string
}
