/**
 * 项目利害关系人只读 API SDK（v3-chart-gallery-tier2-governance-matrices W1 · task 1.1）。
 *
 * 对接 `ProjectStakeholdersController` 已就绪的只读端点（RL-06 零写库）：
 * - `GET /api/v1/projects/:projectId/stakeholders?view=quadrant`（四象限聚合视图）
 * - `GET /api/v1/projects/:projectId/stakeholders`（登记底册分页列表）
 */
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

export type StakeholderType = 'internal' | 'external'
export type StakeholderLevel = 'low' | 'medium' | 'high'
export type StakeholderAttitude = 'supportive' | 'neutral' | 'resistant' | 'leading'
export type StakeholderStrategy = 'manage_closely' | 'keep_satisfied' | 'keep_informed' | 'monitor'

export type QuadrantBucketKey = 'manageClosely' | 'keepSatisfied' | 'keepInformed' | 'monitor'

export interface StakeholderItem {
  id: number
  organizationId: number
  projectId: number
  userId: number | null
  name: string
  organizationName: string | null
  roleTitle: string | null
  stakeholderType: StakeholderType
  powerLevel: StakeholderLevel
  interestLevel: StakeholderLevel
  attitude: StakeholderAttitude
  expectations: string | null
  managementStrategy: StakeholderStrategy
  contactInfo: Record<string, string>
}

export interface StakeholderQuadrantData {
  summary: Record<QuadrantBucketKey, number>
  quadrants: Record<QuadrantBucketKey, StakeholderItem[]>
}

export interface PaginatedStakeholders {
  data: StakeholderItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface StakeholderListFilters {
  stakeholderType?: StakeholderType
  powerLevel?: StakeholderLevel
  interestLevel?: StakeholderLevel
  attitude?: StakeholderAttitude
  page?: number
  perPage?: number
}

export const STAKEHOLDER_ATTITUDE_LABELS: Record<StakeholderAttitude, string> = {
  supportive: '支持',
  neutral: '中立',
  resistant: '抵制',
  leading: '主导',
}

export const STAKEHOLDER_STRATEGY_LABELS: Record<StakeholderStrategy, string> = {
  manage_closely: '重点管理',
  keep_satisfied: '令其满意',
  keep_informed: '随时告知',
  monitor: '监督监测',
}

export const QUADRANT_BUCKET_TITLES: Record<QuadrantBucketKey, string> = {
  manageClosely: '重点管理 (Manage Closely)',
  keepSatisfied: '令其满意 (Keep Satisfied)',
  keepInformed: '随时告知 (Keep Informed)',
  monitor: '监督监测 (Monitor)',
}

function buildQuery(filters: StakeholderListFilters): string {
  const query = new URLSearchParams()
  if (filters.stakeholderType) query.set('stakeholderType', filters.stakeholderType)
  if (filters.powerLevel) query.set('powerLevel', filters.powerLevel)
  if (filters.interestLevel) query.set('interestLevel', filters.interestLevel)
  if (filters.attitude) query.set('attitude', filters.attitude)
  if (filters.page) query.set('page', String(filters.page))
  if (filters.perPage) query.set('perPage', String(filters.perPage))
  return query.size ? `?${query.toString()}` : ''
}

const base = (projectId: number) => `/projects/${projectId}/stakeholders`

export const stakeholdersApi = {
  quadrant: (projectId: number) =>
    apiFetch<StakeholderQuadrantData>(`${base(projectId)}?view=quadrant`),
  list: (projectId: number, filters: StakeholderListFilters = {}) =>
    apiFetchEnvelope<PaginatedStakeholders>(`${base(projectId)}${buildQuery(filters)}`),
}

export const stakeholderKeys = {
  all: ['stakeholders'] as const,
  quadrant: (projectId: number) => [...stakeholderKeys.all, 'quadrant', projectId] as const,
  lists: (projectId: number) => [...stakeholderKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: StakeholderListFilters = {}) =>
    [...stakeholderKeys.lists(projectId), filters] as const,
}
