import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

/** 里程碑五状态生命周期（对齐后端 milestones 表 CHECK 与 MilestoneStatus）。 */
export type MilestoneStatus = 'not_started' | 'planned' | 'at_risk' | 'achieved' | 'missed'

/** 里程碑对象（对齐后端 MilestoneDto）。 */
export interface Milestone {
  id: number
  projectId: number
  name: string
  description: string | null
  /** 推导后的展示态（含 at_risk/missed 叠加，供着色）。 */
  status: MilestoneStatus
  /** 持久化的人工态（编辑表单回填，避免把推导态误当人工设定）。 */
  storedStatus: MilestoneStatus
  plannedDate: string | null
  /** 展示态是否为系统推导的建议态（display ≠ stored）。 */
  autoCalculated: boolean
  displayOrder: number
  createdAt: string
  updatedAt: string | null
}

export interface PaginatedMilestones {
  data: Milestone[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface MilestoneListFilters {
  status?: MilestoneStatus
  sort?: string
  page?: number
  perPage?: number
}

export interface CreateMilestoneInput {
  name: string
  description?: string | null
  status?: MilestoneStatus
  plannedDate?: string | null
  displayOrder?: number
}

export type UpdateMilestoneInput = Partial<CreateMilestoneInput>

function buildQuery(filters: MilestoneListFilters): string {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.sort) query.set('sort', filters.sort)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}

const nested = (projectId: number) => `/projects/${projectId}/milestones`
const flat = (milestoneId: number) => `/milestones/${milestoneId}`

/**
 * 里程碑 API：列表/创建走嵌套 `/projects/:id/milestones`，
 * 详情/编辑/删除走扁平 `/milestones/:id`（对齐后端路由与 RBAC 守卫）。
 */
export const milestonesApi = {
  list: (projectId: number, filters: MilestoneListFilters = {}) =>
    apiFetchEnvelope<PaginatedMilestones>(`${nested(projectId)}${buildQuery(filters)}`),
  get: (milestoneId: number) => apiFetch<Milestone>(flat(milestoneId)),
  create: (projectId: number, input: CreateMilestoneInput) =>
    apiFetch<Milestone>(nested(projectId), { method: 'POST', body: JSON.stringify(input) }),
  update: (milestoneId: number, input: UpdateMilestoneInput) =>
    apiFetch<Milestone>(flat(milestoneId), { method: 'PATCH', body: JSON.stringify(input) }),
  delete: (milestoneId: number) => apiFetch<void>(flat(milestoneId), { method: 'DELETE' }),
}

/**
 * TanStack Query 分层 keys：列表按 project+filters、单里程碑按 id，
 * 便于精准 invalidate（写操作后同时失效列表与甘特 model）。
 */
export const milestoneKeys = {
  all: ['milestones'] as const,
  lists: (projectId: number) => [...milestoneKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: MilestoneListFilters) =>
    [...milestoneKeys.lists(projectId), filters] as const,
  details: () => [...milestoneKeys.all, 'detail'] as const,
  detail: (milestoneId: number) => [...milestoneKeys.details(), milestoneId] as const,
}
