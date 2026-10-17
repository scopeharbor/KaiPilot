/**
 /**
  * 需求与 RTM 追溯矩阵只读 API SDK（v3-chart-gallery-tier2-governance-matrices W1 · task 1.1）。
  *
  * 对接 `RequirementsController.rtmMatrix` 已就绪的只读聚合端点（RL-06 零写库）：
  * `GET /api/v1/projects/:projectId/requirements/rtm-matrix`。响应信封为 `{ data: RtmMatrixResult }`，
  * `apiFetch` 统一解包，此处直接声明解包后的数据契约（与后端服务类型逐字对齐）。
  */
import { apiFetch } from '@/lib/api-client'

export interface AcceptanceCriterion {
  id: string
  description: string
  status: 'pending' | 'passed' | 'failed'
}

export interface RtmLinkedTask {
  id: number
  name: string
  status: string
  assigneeName: string | null
  progressPercent: number
}

export interface RtmMatrixEntry {
  requirementId: number
  code: string
  title: string
  category: string
  priority: string
  status: string
  acceptanceCriteria: AcceptanceCriterion[]
  criteriaPassRate: number
  linkedTasks: RtmLinkedTask[]
}

export interface RtmMatrixResult {
  projectId: number
  totalRequirements: number
  coveragePercent: number
  matrix: RtmMatrixEntry[]
}

const base = (projectId: number) => `/projects/${projectId}/requirements`

export const requirementsApi = {
  rtmMatrix: (projectId: number) => apiFetch<RtmMatrixResult>(`${base(projectId)}/rtm-matrix`),
}

export const requirementKeys = {
  all: ['requirements'] as const,
  rtmMatrix: (projectId: number) => [...requirementKeys.all, 'rtm-matrix', projectId] as const,
}
