// @aiproj/types — V2 项目健康诊断共享契约（前后端共享）
// v2-ai-project-health-diagnosis

// ---------------------------------------------------------------------------
// 核心枚举与常量
// ---------------------------------------------------------------------------

/** 诊断状态 */
export const HEALTH_DIAGNOSIS_STATUSES = [
  'pending',
  'confirmed',
  'rejected',
  'ai_ready',
  'ai_failed',
] as const
export type HealthDiagnosisStatus = (typeof HEALTH_DIAGNOSIS_STATUSES)[number]

/** 诊断维度 */
export const HEALTH_DIMENSIONS = [
  'progress',
  'critical_path',
  'milestone',
  'resource',
  'risk',
  'change_impact',
  'collaboration',
  'data_integrity',
] as const
export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number]

/** 严重度等级 */
export const HEALTH_SEVERITIES = ['critical', 'high', 'medium', 'low', 'ok'] as const
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number]

/** 严重度排序（ok 最低，critical 最高） */
export const HEALTH_SEVERITY_ORDER: HealthSeverity[] = ['critical', 'high', 'medium', 'low', 'ok']

export function healthSeverityScore(severity: HealthSeverity): number {
  const idx = HEALTH_SEVERITY_ORDER.indexOf(severity)
  return idx >= 0 ? HEALTH_SEVERITY_ORDER.length - idx : 0
}

export function maxHealthSeverity(a: HealthSeverity, b: HealthSeverity): HealthSeverity {
  return healthSeverityScore(a) >= healthSeverityScore(b) ? a : b
}

/** 规则 ID 白名单（V2 首版，与 design.md D2 对应） */
export const HEALTH_RULE_IDS = [
  'R001', // 逾期任务
  'R002', // 即将到期
  'R003', // 关键路径延期
  'R004', // 依赖阻塞
  'R005', // 里程碑偏差
  'R006', // 资源超载
  'R007', // 高风险集中
  'R008', // 复查逾期
  'R009', // 变更冲击
  'R010', // 数据缺失
] as const
export type HealthRuleId = (typeof HEALTH_RULE_IDS)[number]

/** 中文状态标签 */
export const HEALTH_STATUS_LABELS: Record<string, string> = {
  healthy: '健康',
  attention: '需关注',
  warning: '需警惕',
  critical: '严重',
}

/** 维度中文标签 */
export const HEALTH_DIMENSION_LABELS: Record<HealthDimension, string> = {
  progress: '进度',
  critical_path: '关键路径',
  milestone: '里程碑',
  resource: '资源',
  risk: '风险',
  change_impact: '变更影响',
  collaboration: '协作活跃度',
  data_integrity: '数据完整性',
}

// ---------------------------------------------------------------------------
// 输入与信号类型
// ---------------------------------------------------------------------------

/** 数据缺失 warning */
export interface HealthDataWarning {
  dimension: HealthDimension
  code: string
  message: string
  /** 是否阻止对该维度的评分 */
  blocking: boolean
}

/** 维度级权限脱敏 */
export interface HealthPermissionInfo {
  dimension: HealthDimension
  /** 'available' | 'forbidden' | 'partial' */
  access: 'available' | 'forbidden' | 'partial'
  reason?: string
}

/** 证据条目 */
export interface HealthEvidenceItem {
  ruleId: HealthRuleId
  entityType: string
  entityId: number
  summary: string
  impact: number
  severity: HealthSeverity
  sourceRef?: string
}

/** 评分后的维度 */
export interface HealthDimensionScore {
  dimension: HealthDimension
  score: number
  severity: HealthSeverity
  evidence: HealthEvidenceItem[]
  warnings: HealthDataWarning[]
  suggestedActions: string[]
}

/** 建议动作 */
export interface HealthSuggestedAction {
  action: string
  priority: 'high' | 'medium' | 'low'
  dimension: HealthDimension
  entityType?: string
  entityId?: number
}

// ---------------------------------------------------------------------------
// 输出类型
// ---------------------------------------------------------------------------

/** 健康诊断快照摘要 JSON（存入 diagnoses.summary） */
export interface HealthDiagnosisSummary {
  overallScore: number
  overallLabel: string
  dimensionScores: HealthDimensionScore[]
  warnings: HealthDataWarning[]
  suggestedActions: HealthSuggestedAction[]
  evidenceHash: string
}

/** AI 诊断草稿 */
export interface HealthAiDraft {
  narrativeDraft: string
  recommendedActionsText: string
  assumptions: string[]
  confidence: number
  questions: string[]
  provider: string | null
  model: string | null
}

/** 诊断完整实体（API 响应形状） */
export interface HealthDiagnosis {
  id: number
  organizationId: number
  projectId: number
  status: HealthDiagnosisStatus
  ruleVersion: string
  inputSignature: string
  outputHash: string
  evidenceHash: string
  summary: HealthDiagnosisSummary | null
  aiDraft: HealthAiDraft | null
  warnings: HealthDataWarning[]
  generatedBy: number
  generatedAt: string
  confirmedBy: number | null
  confirmedAt: string | null
  confirmedNotes: string | null
  rejectedBy: number | null
  rejectedAt: string | null
  rejectReason: string | null
  stale: boolean
  staleReason: string | null
  createdAt: string
  updatedAt: string
}

/** 诊断列表项（比详情轻量） */
export interface HealthDiagnosisListItem {
  id: number
  projectId: number
  status: HealthDiagnosisStatus
  overallScore: number
  overallLabel: string
  ruleVersion: string
  inputSignature: string
  stale: boolean
  generatedBy: number
  generatedAt: string
  confirmedBy: number | null
  confirmedAt: string | null
  severity: HealthSeverity
}

// ---------------------------------------------------------------------------
// API 请求/响应类型
// ---------------------------------------------------------------------------

export interface GenerateDiagnosisRequest {
  enableAiDraft?: boolean
}

export interface GenerateDiagnosisResponse {
  data: HealthDiagnosis
  warnings: HealthDataWarning[]
}

export interface ListDiagnosesQuery {
  status?: HealthDiagnosisStatus
  page?: number
  perPage?: number
  sort?: string
}

export interface ListDiagnosesResponse {
  data: HealthDiagnosisListItem[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface GetDiagnosisResponse {
  data: HealthDiagnosis
}

export interface RefreshDiagnosisResponse {
  data: HealthDiagnosis
}

export interface ConfirmDiagnosisRequest {
  notes?: string
}

export interface ConfirmDiagnosisResponse {
  data: HealthDiagnosis
}

export interface RejectDiagnosisRequest {
  reason: string
}

export interface RejectDiagnosisResponse {
  data: HealthDiagnosis
}

export interface AiDraftResponse {
  data: HealthAiDraft
}

/** Dashboard 健康诊断摘要 */
export interface DashboardHealthSummary {
  diagnosisId: number | null
  overallScore: number | null
  overallLabel: string | null
  dimensionScores: Pick<HealthDimensionScore, 'dimension' | 'score' | 'severity'>[]
  status: HealthDiagnosisStatus | null
  stale: boolean
  staleReason: string | null
  confirmedAt: string | null
  confirmedBy: number | null
  confirmedNotes: string | null
  warnings: HealthDataWarning[]
  available: boolean
}
