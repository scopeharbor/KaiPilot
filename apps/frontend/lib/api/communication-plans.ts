/**
 * 沟通管理计划只读 API SDK（v3-chart-gallery-tier2-org-contract-plans W1 · task 1.1）。
 *
 * 对接 `CommunicationPlansController` 已就绪的只读端点（RL-06 零写库）：
 * - `GET /api/v1/projects/:projectId/communication-plans`（支持分页与多维过滤）
 */
import { apiFetchEnvelope } from '@/lib/api-client'

export type CommunicationType = 'meeting' | 'report' | 'email' | 'instant_message'

export type CommunicationFrequency =
  'daily' | 'weekly' | 'biweekly' | 'monthly' | 'milestone_driven' | 'ad_hoc'

export type CommunicationChannel =
  'in_person' | 'video_conference' | 'email' | 'wechat_work' | 'feishu' | 'pdf_export'

export interface CommunicationPlanItem {
  id: number
  organizationId: number
  projectId: number
  ownerId: number
  name: string
  communicationType: CommunicationType
  purpose: string
  frequency: CommunicationFrequency
  channel: CommunicationChannel
  audience: string
  deliverable: string | null
  reportTemplateKey: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string | null
}

export interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

export interface PaginatedCommunicationPlans {
  data: CommunicationPlanItem[]
  meta: PaginationMeta
}

export interface CommunicationPlanListFilters {
  communicationType?: CommunicationType
  frequency?: CommunicationFrequency
  channel?: CommunicationChannel
  isActive?: boolean
  search?: string
  sort?: string
  page?: number
  perPage?: number
}

function buildQuery(filters: CommunicationPlanListFilters): string {
  const query = new URLSearchParams()
  if (filters.communicationType) query.set('communicationType', filters.communicationType)
  if (filters.frequency) query.set('frequency', filters.frequency)
  if (filters.channel) query.set('channel', filters.channel)
  if (filters.isActive !== undefined) query.set('isActive', String(filters.isActive))
  if (filters.search) query.set('search', filters.search)
  if (filters.sort) query.set('sort', filters.sort)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}

const base = (projectId: number) => `/projects/${projectId}/communication-plans`

export const communicationPlansApi = {
  list: (projectId: number, filters: CommunicationPlanListFilters = {}) =>
    apiFetchEnvelope<PaginatedCommunicationPlans>(`${base(projectId)}${buildQuery(filters)}`),
}

export const communicationPlanKeys = {
  all: ['communication-plans'] as const,
  lists: (projectId: number) => [...communicationPlanKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: CommunicationPlanListFilters = {}) =>
    [...communicationPlanKeys.lists(projectId), filters] as const,
}
