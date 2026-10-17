import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'

export type RiskCategory =
  'technical' | 'schedule' | 'cost' | 'resource' | 'external' | 'organizational' | 'legal' | 'other'

export type RiskStatus =
  'identified' | 'analyzing' | 'mitigating' | 'resolved' | 'accepted' | 'closed'

export interface AiMarker {
  confidence: number
  source: 'inferred' | 'explicit' | 'default'
  reason: string
  needsConfirmation: boolean
}

export interface Risk {
  id: number
  organizationId: number
  projectId: number
  riskCode: string | null
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  score: number
  status: RiskStatus
  mitigationStrategy: string | null
  contingencyPlan: string | null
  ownerId: number | null
  triggerEvent: string | null
  residualProbability: number | null
  residualImpact: number | null
  residualScore: number | null
  // V2 扩展
  riskLevel?: string
  priority?: string
  triggerCondition?: string | null
  nextReviewAt?: string | null
  lastReviewAt?: string | null
  closedReason?: string | null
  closedNotes?: string | null
  identifiedAt: string
  targetResolutionDate: string | null
  resolvedAt: string | null
  relatedTaskId: number | null
  aiMetadata: {
    aiMarker?: AiMarker
    suggestionBatchId?: string
    sourceDraftId?: string
    sourceDraftVersion?: number
  } | null
  createdBy: number
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RiskMatrixCell {
  probability: number
  impact: number
  count: number
  topRiskIds: number[]
}

export interface RiskAiSuggestion {
  title: string
  description: string
  category: RiskCategory
  probability: number
  impact: number
  suggestedMitigation: string
  aiMarker: AiMarker
  suggestionBatchId: string
}

export interface RiskListFilters {
  category?: RiskCategory
  status?: RiskStatus
  ownerId?: number
  minScore?: number
  maxScore?: number
  search?: string
  sort?: string
  page?: number
  perPage?: number
}

export interface RiskListResponse {
  data: Risk[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface RiskMatrixResponse {
  data: { cells: RiskMatrixCell[] }
}

export interface RiskAiSuggestionsResponse {
  data: { suggestions: RiskAiSuggestion[]; suggestionBatchId: string }
}

function qs(filters: RiskListFilters): string {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.status) params.set('status', filters.status)
  if (filters.ownerId) params.set('ownerId', String(filters.ownerId))
  if (filters.minScore) params.set('minScore', String(filters.minScore))
  if (filters.maxScore) params.set('maxScore', String(filters.maxScore))
  if (filters.search) params.set('search', filters.search)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.perPage) params.set('perPage', String(filters.perPage))
  const s = params.toString()
  return s ? `?${s}` : ''
}

export async function listRisks(
  projectId: number,
  filters: RiskListFilters = {},
): Promise<RiskListResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/risks${qs(filters)}`)
}

export async function getRisk(_projectId: number, riskId: number): Promise<{ data: Risk }> {
  return apiFetchEnvelope(`/risks/${riskId}`)
}

export async function createRisk(
  projectId: number,
  data: Partial<Risk> & { title: string; description: string },
): Promise<{ data: Risk }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateRisk(
  _projectId: number,
  riskId: number,
  data: Partial<Risk>,
): Promise<{ data: Risk }> {
  return apiFetchEnvelope(`/risks/${riskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deleteRisk(_projectId: number, riskId: number): Promise<void> {
  return apiFetch(`/risks/${riskId}`, { method: 'DELETE' })
}

export async function transitionRiskStatus(
  _projectId: number,
  riskId: number,
  status: RiskStatus,
): Promise<{ data: Risk }> {
  return apiFetchEnvelope(`/risks/${riskId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

export async function getRiskMatrix(
  projectId: number,
  basis: 'inherent' | 'residual' = 'inherent',
): Promise<RiskMatrixResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/matrix?basis=${basis}`)
}

export async function triggerAiSuggestions(projectId: number): Promise<RiskAiSuggestionsResponse> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/ai-suggestions`, {
    method: 'POST',
  })
}

export async function acceptAiSuggestion(
  projectId: number,
  data: {
    title: string
    description: string
    category: RiskCategory
    probability: number
    impact: number
    mitigation?: string
    aiMarker: AiMarker
    suggestionBatchId: string
    modifiedByUser?: boolean
  },
): Promise<{ data: Risk }> {
  return apiFetchEnvelope(
    `/projects/${projectId}/risks/ai-suggestions/${data.suggestionBatchId}/accept`,
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
  )
}

export async function rejectAiSuggestion(projectId: number, batchId: string): Promise<void> {
  return apiFetch(`/projects/${projectId}/risks/ai-suggestions/${batchId}/reject`, {
    method: 'POST',
  })
}
