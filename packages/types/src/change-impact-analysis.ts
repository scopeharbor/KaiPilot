// @aiproj/types — V2 变更影响分析共享契约（前后端共享）
// v2-change-management-impact-analysis / D1–D6

// ---------------------------------------------------------------------------
// 核心枚举与常量
// ---------------------------------------------------------------------------

/** 影响维度（V2 首版七维度） */
export const IMPACT_DIMENSIONS = [
  'scope',
  'schedule',
  'resource',
  'risk',
  'quality',
  'assumption',
  'related_object',
] as const
export type ChangeImpactDimension = (typeof IMPACT_DIMENSIONS)[number]

/** 严重度等级 */
export const IMPACT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'none'] as const
export type ChangeImpactSeverity = (typeof IMPACT_SEVERITIES)[number]

/** 影响分析状态 */
export const IMPACT_ANALYSIS_STATUSES = ['pending', 'completed', 'failed', 'stale'] as const
export type ChangeImpactAnalysisStatus = (typeof IMPACT_ANALYSIS_STATUSES)[number]

/** 规则 ID 白名单（V2 首版） */
export const IMPACT_RULE_IDS = [
  'R001', // 任务依赖传播
  'R002', // WBS 包含传播
  'R003', // 里程碑关联传播
  'R004', // 资源分配传播
  'R005', // 风险关联传播
  'R006', // 追溯链接传播
  'R007', // 关键路径提升
  'R008', // 资源超载检测
  'R009', // 资源缺失
] as const
export type ImpactRuleId = (typeof IMPACT_RULE_IDS)[number]

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

export interface AnalysisScope {
  dimensions: ChangeImpactDimension[]
  maxPropagationDepth: number
  includeEvidenceDetails: boolean
}

export interface ChangeRequestInput {
  title: string
  description: string | null
  changeType: string
  priority: string
  impactSummary: Record<string, string> | null
  relatedTaskIds: number[] | null
  relatedDocumentIds: number[] | null
}

export interface ChangeImpactInput {
  changeRequest: ChangeRequestInput
  scope: AnalysisScope
  relatedTasks: ImpactEntityRef[]
  relatedDependencies: RelatedDependency[]
  relatedMilestones: ImpactEntityRef[]
  relatedResources: ImpactResourceRef[]
  relatedRisks: ImpactEntityRef[]
  ruleVersion: string
  missingInputs: MissingInput[]
  warnings: ChangeImpactWarning[]
}

export interface ImpactEntityRef {
  entityType: string
  entityId: number
  title: string
  isVisible: boolean
}

export interface RelatedDependency {
  id: number
  predecessorId: number
  successorId: number
  type: string
  lagDays: number
}

export interface ImpactResourceRef {
  resourceId: number
  resourceName: string
  allocations: { taskId: number; loadPercent: number }[]
  capacity: number
  isVisible: boolean
}

export interface MissingInput {
  dimension: ChangeImpactDimension
  reason: string
  requiredData: string
}

export interface ChangeImpactWarning {
  code: string
  message: string
  dimension?: ChangeImpactDimension
}

// ---------------------------------------------------------------------------
// 输出类型
// ---------------------------------------------------------------------------

export interface ChangeImpactItem {
  id: number | null
  analysisId: number | null
  entityType: string
  entityId: number
  dimension: ChangeImpactDimension
  severity: ChangeImpactSeverity
  score: number
  propagationPath: PropagationPathEntry[]
  depth: number
  ruleId: ImpactRuleId
  evidence: string
  requiresReview: boolean
  isVisible: boolean
}

export interface PropagationPathEntry {
  fromEntityType: string
  fromEntityId: number
  toEntityType: string
  toEntityId: number
  relationshipType: string
  relationshipId: number | null
}

export interface ChangeImpactSummary {
  totalAffected: number
  severityDistribution: Record<ChangeImpactSeverity, number>
  dimensionSummaries: DimensionSummary[]
  criticalPathAffected: boolean
  hasBlockingWarnings: boolean
}

export interface DimensionSummary {
  dimension: ChangeImpactDimension
  affectedCount: number
  highestSeverity: ChangeImpactSeverity
  topEvidence: string[]
}

export interface ChangeImpactAnalysis {
  id: number
  organizationId: number
  projectId: number
  changeRequestId: number
  status: ChangeImpactAnalysisStatus
  ruleVersion: string
  inputSignature: string
  outputHash: string | null
  summary: ChangeImpactSummary
  items: ChangeImpactItem[]
  warnings: ChangeImpactWarning[]
  missingInputs: MissingInput[]
  isStale: boolean
  staleReason: string | null
  aiExplanation: AiExplanation | null
  confirmedBy: number | null
  confirmedAt: string | null
  confirmReason: string | null
  createdAt: string
  createdBy: number
}

export interface AiExplanation {
  summary: string
  confidence: number
  provider: string | null
  model: string | null
  assumptions: string[]
  needsConfirmation: boolean
  tokenCost: number | null
}

// ---------------------------------------------------------------------------
// API 请求/响应类型
// ---------------------------------------------------------------------------

export interface CreateAnalysisRequest {
  scope?: Partial<AnalysisScope>
}

export interface CreateAnalysisResponse {
  data: ChangeImpactAnalysis
}

export interface ListAnalysesResponse {
  data: ChangeImpactAnalysis[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ConfirmAnalysisRequest {
  reason?: string
}

export interface ConfirmStaleAnalysisRequest {
  reason: string
}

export interface AiExplanationRequest {
  focus?: string
}

export interface AiExplanationResponse {
  data: AiExplanation
}

export interface ApprovalReferenceRequest {
  analysisId: number
  confirmStaleReason?: string
}

// ---------------------------------------------------------------------------
// 严重度排序与工具函数
// ---------------------------------------------------------------------------

export const SEVERITY_ORDER: ChangeImpactSeverity[] = ['critical', 'high', 'medium', 'low', 'none']

export function severityScore(severity: ChangeImpactSeverity): number {
  const idx = SEVERITY_ORDER.indexOf(severity)
  return idx >= 0 ? SEVERITY_ORDER.length - idx : 0
}

export function maxSeverity(
  a: ChangeImpactSeverity,
  b: ChangeImpactSeverity,
): ChangeImpactSeverity {
  return severityScore(a) >= severityScore(b) ? a : b
}

export function isBlockingSeverity(severity: ChangeImpactSeverity): boolean {
  return severity === 'critical' || severity === 'high'
}
