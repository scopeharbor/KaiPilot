import { apiFetchEnvelope } from '@/lib/api-client'

export type ChangeRequestType =
  'scope' | 'schedule' | 'cost' | 'resource' | 'quality' | 'risk' | 'other'

export type ChangeRequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'returned'
  | 'implemented'
  | 'closed'
  | 'cancelled'

export type ChangeRequestPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface ChangeRequestImpactSummary {
  scope?: string
  schedule?: string
  resources?: string
  cost?: string
  risks?: string
  assumptions?: string
}

export interface ChangeRequest {
  id: number
  crCode: string
  organizationId: number
  projectId: number
  title: string
  description: string | null
  changeType: ChangeRequestType
  status: ChangeRequestStatus
  priority: ChangeRequestPriority
  requesterId: number | null
  approverId: number | null
  requestedBy: number | null
  reviewedBy: number | null
  impactSummary: ChangeRequestImpactSummary | null
  impactAnalysis: Record<string, unknown> | null
  conditions: string | null
  decisionReason: string | null
  approvalComments: string | null
  submittedAt: string | null
  approvedAt: string | null
  implementedAt: string | null
  implementedBy: number | null
  closedAt: string | null
  closedBy: number | null
  createdAt: string
  updatedAt: string
  // V2 影响分析引用
  currentImpactAnalysisId?: number | null
  approveRefAnalysisId?: number | null
  impactAnalysisConfirmStatus?: string | null
}

export interface ChangeRequestListFilters {
  status?: ChangeRequestStatus
  changeType?: ChangeRequestType
  priority?: ChangeRequestPriority
  requesterId?: number
  sort?: string
  page?: number
  perPage?: number
  startDate?: string
  endDate?: string
}

export interface ChangeRequestListResponse {
  data: ChangeRequest[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

function qs(filters: ChangeRequestListFilters): string {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.changeType) params.set('changeType', filters.changeType)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.requesterId) params.set('requesterId', String(filters.requesterId))
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  if (filters.startDate) params.set('startDate', filters.startDate)
  if (filters.endDate) params.set('endDate', filters.endDate)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const changeRequestKeys = {
  all: ['change-requests'] as const,
  lists: (projectId: number) => [...changeRequestKeys.all, 'list', projectId] as const,
  list: (projectId: number, filters: ChangeRequestListFilters) =>
    [...changeRequestKeys.lists(projectId), filters] as const,
  details: () => [...changeRequestKeys.all, 'detail'] as const,
  detail: (id: number) => [...changeRequestKeys.details(), id] as const,
}

export async function listChangeRequests(
  projectId: number,
  filters: ChangeRequestListFilters = {},
): Promise<ChangeRequestListResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/change-requests${qs(filters)}`)
}

export async function getChangeRequest(id: number): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}`)
}

export async function createChangeRequest(
  projectId: number,
  data: {
    title: string
    description?: string
    changeType?: ChangeRequestType
    priority?: ChangeRequestPriority
    impactSummary?: ChangeRequestImpactSummary
  },
): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/projects/${projectId}/change-requests`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateChangeRequest(
  id: number,
  data: Partial<
    Pick<ChangeRequest, 'title' | 'description' | 'changeType' | 'priority' | 'impactSummary'>
  >,
): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function submitChangeRequest(id: number): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/submit`, { method: 'POST' })
}

export async function approveChangeRequest(
  id: number,
  data?: {
    decisionReason?: string
    conditions?: string
    // V2 审批时可选引用影响分析快照（v2-change-management-impact-analysis §6.4/8.5）
    impactAnalysisId?: number | null
    confirmStaleReason?: string | null
  },
): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

export async function rejectChangeRequest(
  id: number,
  data?: {
    decisionReason?: string
    impactAnalysisId?: number | null
    confirmStaleReason?: string | null
  },
): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

export async function returnChangeRequest(
  id: number,
  data?: { decisionReason?: string },
): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/return`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

export async function markImplementedChangeRequest(id: number): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/mark-implemented`, { method: 'POST' })
}

