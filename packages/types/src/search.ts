// @aiproj/types — V2 高级搜索共享契约（前后端共享）
// v2-advanced-search

// ---------------------------------------------------------------------------
// 搜索实体类型枚举
// ---------------------------------------------------------------------------

/** 搜索实体类型白名单 */
export const SEARCH_ENTITY_TYPES = [
  'project',
  'task',
  'file',
  'risk',
  'change_request',
  'report',
  'comment',
  'activity',
  'milestone',
  'document',
] as const
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number]

// ---------------------------------------------------------------------------
// 排序支持与分页上限
// ---------------------------------------------------------------------------

/** 可排序字段白名单 */
export const SEARCH_SORT_FIELDS = [
  'updated_at',
  'created_at',
  'name',
  'status',
  'priority',
  'severity',
  'start_date',
  'end_date',
] as const
export type SearchSortField = (typeof SEARCH_SORT_FIELDS)[number]

/** 排序方向 */
export const SEARCH_SORT_DIRECTIONS = ['asc', 'desc'] as const
export type SearchSortDirection = (typeof SEARCH_SORT_DIRECTIONS)[number]

/** 排序表达式 */
export interface SearchSort {
  field: SearchSortField
  direction: SearchSortDirection
}

/** 每页最大记录数 */
export const SEARCH_MAX_PER_PAGE = 50

/** 默认每页记录数 */
export const SEARCH_DEFAULT_PER_PAGE = 20

/** 关键词最小长度 */
export const SEARCH_KEYWORD_MIN_LENGTH = 1

/** 关键词最大长度 */
export const SEARCH_KEYWORD_MAX_LENGTH = 200

/** 每源每页最大结果数（防止单源淹没聚合） */
export const SEARCH_MAX_PER_SOURCE = 100

/** 搜索范围 */
export const SEARCH_SCOPES = ['organization', 'project'] as const
export type SearchScope = (typeof SEARCH_SCOPES)[number]

// ---------------------------------------------------------------------------
// 查询请求
// ---------------------------------------------------------------------------

export interface SearchQuery {
  /** 搜索关键词（可选，允许空关键词纯结构化筛选） */
  keyword?: string
  /** 实体类型筛选（空数组=搜索所有类型） */
  entityTypes?: SearchEntityType[]
  /** 项目范围筛选。scope=project 时自动带入当前项目 */
  projectIds?: number[]
  /** 状态筛选（按实体类型有不同含义） */
  status?: string[]
  /** 负责人/上传者 ID 筛选 */
  assigneeIds?: number[]
  /** 标签 ID 筛选 */
  tagIds?: number[]
  /** 时间范围起始 */
  dateFrom?: string
  /** 时间范围结束 */
  dateTo?: string
  /** 搜索范围：组织级（默认）或项目级 */
  scope?: SearchScope
  /** 排序 */
  sort?: SearchSort[]
  /** 页码（从 1 开始） */
  page?: number
  /** 每页记录数 */
  perPage?: number
}

// ---------------------------------------------------------------------------
// 搜索结果
// ---------------------------------------------------------------------------

/** 搜索结果高亮片段 */
export interface SearchHighlight {
  field: string
  snippet: string
}

/** 搜索结果项 */
export interface SearchResultItem {
  entityType: SearchEntityType
  entityId: number
  projectId?: number | null
  title: string
  summary: string | null
  matchedFields: string[]
  highlights?: SearchHighlight[]
  status?: string | null
  updatedAt: string | null
  /** 安全跳转目标（详情/审查页，非自动执行） */
  target: string
  /** 来源标识（哪个 Adapter 产生） */
  source: string
  /** 排序分数 */
  score: number
  /** 附属元数据（只含低敏信息） */
  metadata?: Record<string, unknown>
}

/** 搜索结果元信息 */
export interface SearchResultMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
  /** 各来源结果数（用于调试和降级展示） */
  sourceCounts?: Record<string, number>
  /** 不可用来源列表 */
  degradedSources?: string[]
}

/** 搜索结果响应 */
export interface SearchResponse {
  data: SearchResultItem[]
  meta: SearchResultMeta
}

// ---------------------------------------------------------------------------
// 搜索建议
// ---------------------------------------------------------------------------

export interface SearchSuggestion {
  entityType: SearchEntityType
  entityId: number
  title: string
  summary: string | null
  target: string
  projectId?: number | null
}

export interface SearchSuggestionsResponse {
  data: SearchSuggestion[]
}

// ---------------------------------------------------------------------------
// 来源能力声明
// ---------------------------------------------------------------------------

export interface SourceCapability {
  entityTypes: SearchEntityType[]
  supportedFilters: string[]
  supportsSort: boolean
  supportsPagination: boolean
  /** 该来源是否需要项目成员权限检查 */
  requiresProjectMembership: boolean
  /** 该来源是否已有完整的组织隔离 */
  hasOrgIsolation: boolean
}

// ---------------------------------------------------------------------------
// 来源降级结构
// ---------------------------------------------------------------------------

export interface SourceDegradation {
  sourceName: string
  error: string
  /** 是否完全不可用（false=部分结果） */
  isFatal: boolean
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 根据实体类型获取对应的友好中文名 */
export function getEntityTypeLabel(type: SearchEntityType): string {
  const labels: Record<SearchEntityType, string> = {
    project: '项目',
    task: '任务',
    file: '文件',
    risk: '风险',
    change_request: '变更请求',
    report: '报表',
    comment: '评论',
    activity: '活动',
    milestone: '里程碑',
    document: '文档',
  }
  return labels[type] ?? type
}

/** 根据实体类型获取优先级（用于排序） */
export function getEntityTypePriority(type: SearchEntityType): number {
  const priorities: Record<SearchEntityType, number> = {
    project: 1,
    task: 2,
    milestone: 3,
    change_request: 4,
    risk: 5,
    report: 6,
    document: 7,
    file: 8,
    comment: 9,
    activity: 10,
  }
  return priorities[type] ?? 99
}

/** 验证实体类型是否在白名单中 */
export function isValidEntityType(type: string): type is SearchEntityType {
  return SEARCH_ENTITY_TYPES.includes(type as SearchEntityType)
}

/** 验证排序字段是否在白名单中 */
export function isValidSortField(field: string): field is SearchSortField {
  return SEARCH_SORT_FIELDS.includes(field as SearchSortField)
}
