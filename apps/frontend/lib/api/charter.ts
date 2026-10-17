/**
 * 项目章程只读 API SDK（v3-chart-gallery-tier2-org-contract-plans W1 · task 1.1）。
 *
 * 对接 `ProjectChartersController` 只读端点（RL-06 零写库）：
 * - `GET /api/v1/projects/:projectId/charter`（未创建返回 null）
 */
import { apiFetch } from '@/lib/api-client'

export type ProjectCharterApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected'

export interface ProjectCharterData {
  id: number
  organizationId: number
  projectId: number
  title: string
  vision: string
  scope: string
  /** 关键可衡量目标列表（字符串数组）。 */
  objectives: string[]
  /** 成功验收准则列表（字符串数组）。 */
  successCriteria: string[]
  startDate: string
  endDate: string
  businessCase: string | null
  approvalStatus: ProjectCharterApprovalStatus
  approvedBy: number | null
  approvedAt: string | null
  version: number
  createdBy: number
  updatedBy: number | null
  createdAt: string
  updatedAt: string | null
}

const base = (projectId: number) => `/projects/${projectId}/charter`

export const charterApi = {
  get: (projectId: number) => apiFetch<ProjectCharterData | null>(base(projectId)),
}

export const charterKeys = {
  all: ['charter'] as const,
  detail: (projectId: number) => [...charterKeys.all, 'detail', projectId] as const,
}
