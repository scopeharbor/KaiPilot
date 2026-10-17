import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type { AssigneeType, AgentAssignment } from '@/types/agent-assignee'

/** 任务 6 状态状态机（对齐后端 task_status_machine）。 */
export type TaskStatus =
  'not_started' | 'in_progress' | 'completed' | 'blocked' | 'on_hold' | 'cancelled'

export type TaskPriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest'
export type TaskType = 'task' | 'milestone' | 'summary' | 'deliverable'

export interface TaskUserRef {
  id: number
  fullName: string | null
  email: string
  initials: string
}

/** 任务对象（对齐后端 TaskDto）。 */
export interface Task {
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
  kanbanRank?: number | null
  assigneeId: number | null
  /** v3-copilot-agent-as-assignee：负责人类别（user | agent），缺省 'user' 向后兼容。 */
  assigneeType?: AssigneeType
  /** v3-copilot-agent-as-assignee：agent 负责人详情（仅 assigneeType='agent' 时存在）。 */
  agentAssignee?: AgentAssignment
  reviewerId: number | null
  parentTaskId: number | null
  wbsNodeId: number | null
  milestoneId: number | null
  costEstimateCents: number | null
  costActualCents: number | null
  customFields: Record<string, unknown> | null
  /** AI 草案标注的建议岗位（如「后端开发」「安全、运维」）。 */
  roleHint?: string | null
  subtaskCount?: number
  dependencyCount?: number
  commentCount?: number
  assignee?: TaskUserRef
  reviewer?: TaskUserRef
  parent?: { id: number; name: string; status: TaskStatus }
  subtasks?: Task[]
  createdAt: string
  updatedAt: string | null
}

