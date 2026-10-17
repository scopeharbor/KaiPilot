// @aiproj/types — V3 TRIZ 技术矛盾分析器共享契约（前后端共享）
// v3-triz-technical-contradiction-analyzer / §2.1–§2.6
//
// 设计要点：
// - 技术矛盾 = 一个项目参数改善导致另一个参数恶化。
// - Run 持久分析运行快照，Candidate 持久候选快照，均非正式矛盾记录。
// - 确定性优先：输入签名 / idempotency key / candidate key / 输出 hash 保证可复现。
// - 复用现有 ContradictionDetectionRuleset 与 PrincipleSuggestionMapper 作为基础候选来源。
// - 全部「只建议、不自动执行」；AI 解释可选且可降级。

import { deterministicHash, CONTRADICTION_RULESET_VERSION } from './triz-contradiction.js'
import type {
  ContradictionSeverity,
  ContradictionInputWarning,
  ProjectParameterKey,
} from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 技术矛盾分析运行状态 */
export const TECHNICAL_ANALYSIS_RUN_STATUSES = [
  'queued',
  'completed',
  'completed_with_warnings',
  'failed',
  'stale',
  'archived',
] as const
export type TechnicalAnalysisRunStatus = (typeof TECHNICAL_ANALYSIS_RUN_STATUSES)[number]

/** 技术矛盾分析候选审查状态 */
export const TECHNICAL_CANDIDATE_STATUSES = [
  'unreviewed',
  'reviewed',
  'previewed',
  'blocked_stale',
  'dismissed',
] as const
export type TechnicalCandidateStatus = (typeof TECHNICAL_CANDIDATE_STATUSES)[number]

/** 技术矛盾分析警告代码 */
export const TECHNICAL_WARNING_CODES = [
  'SOURCE_UNAVAILABLE',
  'SOURCE_STALE',
  'PERMISSION_RESTRICTED',
  'INSUFFICIENT_EVIDENCE',
  'OUTSIDE_REGISTRY',
  'AMBIGUOUS_PARAMETER_PAIR',
  'REGISTRY_MISS',
  'AI_EXPLANATION_FALLBACK',
  'AI_EXPLANATION_BLOCKED',
  'HANDOFF_BLOCKED_STALE',
] as const
export type TechnicalWarningCode = (typeof TECHNICAL_WARNING_CODES)[number]

/** 技术矛盾规则集版本（与现有 CONTRADICTION_RULESET_VERSION 联动） */
export const TECHNICAL_RULESET_VERSION = CONTRADICTION_RULESET_VERSION

