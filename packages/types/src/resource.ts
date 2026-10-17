// resource-allocation-and-load — 资源、分配与负载类型（前后端共享）。

/** 资源类型枚举 */
export type ResourceType = 'human' | 'material' | 'equipment' | 'budget'

/** 资源角色枚举 */
export type ResourceRole = 'owner' | 'project_manager' | 'team_lead' | 'member' | 'viewer'

/** 资源状态枚举 */
export type ResourceStatus = 'active' | 'inactive'

/** 分配类型枚举 */
export type AllocationType = 'assigned' | 'allocated' | 'reserved'

/** 负载四档状态 */
export type LoadLevel = 'idle' | 'normal' | 'high' | 'overloaded'

/** 资源实体 */
export interface Resource {
  id: number
  projectId: number
  userId: number | null
  name: string
  email: string | null
  resourceType: ResourceType
  role: ResourceRole
  status: ResourceStatus
  dailyCapacityHours: number
  skillTags: string | null
  workDays: string
  timezone: string
  costPerUnitCents: number | null
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
}

/** 资源分配实体 */
export interface ResourceAllocation {
  id: number
  resourceId: number
  taskId: number
  allocationType: AllocationType
  allocationPercent: number
  startDate: string | null
  endDate: string | null
  plannedUnits: number | null
  actualUnits: number | null
  createdAt: string
  updatedAt: string | null
}

/** 逐日分配汇总 */
export interface DateAllocationSummary {
  date: string
  totalAllocatedPercent: number
  allocatedHours: number
  capacityHours: number
}

/** 资源负载项（个人视图） */
export interface ResourceLoadItem {
  resourceId: number
  resourceName: string
  role: string
  dailyCapacityHours: number
  days: DateAllocationSummary[]
  overallUtilizationPercent: number
}

/** 团队负载结果 */
export interface ResourceLoadResult {
  from: string
  to: string
  resources: ResourceLoadItem[]
  teamAverageUtilizationPercent: number
}

/** 趋势日数据 */
export interface TrendDay {
  date: string
  totalHours: number
  capacityHours: number
  utilizationPercent: number
}

/** 趋势负载结果 */
export interface TrendResult {
  from: string
  to: string
  totalResources: number
  days: TrendDay[]
}

/** 分页元数据 */
export interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}