export interface PaginatedTasks {
  data: Task[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TaskListFilters {
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: number
  search?: string
  /** AI 建议岗位包含该文本。 */
  roleHint?: string
  dateFrom?: string
  dateTo?: string
  sort?: string
  page?: number
  perPage?: number
}

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

export type UpdateTaskInput = Omit<Partial<CreateTaskInput>, 'assigneeId' | 'reviewerId'> & {
  /** 可传 null 清空负责人（后端 update 校验为 nullable）。 */
  assigneeId?: number | null
  reviewerId?: number | null
  actualHours?: number
  costActualCents?: number
  progressPercent?: number
}

export interface ChangeTaskStatusInput {
  status: TaskStatus
  actualHours?: number
  progressPercent?: number
  note?: string
}

export type TaskBatchInput =
  | {
      action: 'update'
      taskIds: number[]
      data: {
        priority?: TaskPriority
        startDate?: string
        endDate?: string
        estimatedHours?: number
        progressPercent?: number
        reviewerId?: number | null
      }
    }
  | { action: 'reassign'; taskIds: number[]; data: { assigneeId: number | null } }
  | { action: 'change_status'; taskIds: number[]; data: ChangeTaskStatusInput }
  | { action: 'delete'; taskIds: number[] }

export interface TaskBatchItemResult {
  taskId: number
  success: boolean
  task?: Task
  error?: { code: string; message: string }
}

export interface TaskBatchResult {
  action: TaskBatchInput['action'] | 'restore'
  total: number
  successCount: number
  failedCount: number
  results: TaskBatchItemResult[]
}

export interface RecycleBinTask {
  id: number
  projectId: number
  name: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: number | null
  deletedAt: string
}

export interface RecycleBinFilters {
  search?: string
  sort?: '-deletedAt' | '+deletedAt' | '+name' | '-name'
  page?: number
  perPage?: number
}

export interface PaginatedRecycleBinTasks {
  data: RecycleBinTask[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function buildQuery(filters: TaskListFilters | RecycleBinFilters): string {
  const query = new URLSearchParams()
  if ('status' in filters && filters.status) query.set('status', filters.status)
  if ('priority' in filters && filters.priority) query.set('priority', filters.priority)
  if ('assigneeId' in filters && filters.assigneeId) {
    query.set('assigneeId', String(filters.assigneeId))
  }
  if (filters.search) query.set('search', filters.search)
  if ('roleHint' in filters && filters.roleHint) query.set('roleHint', filters.roleHint)
  if ('dateFrom' in filters && filters.dateFrom) query.set('dateFrom', filters.dateFrom)
  if ('dateTo' in filters && filters.dateTo) query.set('dateTo', filters.dateTo)
  if (filters.sort) query.set('sort', filters.sort)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}

const base = (projectId: number) => `/projects/${projectId}/tasks`

export const tasksApi = {
  list: (projectId: number, filters: TaskListFilters = {}) =>
    apiFetchEnvelope<PaginatedTasks>(`${base(projectId)}${buildQuery(filters)}`),
  get: (projectId: number, taskId: number) => apiFetch<Task>(`${base(projectId)}/${taskId}`),
  /** 本项目的 AI 建议岗位及任务数（列表岗位筛选下拉）。 */
  roleHints: (projectId: number) =>
    apiFetch<Array<{ role: string; count: number }>>(`${base(projectId)}/role-hints`),
  create: (projectId: number, input: CreateTaskInput) =>
    apiFetch<Task>(base(projectId), { method: 'POST', body: JSON.stringify(input) }),
  update: (projectId: number, taskId: number, input: UpdateTaskInput) =>
    apiFetch<Task>(`${base(projectId)}/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** 同 update，另带服务端提示（如「已按依赖自动顺延 N 个后续任务」）。 */
  updateWithWarnings: async (projectId: number, taskId: number, input: UpdateTaskInput) => {
    const envelope = await apiFetchEnvelope<{ data: Task; meta?: { warnings?: string[] } }>(
      `${base(projectId)}/${taskId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    )
    return { task: envelope.data, warnings: envelope.meta?.warnings ?? [] }
  },
  delete: (projectId: number, taskId: number) =>
    apiFetch<void>(`${base(projectId)}/${taskId}`, { method: 'DELETE' }),
  restore: (projectId: number, taskId: number) =>
    apiFetch<Task>(`${base(projectId)}/${taskId}/restore`, { method: 'POST' }),
  changeStatus: (projectId: number, taskId: number, input: ChangeTaskStatusInput) =>
    apiFetch<Task>(`${base(projectId)}/${taskId}/status`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  batch: (projectId: number, input: TaskBatchInput) =>
    apiFetch<TaskBatchResult>(`${base(projectId)}/batch`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listRecycleBin: (projectId: number, filters: RecycleBinFilters = {}) =>
    apiFetchEnvelope<PaginatedRecycleBinTasks>(
      `${base(projectId)}/recycle-bin${buildQuery(filters)}`,
    ),
  batchRestore: (projectId: number, taskIds: number[]) =>
    apiFetch<TaskBatchResult>(`${base(projectId)}/batch-restore`, {
      method: 'POST',
      body: JSON.stringify({ taskIds }),
    }),
}

/**
 * TanStack Query 分层 keys：列表按 project+filters、单任务按 id、
 * 状态变更与聚合按 id+域，便于精准 invalidate。
 */
export const taskKeys = {
  all: ['tasks'] as const,
  lists: (projectId: number) => [...taskKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: TaskListFilters) =>
    [...taskKeys.lists(projectId), filters] as const,
  details: (projectId: number) => [...taskKeys.all, 'detail', projectId] as const,
  detail: (projectId: number, taskId: number) => [...taskKeys.details(projectId), taskId] as const,
  recycleBins: (projectId: number) => [...taskKeys.all, 'recycle-bin', projectId] as const,
  recycleBin: (projectId: number, filters: RecycleBinFilters) =>
    [...taskKeys.recycleBins(projectId), filters] as const,
  views: (projectId: number) => [...taskKeys.all, 'view', projectId] as const,
  view: (projectId: number, view: string, filters?: unknown) =>
    [...taskKeys.views(projectId), view, filters] as const,
}