/** 技术矛盾分析列表排序字段 */
export const TECHNICAL_SORT_FIELDS = ['createdAt', 'severity', 'confidence', 'status'] as const
export type TechnicalSortField = (typeof TECHNICAL_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// 分析输入（Collector 产物，前后端共享 §2.1）
// ---------------------------------------------------------------------------

export interface TechnicalAnalysisCollectorInput {
  organizationId: number
  projectId: number
  actorId: number
  /** 用户提供的分析上下文（可选自由文本） */
  userContext?: string
  /** 外部提供的幂等 key（可选） */
  idempotencyKey?: string
}

export interface TechnicalAnalysisCollectorOutput {
  organizationId: number
  projectId: number
  actorId: number

  // 项目基础事实
  projectName: string
  taskTotal: number
  overdueTaskCount: number
  scopeItemCount: number
  plannedDurationDays: number | null

  // 资源
  resourceUtilization: number | null
  resourceOverloadCount: number

  // 风险
  activeRiskCount: number
  highRiskCount: number

  // 计划与缓冲
  criticalPathTaskCount: number
  criticalPathDensity: number
  milestoneTotal: number
  changeRequestCount: number

  // 已有矛盾快照引用（低敏摘要）
  existingContradictionCount: number
  existingContradictionHashes: string[]

  // Compiler TRIZ 分析产物摘要
  compilerTrizArtifactSummaries: Array<{
    artifactId: number
    kind: string
    shortSummary: string
    hash: string
    warnings: string[]
  }>

  // Workbench 来源摘要
  workbenchSourceSummaries: Array<{
    schemeId: number
    title: string
    hash: string
  }>

  // 用户上下文
  userContext: string | null

  // 收集元数据
  warnings: ContradictionInputWarning[]
  sourceHashes: Record<string, string>
  collectedAt: string
}

// ---------------------------------------------------------------------------
// 技术矛盾候选（§2.1, §2.3）
// ---------------------------------------------------------------------------

export interface TechnicalContradictionCandidate {
  /** 稳定候选 ID（确定性派生） */
  candidateKey: string
  ruleId: string
  ruleVersion: string
  status: TechnicalCandidateStatus

  /** 改善参数 key（从既有目录派生） */
  improvingParameterKey: ProjectParameterKey
  /** 恶化参数 key（从既有目录派生） */
  worseningParameterKey: ProjectParameterKey
  /** 改善方向描述 */
  improvingDirection: string
  /** 恶化方向描述 */
  worseningDirection: string

  /** 低敏中文标题 */
  title: string

  /** 评分 */
  severity: ContradictionSeverity
  confidence: number
  /** 影响得分（0–1，综合严重度+证据+置信度） */
  impactScore: number

  /** 低敏证据 refs */
  evidenceRefs: Array<{
    entityType: string
    entityId: number
    lowSensitiveTitle: string
  }>

  /** 影响范围 */
  affectedScope: string[]

  /** 建议的发明原理 refs */
  principleRefs: Array<{
    principleId: string
    name: string
    relevance: number
    advice: string
  }>

  /** 确定性理由摘要 */
  rationaleSummary: string

  /** 警告代码 */
  warningCodes: TechnicalWarningCode[]

  /** 来源 hash（用于陈旧检测） */
  sourceHashes: Record<string, string>

  /** 确定性输出 hash */
  outputHash: string

  /** 审查元数据 */
  reviewedBy: number | null
  reviewedAt: string | null

  /** AI 解释 ref（可选） */
  aiExplanationRef: string | null

  createdAt: string
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// 分析运行（§2.1）
// ---------------------------------------------------------------------------

export interface TechnicalAnalysisRun {
  id: number
  organizationId: number
  projectId: number
  actorId: number

  status: TechnicalAnalysisRunStatus

  inputSignature: string
  outputHash: string
  ruleVersion: string
  idempotencyKey: string

  sourceSummary: Record<string, { count: number; hash: string }>
  warningSummary: Array<{ code: TechnicalWarningCode; message: string }>
  candidateCount: number

  costSummary: TechnicalAnalysisCost | null

  createdAt: string
  updatedAt: string | null
  completedAt: string | null
  archivedAt: string | null
}

export interface TechnicalAnalysisCost {
  provider: string | null
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  estimatedCost: number | null
  latencyMs: number | null
}

// ---------------------------------------------------------------------------
// AI 解释（§2.1）
// ---------------------------------------------------------------------------

export interface TechnicalCandidateAiExplanation {
  narrative: string
  isFallback: boolean
  hallucinationChecked: boolean
  degradedReason: string | null
  referencedPrincipleIds: string[]
  referencedParameterKeys: ProjectParameterKey[]
  confidence: number
  provider: string | null
  model: string | null
  cost: TechnicalAnalysisCost | null
}

// ---------------------------------------------------------------------------
// 确认/交接预览（§2.1）
// ---------------------------------------------------------------------------

export interface TechnicalConfirmationPreview {
  candidateKey: string
  improvingParameterKey: ProjectParameterKey
  worseningParameterKey: ProjectParameterKey
  projectedType: 'technical'
  projectedTitle: string
  projectedImprovingDirection: string
  projectedWorseningDirection: string
  projectedPrincipleRefs: Array<{
    principleId: string
    name: string
    relevance: number
    advice: string
  }>
  sourceHashes: Record<string, string>
  warnings: TechnicalWarningCode[]
  stale: boolean
  requiresUserConfirmation: boolean
}

export interface TechnicalHandoffPreview {
  candidateKey: string
  targetType: 'contradiction' | 'decision_log' | 'workbench' | 'draft_layer'
  targetPreview: Record<string, unknown>
  sourceHashes: Record<string, string>
  stale: boolean
  blockingWarnings: TechnicalWarningCode[]
}

// ---------------------------------------------------------------------------
// API 请求/响应（§2.1）
// ---------------------------------------------------------------------------

export interface CreateTechnicalAnalysisRequest {
  userContext?: string
  idempotencyKey?: string
}

export interface CreateTechnicalAnalysisResponse {
  data: TechnicalAnalysisRun & { candidates: TechnicalContradictionCandidate[] }
}

export interface ListTechnicalAnalysesQuery {
  page?: number
  perPage?: number
  status?: TechnicalAnalysisRunStatus
  sort?: string
}

export interface ListTechnicalAnalysesResponse {
  data: TechnicalAnalysisRun[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TechnicalAnalysisDetailResponse {
  data: TechnicalAnalysisRun
}

export interface ListTechnicalCandidatesQuery {
  page?: number
  perPage?: number
  status?: TechnicalCandidateStatus
  severity?: ContradictionSeverity
  stale?: boolean
  sort?: string
}

export interface ListTechnicalCandidatesResponse {
  data: TechnicalContradictionCandidate[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TechnicalCandidateDetailResponse {
  data: TechnicalContradictionCandidate
}

export interface ExplainTechnicalCandidateResponse {
  data: {
    candidateKey: string
    explanation: TechnicalCandidateAiExplanation
  }
}

export interface ReviewTechnicalCandidateRequest {
  action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss'
  reason?: string
}

export interface ReviewTechnicalCandidateResponse {
  data: {
    candidateKey: string
    status: TechnicalCandidateStatus
    reviewedBy: number
    reviewedAt: string
  }
}

export interface ConfirmationPreviewResponse {
  data: TechnicalConfirmationPreview
}

export interface HandoffPreviewResponse {
  data: TechnicalHandoffPreview
}

// ---------------------------------------------------------------------------
// 确定性纯函数（§2.3–§2.4）
// ---------------------------------------------------------------------------

/**
 * 计算技术分析运行的输入签名。
 * 基于收集输出与用户上下文的确定性序列化。
 */
export function computeTechnicalAnalysisInputSignature(
  collected: TechnicalAnalysisCollectorOutput,
): string {
  const sorted = {
    org: collected.organizationId,
    project: collected.projectId,
    actor: collected.actorId,
    taskTotal: collected.taskTotal,
    overdueTaskCount: collected.overdueTaskCount,
    scopeItemCount: collected.scopeItemCount,
    plannedDurationDays: collected.plannedDurationDays,
    resourceUtilization:
      collected.resourceUtilization === null
        ? null
        : Number(collected.resourceUtilization.toFixed(4)),
    resourceOverloadCount: collected.resourceOverloadCount,
    activeRiskCount: collected.activeRiskCount,
    highRiskCount: collected.highRiskCount,
    criticalPathTaskCount: collected.criticalPathTaskCount,
    criticalPathDensity: Number(collected.criticalPathDensity?.toFixed(4) ?? 0),
    milestoneTotal: collected.milestoneTotal,
    changeRequestCount: collected.changeRequestCount,
    existingContradictionHashes: [...collected.existingContradictionHashes].sort(),
    compilerHashes: collected.compilerTrizArtifactSummaries.map((a) => a.hash).sort(),
    workbenchHashes: collected.workbenchSourceSummaries.map((s) => s.hash).sort(),
    userContext: collected.userContext ?? '',
    warnings: [...collected.warnings].map((w) => `${w.source ?? ''}:${w.code}:${w.message}`).sort(),
  }
  return `tta-${deterministicHash(JSON.stringify(sorted))}`
}

/**
 * 计算技术分析运行的幂等 key。
 */
export function computeTechnicalAnalysisIdempotencyKey(
  organizationId: number,
  projectId: number,
  actorId: number,
  inputSignature: string,
  userProvidedKey?: string,
): string {
  const base = userProvidedKey ?? `${organizationId}|${projectId}|${actorId}|${inputSignature}`
  return `tta-idem-${deterministicHash(base)}`
}

/**
 * 计算技术候选的稳定 key。
 * 基于参数对（标准化排序）+ 规则 ID 确定性派生。
 */
export function computeTechnicalCandidateKey(
  ruleId: string,
  improvingParameterKey: string,
  worseningParameterKey: string,
): string {
  const pair = [improvingParameterKey, worseningParameterKey].sort().join('<>')
  const parts = [ruleId, pair]
  return `ttc-${deterministicHash(parts.join('|'))}`
}

/**
 * 计算技术候选集合的确定性输出 hash。
 */
export function computeTechnicalCandidatesOutputHash(
  candidates: Pick<TechnicalContradictionCandidate, 'candidateKey'>[],
): string {
  const keys = candidates.map((c) => c.candidateKey).sort()
  return `tto-${deterministicHash(keys.join('|'))}`
}

/**
 * 技术候选稳定排序比较器：严重度 → 置信度 → 影响分数 → ruleId → candidateKey。
 */
export function compareTechnicalCandidate(
  a: TechnicalContradictionCandidate,
  b: TechnicalContradictionCandidate,
): number {
  const sevOrder: ContradictionSeverity[] = ['critical', 'high', 'medium', 'low']
  const bySev = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
  if (bySev !== 0) return bySev
  const byConf = (b.confidence ?? 0) - (a.confidence ?? 0)
  if (Math.abs(byConf) > 1e-9) return byConf
  const byImpact = (b.impactScore ?? 0) - (a.impactScore ?? 0)
  if (Math.abs(byImpact) > 1e-9) return byImpact
  if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId)
  return a.candidateKey.localeCompare(b.candidateKey)
}

/**
 * 归一化严重度到数值（用于 impactScore 计算）。
 */
export function severityToNormalizedScore(severity: ContradictionSeverity): number {
  const map: Record<ContradictionSeverity, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  }
  return map[severity] ?? 0.25
}

/**
 * 计算技术候选的 impactScore（0–1）。
 * 综合严重度(50%)、置信度(30%)、证据数量微调(20%)。
 */
export function computeTechnicalImpactScore(
  severity: ContradictionSeverity,
  confidence: number,
  evidenceCount: number,
): number {
  const sevScore = severityToNormalizedScore(severity) * 0.5
  const confScore = (confidence ?? 0.5) * 0.3
  const eviScore = Math.min(1, evidenceCount / 5) * 0.2
  return Number((sevScore + confScore + eviScore).toFixed(2))
}

/**
 * 计算技术候选警告摘要字符串。
 */
export function summarizeTechnicalWarnings(codes: TechnicalWarningCode[]): string {
  if (codes.length === 0) return ''
  const labels: Record<TechnicalWarningCode, string> = {
    SOURCE_UNAVAILABLE: '来源模块不可用',
    SOURCE_STALE: '来源数据已过期',
    PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
    INSUFFICIENT_EVIDENCE: '证据不足',
    OUTSIDE_REGISTRY: '参数对超出目录',
    AMBIGUOUS_PARAMETER_PAIR: '参数对分类模糊',
    REGISTRY_MISS: '原理目录未收录',
    AI_EXPLANATION_FALLBACK: 'AI 解释已降级',
    AI_EXPLANATION_BLOCKED: 'AI 解释被预算/权限阻断',
    HANDOFF_BLOCKED_STALE: '交接因来源过期被阻止',
  }
  return codes
    .map((c) => labels[c] ?? c)
    .sort()
    .join('；')
}

/**
 * 判定技术候选是否陈旧（基于来源 hash 比对）。
 */
export function isTechnicalCandidateStale(
  sourceHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): boolean {
  for (const [key, hash] of Object.entries(sourceHashes)) {
    if (currentHashes[key] !== undefined && currentHashes[key] !== hash) return true
  }
  return false
}

/**
 * 判定运行是否陈旧（基于来源 hash 比对）。
 */
export function isTechnicalAnalysisRunStale(
  runSourceHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): boolean {
  return isTechnicalCandidateStale(runSourceHashes, currentHashes)
}

// ---------------------------------------------------------------------------
// 低敏夹具构造器（§2.2）
// ---------------------------------------------------------------------------

export function makeTechnicalAnalysisCollectorOutput(
  overrides?: Partial<TechnicalAnalysisCollectorOutput>,
): TechnicalAnalysisCollectorOutput {
  return {
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    projectName: '测试项目',
    taskTotal: 20,
    overdueTaskCount: 5,
    scopeItemCount: 25,
    plannedDurationDays: 60,
    resourceUtilization: 0.72,
    resourceOverloadCount: 2,
    activeRiskCount: 4,
    highRiskCount: 2,
    criticalPathTaskCount: 7,
    criticalPathDensity: 0.35,
    milestoneTotal: 6,
    changeRequestCount: 3,
    existingContradictionCount: 2,
    existingContradictionHashes: ['h1', 'h2'],
    compilerTrizArtifactSummaries: [],
    workbenchSourceSummaries: [],
    userContext: null,
    warnings: [],
    sourceHashes: { tasks: 'abc', risks: 'def' },
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeTechnicalCandidateFixture(
  overrides?: Partial<TechnicalContradictionCandidate>,
): TechnicalContradictionCandidate {
  const base: TechnicalContradictionCandidate = {
    candidateKey: 'ttc-test001',
    ruleId: 'CD-001',
    ruleVersion: TECHNICAL_RULESET_VERSION,
    status: 'unreviewed',
    improvingParameterKey: 'duration',
    worseningParameterKey: 'cost',
    improvingDirection: '为追赶工期压缩进度',
    worseningDirection: '赶工成本上升',
    title: '压缩工期会抬高成本与质量风险',
    severity: 'high',
    confidence: 0.8,
    impactScore: 0.72,
    evidenceRefs: [{ entityType: 'task', entityId: 1, lowSensitiveTitle: '逾期任务聚合' }],
    affectedScope: ['schedule', 'cost'],
    principleRefs: [
      {
        principleId: 'segmentation',
        name: '分割/分解',
        relevance: 0.9,
        advice: '将大任务拆分为更小阶段或子任务，分段管理关键路径，降低单点风险',
      },
      {
        principleId: 'preliminary_action',
        name: '预先作用',
        relevance: 0.85,
        advice: '为关键依赖预留前置缓冲，提前准备资源与验收材料，缩短关键路径等待',
      },
    ],
    rationaleSummary: '工期压缩与成本控制是对立的：加快进度需要更多资源投入，提高成本。',
    warningCodes: [],
    sourceHashes: { tasks: 'abc' },
    outputHash: 'tto-test-output',
    reviewedBy: null,
    reviewedAt: null,
    aiExplanationRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  }
  return base
}

export function makeTechnicalAnalysisRunFixture(
  overrides?: Partial<TechnicalAnalysisRun>,
): TechnicalAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'tta-test',
    outputHash: 'tto-test',
    ruleVersion: TECHNICAL_RULESET_VERSION,
    idempotencyKey: 'tta-idem-test',
    sourceSummary: { tasks: { count: 20, hash: 'abc' } },
    warningSummary: [],
    candidateCount: 3,
    costSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    completedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  }
}
