// v2-5-typescript-sdk-core —— API envelope / 错误 / 分页 / 项目 / 任务 DTO（前后端共享）。
//
// 本文件只表达「跨端共享、与 /api/v1 现行响应形状一致」的契约类型，供 SDK 与未来
// 前端迁移复用；不复制后端 Lucid model 内部，也不引入 SDK 专属 transport 概念。
// 形状来源：apps/backend/app/controllers/projects_controller.ts 的 projectDto、
// apps/backend/app/types/dto.ts 的 taskDto、apps/frontend/lib/api-client.ts 的 envelope
// 解包语义，并经 docs/v1/api/.endpoints-baseline.json parity gate 校验。

/** 标准 API 错误 envelope：`{ error: { code, message, details? } }`。 */
export interface ApiErrorEnvelope {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/**
 * 标准错误响应（低敏感）：解析自 HTTP 响应，不携带原始 body/headers。
 * SDK 在抛出前已脱敏，details 透传后端给出的结构化错误明细。
 */
export interface ApiErrorResponse {
  /** HTTP 状态码。 */
  status: number
  /** 后端 error.code；解析失败时为 `UNKNOWN`。 */
  code: string
  /** 人类可读消息；解析失败时为 statusText。 */
  message: string
  /** 后端 error.details（如字段级校验明细），原样透传。 */
  details?: unknown
}

// 分页 meta 与列表 envelope 复用 resource.ts 既有的 PaginationMeta / PaginatedResponse
// （形状一致：{ data: T[], meta: { total, page, perPage, totalPages } }）。

/** 单资源响应 envelope：`{ data: T }`。 */
export interface DataResponse<T> {
  data: T
}

// ---- Project DTO（对齐 projects_controller.projectDto）----

export const PROJECT_STATUSES = [
  'draft',
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
  'archived',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number]

/** 项目工作日历设置（对齐 project validator settingsSchema）。 */
export interface ProjectSettings {
  workdays?: number[]
  holidays?: string[]
  timezone?: string
}

/** 项目聚合统计（show 端点附带，list 端点经 $extras 附带）。 */
export interface ProjectStats {
  memberCount: number
  taskCount: number
  milestoneCount: number
}

/** 项目对外 DTO（对齐 projectDto）。 */
export interface ProjectDto {
  id: number
  organizationId: number
  name: string
  code: string | null
  description: string | null
  category: string | null
  status: ProjectStatus
  priority: ProjectPriority
  startDate: string | null
  endDate: string | null
  actualStartDate: string | null
  actualEndDate: string | null
  budgetCents: number | null
  actualCostCents: number | null
  currency: string | null
  progressPercent: number | null
  healthStatus: string | null
  settings: ProjectSettings | null
  createdBy: number
  updatedBy: number | null
  createdAt: string | null
  updatedAt: string | null
  deletedAt: string | null
  /** 仅 show 端点或 list $extras 命中时出现。 */
  stats?: ProjectStats
  // v3-database-schema-expansion §5.1 —— V3 组合事实（全部可选，旧响应可缺省）
  projectManagerId?: number | null
  departmentKey?: string | null
  departmentName?: string | null
  businessLine?: string | null
  investmentType?: string | null
  strategyTheme?: string | null
  programKey?: string | null
  forecastCostCents?: number | null
  forecastEndDate?: string | null
  customFields?: Record<string, unknown> | null
  portfolioFactSource?: string | null
  portfolioFactUpdatedAt?: string | null
}

/** 创建项目输入（对齐 createProjectValidator，仅 SDK 暴露的字段）。 */
export interface CreateProjectInput {
  name: string
  code?: string
  description?: string | null
  category?: string | null
  status?: ProjectStatus
  priority?: ProjectPriority
  startDate?: string
  endDate?: string
  budgetCents?: number
  currency?: string
  settings?: ProjectSettings | null
  // v3-database-schema-expansion §5.1 —— V3 组合事实（全部可选）
  projectManagerId?: number | null
  departmentKey?: string | null
  departmentName?: string | null
  businessLine?: string | null
  investmentType?: string | null
  strategyTheme?: string | null
  programKey?: string | null
  forecastCostCents?: number | null
  forecastEndDate?: string | null
  customFields?: Record<string, unknown> | null
  portfolioFactSource?: string | null
}

/** 更新项目输入（全部选填，部分更新）。 */
export type UpdateProjectInput = Partial<CreateProjectInput>

/** 项目列表查询参数（对齐 projects_controller.index 接收的 input）。 */
export interface ListProjectsQuery {
  status?: ProjectStatus
  priority?: ProjectPriority
  search?: string
  /** 排序字符串，如 `-createdAt,+name`。 */
  sort?: string
  page?: number
  perPage?: number
  /** 是否包含已归档项目。 */
  includeArchived?: boolean
}

// ---- Task DTO（对齐 apps/backend/app/types/dto.ts taskDto）----

export const TASK_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
  'on_hold',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['lowest', 'low', 'medium', 'high', 'highest'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_TYPES = ['task', 'milestone', 'summary', 'deliverable'] as const
export type TaskType = (typeof TASK_TYPES)[number]

/** 任务关联用户引用（assignee/reviewer）。 */
export interface TaskUserRef {
  id: number
  fullName: string | null
  email: string
  initials: string
}

/** 任务父任务引用（仅预加载 parent 时出现）。 */
export interface TaskParentRef {
  id: number
  name: string
  status: TaskStatus
}

/** 任务对外 DTO（对齐 taskDto）。 */
export interface TaskDto {
  id: number
  projectId: number
  name: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  taskType: TaskType
  startDate: string | null
  endDate: string | null
  actualStartDate: string | null
  actualEndDate: string | null
  durationDays: number | null
  estimatedHours: number | null
  actualHours: number | null
  progressPercent: number
  kanbanRank: number | null
  assigneeId: number | null
  reviewerId: number | null
  parentTaskId: number | null
  wbsNodeId: number | null
  milestoneId: number | null
  costEstimateCents: number | null
  costActualCents: number | null
  customFields: Record<string, unknown> | null
  subtaskCount?: number
  dependencyCount?: number
  commentCount?: number
  assignee?: TaskUserRef
  reviewer?: TaskUserRef
  parent?: TaskParentRef
  subtasks?: TaskDto[]
  createdAt: string
  updatedAt: string | null
}

/** 创建任务输入（对齐 createTaskValidator；projectId 取自路由，故不在 body）。 */
export interface CreateTaskInput {
  name: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  taskType?: TaskType
  startDate?: string
  endDate?: string
  durationDays?: number
  estimatedHours?: number
  assigneeId?: number
  reviewerId?: number
  parentTaskId?: number
  wbsNodeId?: number
  milestoneId?: number
  costEstimateCents?: number
  customFields?: Record<string, unknown> | null
}

/** 更新任务输入（全部选填，部分更新；assignee/reviewer 可置 null）。 */
export interface UpdateTaskInput {
  name?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  taskType?: TaskType
  startDate?: string
  endDate?: string
  durationDays?: number
  estimatedHours?: number
  actualHours?: number
  assigneeId?: number | null
  reviewerId?: number | null
  parentTaskId?: number | null
  wbsNodeId?: number | null
  milestoneId?: number | null
  costEstimateCents?: number
  costActualCents?: number
  progressPercent?: number
  customFields?: Record<string, unknown> | null
}

/** 任务列表查询参数（对齐 listTasksValidator）。 */
export interface ListTasksQuery {
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  sort?: string
  page?: number
  perPage?: number
}
