import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type { Risk, RiskListFilters } from './risks'

// ---------------------------------------------------------------------------
// V2 风险工作台类型
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type ResponseStrategyType =
  'avoid' | 'mitigate' | 'transfer' | 'accept' | 'contingency' | 'escalate'
export type ResponsePlanStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled' | 'overdue'
export type CandidateStatus = 'pending' | 'accepted' | 'rejected' | 'expired'
export type TemplateType = 'system' | 'organization'
export type ReviewStatus = 'overdue' | 'upcoming' | 'none'
export type ResponseStatus = 'has_plans' | 'no_plans'

export interface RiskWorkbenchSummary {
  totalRisks: number
  openRisks: number
  highRiskCount: number
  criticalRiskCount: number
  overdueReviewCount: number
  incompleteResponsePlans: number
  trend30d: { created: number; closed: number }
  healthScore: number | null
  topRisks: Array<{
    id: number
    title: string
    riskLevel: RiskLevel
    score: number
    status: string
  }>
}

export interface RiskTrendPoint {
  date: string
  created: number
  closed: number
  totalOpen: number
}

export interface RiskReviewItem {
  id: number
  title: string
  riskLevel: RiskLevel
  score: number
  nextReviewAt: string | null
  lastReviewAt: string | null
  ownerId: number | null
}

export interface RiskResponsePlan {
  id: number
  organizationId: number
  projectId: number
  riskId: number
  strategyType: ResponseStrategyType
  actionDescription: string
  ownerId: number | null
  targetDate: string | null
  status: ResponsePlanStatus
  relatedTaskId: number | null
  completionEvidence: string | null
  completedAt: string | null
  auditLogId: number | null
  createdBy: number
  updatedBy: number | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RiskHistoryEntry {
  id: number
  organizationId: number
  projectId: number
  riskId: number
  eventType: string
  actorId: number | null
  summary: Record<string, unknown> | null
  sourceType: string
  sourceRef: string | null
  occurredAt: string
  createdAt: string
}

export interface RiskMatrixZone {
  name: string
  probabilityFrom: number
  probabilityTo: number
  impactFrom: number
  impactTo: number
  color: string
  level: RiskLevel
}

export interface RiskMatrixConfig {
  id: number
  organizationId: number
  projectId: number
  probabilityLevels: number
  impactLevels: number
  zones: RiskMatrixZone[]
  defaultBasis: 'inherent' | 'residual'
  cellLimit: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface RiskSignalCandidate {
  id: number
  ruleId: string
  ruleVersion: string
  severity: RiskLevel
  evidence: Array<{ type: string; id: number; title: string; detail: string }>
  recommendedAction: string
  confidence: number
  source: string
  templateId: number | null
  idempotencyKey: string
  expiresAt: string
  status: CandidateStatus
}

export interface RiskKnowledgeTemplate {
  id: number
  organizationId: number | null
  title: string
  description: string
  category: string
  isActive: boolean
  templateType: TemplateType
  createdAt: string
}

export type V2RiskListFilters = RiskListFilters & {
  riskLevel?: RiskLevel
  priority?: string
  reviewStatus?: ReviewStatus
  closedReason?: string
  responseStatus?: ResponseStatus
}

// ---------------------------------------------------------------------------
// API 函数
// ---------------------------------------------------------------------------

/** 风险工作台摘要 */
export async function getRiskSummary(projectId: number): Promise<{ data: RiskWorkbenchSummary }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/workbench/summary`)
}

/** 风险趋势 */
export async function getRiskTrend(
  projectId: number,
  days?: number,
): Promise<{ data: RiskTrendPoint[] }> {
  const q = days ? `?days=${days}` : ''
  return apiFetchEnvelope(`/projects/${projectId}/risks/workbench/trend${q}`)
}

/** 复查队列 */
export async function getReviewQueue(projectId: number): Promise<{ data: RiskReviewItem[] }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/workbench/review-queue`)
}

/** 获取矩阵配置 */
export async function getMatrixConfig(projectId: number): Promise<{ data: RiskMatrixConfig }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/matrix-config`)
}

/** 更新矩阵配置 */
export async function updateMatrixConfig(
  projectId: number,
  data: Partial<RiskMatrixConfig>,
): Promise<{ data: RiskMatrixConfig }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/matrix-config`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

/** 列出应对计划 */
export async function listResponsePlans(
  projectId: number,
  riskId: number,
): Promise<{ data: RiskResponsePlan[] }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/${riskId}/response-plans`)
}

/** 创建应对计划 */
export async function createResponsePlan(
  projectId: number,
  riskId: number,
  data: {
    strategyType: string
    actionDescription: string
    ownerId?: number | null
    targetDate?: string | null
  },
): Promise<{ data: RiskResponsePlan }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/${riskId}/response-plans`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 更新应对计划 */
export async function updateResponsePlan(
  projectId: number,
  riskId: number,
  planId: number,
  data: Partial<RiskResponsePlan>,
): Promise<{ data: RiskResponsePlan }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/${riskId}/response-plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/** 删除应对计划 */
export async function deleteResponsePlan(
  projectId: number,
  riskId: number,
  planId: number,
): Promise<void> {
  return apiFetch(`/projects/${projectId}/risks/${riskId}/response-plans/${planId}`, {
    method: 'DELETE',
  })
}

/** 提交风险复查 */
export async function reviewRisk(
  projectId: number,
  riskId: number,
  data: { conclusion: string; nextAction: string; nextReviewAt?: string | null },
): Promise<{ data: Risk }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/${riskId}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 风险历史 */
export async function getRiskHistory(
  projectId: number,
  riskId: number,
  page?: number,
): Promise<{
  data: RiskHistoryEntry[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}> {
  const q = page ? `?page=${page}` : ''
  return apiFetchEnvelope(`/projects/${projectId}/risks/${riskId}/history${q}`)
}

/** 评估规则候选 */
export async function evaluateCandidates(
  projectId: number,
): Promise<{ data: RiskSignalCandidate[] }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/evaluate-candidates`, {
    method: 'POST',
  })
}

/** 采纳候选 */
export async function acceptCandidate(
  projectId: number,
  candidateId: number,
  data?: { title?: string; category?: string; probability?: number; impact?: number },
): Promise<{ data: Risk }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/candidates/${candidateId}/accept`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  })
}

/** 拒绝候选 */
export async function rejectCandidate(projectId: number, candidateId: number): Promise<void> {
  return apiFetch(`/projects/${projectId}/risks/candidates/${candidateId}/reject`, {
    method: 'POST',
  })
}

/** 列出知识库模板 */
export async function listKnowledgeTemplates(
  projectId: number,
): Promise<{ data: RiskKnowledgeTemplate[] }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/knowledge-templates`)
}

/** 创建知识库模板 */
export async function createKnowledgeTemplate(
  projectId: number,
  data: { title: string; description: string; category: string },
): Promise<{ data: RiskKnowledgeTemplate }> {
  return apiFetchEnvelope(`/projects/${projectId}/risks/knowledge-templates`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}