export async function closeChangeRequest(id: number): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/close`, { method: 'POST' })
}

export async function cancelChangeRequest(id: number): Promise<{ data: ChangeRequest }> {
  return apiFetchEnvelope(`/change-requests/${id}/cancel`, { method: 'POST' })
}

export interface AiImpactSuggestion {
  suggestions: Record<string, string>
  confidence: number
  source: string
  assumptions: string[]
  needsConfirmation: boolean
}

export async function getAiImpactSuggestions(id: number): Promise<{ data: AiImpactSuggestion }> {
  return apiFetchEnvelope(`/change-requests/${id}/ai-impact`, { method: 'POST' })
}

// ===== V2 影响分析 API（v2-change-management-impact-analysis）=====

export type ChangeImpactSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none'
export type ChangeImpactDimension =
  'scope' | 'schedule' | 'resource' | 'risk' | 'quality' | 'assumption' | 'related_object'
export type ChangeImpactAnalysisStatus = 'pending' | 'completed' | 'failed' | 'stale'
export type ImpactRuleId =
  'R001' | 'R002' | 'R003' | 'R004' | 'R005' | 'R006' | 'R007' | 'R008' | 'R009'
export interface ChangeImpactAnalysisScope {
  dimensions?: ChangeImpactDimension[]
  maxPropagationDepth?: number
  includeEvidenceDetails?: boolean
  includeRelatedObjects?: boolean
}

export interface PropagationPathEntry {
  fromEntityType: string
  fromEntityId: number
  toEntityType: string
  toEntityId: number
  relationshipType: string
  relationshipId: number | null
}

export interface ChangeImpactWarning {
  code: string
  message: string
  dimension?: ChangeImpactDimension
}

export interface ChangeImpactSummary {
  totalAffected: number
  severityDistribution: Record<ChangeImpactSeverity, number>
  dimensionSummaries: Array<{
    dimension: ChangeImpactDimension
    affectedCount: number
    highestSeverity: ChangeImpactSeverity
    topEvidence: string[]
  }>
  criticalPathAffected: boolean
  hasBlockingWarnings: boolean
}

export interface ChangeImpactItem {
  id: number | null
  entityType: string
  entityId: number
  dimension: ChangeImpactDimension
  severity: ChangeImpactSeverity
  score: number
  propagationPath: PropagationPathEntry[] | null
  depth: number
  ruleId: ImpactRuleId
  evidence: string | null
  requiresReview: boolean
  isVisible: boolean
}

export interface ChangeImpactAnalysis {
  id: number
  organizationId: number
  projectId: number
  changeRequestId: number
  status: ChangeImpactAnalysisStatus
  ruleVersion: string
  inputSignature: string
  summary: ChangeImpactSummary | null
  items: ChangeImpactItem[]
  warnings: ChangeImpactWarning[] | null
  missingInputs: Array<{
    dimension: ChangeImpactDimension
    reason: string
    requiredData: string
  }> | null
  isStale: boolean
  staleReason: string | null
  aiExplanation: { summary: string; confidence: number; needsConfirmation: boolean } | null
  confirmedBy: number | null
  confirmedAt: string | null
  createdAt: string
}

export async function createImpactAnalysis(
  projectId: number,
  changeRequestId: number,
  scope?: ChangeImpactAnalysisScope,
): Promise<{ data: ChangeImpactAnalysis }> {
  return apiFetchEnvelope(
    `/projects/${projectId}/change-requests/${changeRequestId}/impact-analyses`,
    {
      method: 'POST',
      body: JSON.stringify({ scope }),
    },
  )
}

export async function listImpactAnalyses(
  projectId: number,
  changeRequestId: number,
  page?: number,
): Promise<{
  data: ChangeImpactAnalysis[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}> {
  const params = page ? `?page=${page}` : ''
  return apiFetchEnvelope(
    `/projects/${projectId}/change-requests/${changeRequestId}/impact-analyses${params}`,
  )
}

export async function getImpactAnalysis(
  id: number,
  _projectId: number,
): Promise<{ data: ChangeImpactAnalysis }> {
  return apiFetchEnvelope(`/impact-analyses/${id}`)
}

export async function refreshImpactAnalysis(
  id: number,
  _projectId: number,
): Promise<{ data: ChangeImpactAnalysis }> {
  return apiFetchEnvelope(`/impact-analyses/${id}/refresh`, { method: 'POST' })
}

export async function confirmImpactAnalysis(
  id: number,
  _projectId: number,
  reason?: string,
): Promise<{ data: ChangeImpactAnalysis }> {
  return apiFetchEnvelope(`/impact-analyses/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function confirmStaleImpactAnalysis(
  id: number,
  _projectId: number,
  reason: string,
): Promise<{ data: ChangeImpactAnalysis }> {
  return apiFetchEnvelope(`/impact-analyses/${id}/confirm-stale`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

export async function generateAiExplanation(
  id: number,
  _projectId: number,
  focus?: string,
): Promise<{ data: { summary: string; confidence: number; needsConfirmation: boolean } }> {
  return apiFetchEnvelope(`/impact-analyses/${id}/ai-explanation`, {
    method: 'POST',
    body: JSON.stringify({ focus }),
  })
}

export const impactAnalysisKeys = {
  all: ['impact-analyses'] as const,
  lists: (projectId: number, crId: number) =>
    [...impactAnalysisKeys.all, 'list', projectId, crId] as const,
  list: (projectId: number, crId: number, page: number) =>
    [...impactAnalysisKeys.lists(projectId, crId), page] as const,
  details: () => [...impactAnalysisKeys.all, 'detail'] as const,
  detail: (analysisId: number) => [...impactAnalysisKeys.details(), analysisId] as const,
}
