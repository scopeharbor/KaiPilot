import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  ContradictionDashboardSummary,
  DashboardMeta,
  DashboardMetric,
  DashboardWarning,
  DashboardHealthSummary,
  InnovationDashboardSummaryResponse,
  WorkingCalendarSettings,
} from '@aiproj/types'

/** 项目状态（七态）。 */
export type ProjectStatus =
  'draft' | 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled' | 'archived'

export type ProjectPriority = 'low' | 'medium' | 'high' | 'critical'

export interface Project {
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
  budgetCents: number | null
  currency: string | null
  progressPercent: number
  healthStatus: string
  settings: Record<string, unknown> | null
  createdBy: number
  updatedBy: number | null
  createdAt: string
  updatedAt: string
  stats?: { memberCount: number; taskCount: number; milestoneCount: number }
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

export interface PaginatedProjects {
  data: Project[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ProjectRole {
  id: number
  projectId: number
  name: string
  description: string | null
  permissions: string[]
  isSystem: boolean
}

export interface ProjectMember {
  id: number
  projectId: number
  userId: number
  projectRoleId: number | null
  isActive: boolean
  user?: {
    id: number
    fullName: string | null
    email: string
    initials: string
    isActive: boolean
  }
  projectRole?: {
    id: number
    name: string
    description: string | null
    permissions: string[]
    isSystem: boolean
  }
  /** 本项目负载：未完成 / 进行中任务数（成员列表接口附带）。 */
  workload?: { openTaskCount: number; inProgressTaskCount: number }
  /** 其任务中最常见的 AI 建议岗位（如「后端开发」），作为岗位提示。 */
  primaryRoleHint?: string | null
  // 后端 projectMemberDto 恒返回创建/更新时间（成员底册「加入时间」列消费，
  // v3-ui-next-resource-team-domains W2 · tasks 2.3）。
  createdAt?: string | null
  updatedAt?: string | null
}

export interface ProjectDashboard {
  stats: {
    healthStatus: string
    progressPercent: number
    taskStatusDistribution: Record<string, number>
    memberCount: number
    milestoneStatusDistribution: Record<string, number>
    startDate: string | null
    endDate: string | null
    remainingDays: number | null
  }
  recentActivity: Array<{
    id: number
    action: string
    event: string | null
    severity: string
    userId: number | null
    entityType: string | null
    entityId: number | null
    createdAt: string
  }>
  metrics: DashboardMetric[]
  meta: DashboardMeta
  warnings: DashboardWarning[]
  healthDiagnosis?: DashboardHealthSummary
  contradictionSummary?: ContradictionDashboardSummary
  trizInnovationWorkbenchSummary?: InnovationDashboardSummaryResponse['data']
}

export interface ProjectListFilters {
  status?: string
  priority?: string
  search?: string
  sort?: string
  page?: number
  perPage?: number
  includeArchived?: boolean
}

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
  settings?: Record<string, unknown> | null
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

export type UpdateProjectInput = Partial<CreateProjectInput>

function buildQuery(filters: ProjectListFilters): string {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.priority) query.set('priority', filters.priority)
  if (filters.search) query.set('search', filters.search)
  if (filters.sort) query.set('sort', filters.sort)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  if (filters.includeArchived) query.set('includeArchived', 'true')
  return query.size ? `?${query.toString()}` : ''
}

export const projectsApi = {
  list: (filters: ProjectListFilters = {}) =>
    apiFetchEnvelope<PaginatedProjects>(`/projects${buildQuery(filters)}`),
  get: (id: number) => apiFetch<Project>(`/projects/${id}`),
  create: (input: CreateProjectInput) =>
    apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: UpdateProjectInput) =>
    apiFetch<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  delete: (id: number, force = false) =>
    apiFetch<void>(`/projects/${id}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  archive: (id: number) => apiFetch<Project>(`/projects/${id}/archive`, { method: 'POST' }),
  restore: (id: number) => apiFetch<Project>(`/projects/${id}/restore`, { method: 'POST' }),
  getWorkingCalendar: (id: number) =>
    apiFetch<WorkingCalendarSettings>(`/projects/${id}/working-calendar`),
  updateWorkingCalendar: (id: number, input: WorkingCalendarSettings) =>
    apiFetch<WorkingCalendarSettings>(`/projects/${id}/working-calendar`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
}

export const projectMembersApi = {
  list: (projectId: number) => apiFetch<ProjectMember[]>(`/projects/${projectId}/members`),
  listRoles: (projectId: number) => apiFetch<ProjectRole[]>(`/projects/${projectId}/roles`),
  /** 当前用户在本项目内的有效权限（含项目角色下放的管理权限）。 */
  myPermissions: (projectId: number) =>
    apiFetch<{ permissions: string[] }>(`/projects/${projectId}/my-permissions`),
  add: (projectId: number, input: { userId: number; projectRoleId: number }) =>
    apiFetch<ProjectMember>(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  invite: (projectId: number, input: { email: string; projectRoleId: number }) =>
    apiFetch<ProjectMember>(`/projects/${projectId}/members/invite`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  changeRole: (projectId: number, userId: number, projectRoleId: number) =>
    apiFetch<ProjectMember>(`/projects/${projectId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ projectRoleId }),
    }),
  remove: (projectId: number, userId: number) =>
    apiFetch<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
  transferOwner: (projectId: number, userId: number) =>
    apiFetch<{ project: Project; previousOwnerId: number; newOwnerId: number }>(
      `/projects/${projectId}/transfer-owner`,
      { method: 'POST', body: JSON.stringify({ userId }) },
    ),
}

export const projectDashboardApi = {
  get: (projectId: number) => apiFetch<ProjectDashboard>(`/projects/${projectId}/dashboard`),
}

/**
 * TanStack Query 分层 keys（design D12）。
 * 工厂保证 invalidate 粒度：列表按 org+filters、单项目按 id、子集合按 id+域。
 */
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (organizationId: number, filters: ProjectListFilters) =>
    [...projectKeys.lists(), organizationId, filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: number) => [...projectKeys.details(), id] as const,
  dashboard: (id: number) => [...projectKeys.detail(id), 'dashboard'] as const,
  workingCalendar: (id: number) => [...projectKeys.detail(id), 'working-calendar'] as const,
  members: (id: number) => [...projectKeys.detail(id), 'members'] as const,
  roles: (id: number) => [...projectKeys.detail(id), 'roles'] as const,
  myPermissions: (id: number) => [...projectKeys.detail(id), 'my-permissions'] as const,
}
