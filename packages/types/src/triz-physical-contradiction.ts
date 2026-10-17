// @aiproj/types — V3 TRIZ 物理矛盾分析器共享契约（前后端共享）
// v3-triz-physical-contradiction-analyzer / §2.1–§2.6
//
// 设计要点：
// - 物理矛盾 = 同一项目参数在区分条件下需要两种相反状态。
// - Run 持久分析运行快照，Candidate 持久候选快照，均非正式矛盾记录。
// - 确定性优先：输入签名 / idempotency key / candidate key / 输出 hash 保证可复现。
// - 分离原则 registry 为核心，不任意新增矩阵条目。
// - 全部「只建议、不自动执行」；AI 解释可选且可降级。

import { deterministicHash } from './triz-contradiction.js'
import type { ContradictionSeverity, ProjectParameterKey } from './triz-contradiction.js'
import type { ContradictionInputWarning } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 物理矛盾分析运行状态 */
export const PHYSICAL_ANALYSIS_RUN_STATUSES = [
  'queued',
  'completed',
  'completed_with_warnings',
  'failed',
  'stale',
  'archived',
] as const
export type PhysicalAnalysisRunStatus = (typeof PHYSICAL_ANALYSIS_RUN_STATUSES)[number]

/** 物理矛盾分析候选审查状态 */
export const PHYSICAL_CANDIDATE_STATUSES = [
  'unreviewed',
  'reviewed',
  'previewed',
  'blocked_stale',
  'dismissed',
] as const
export type PhysicalCandidateStatus = (typeof PHYSICAL_CANDIDATE_STATUSES)[number]

/** 分离维度 */
export const SEPARATION_AXES = [
  'time',
  'space',
  'condition',
  'stakeholder',
  'level',
  'phase',
  'resource_state',
  'none',
] as const
export type SeparationAxis = (typeof SEPARATION_AXES)[number]

/** 物理矛盾检测规则 ID */
export const PHYSICAL_RULE_IDS = [
  'PD-001', // 范围既要全又要快
  'PD-002', // 资源既要高利用又要保留缓冲
  'PD-003', // 进度既要快又要稳
  'PD-004', // 治理流程既要稳定又要灵活
  'PD-005', // 质量门禁既要严格又要快速
  'PD-006', // 信息既要详尽又要简洁
  'PD-007', // 风险既要降低又要控制成本
] as const
export type PhysicalRuleId = (typeof PHYSICAL_RULE_IDS)[number]

/** 物理矛盾规则集版本 */
export const PHYSICAL_RULESET_VERSION = '1.0.0'

/** 物理矛盾分析警告代码 */
export const PHYSICAL_WARNING_CODES = [
  'SOURCE_UNAVAILABLE',
  'SOURCE_STALE',
  'PERMISSION_RESTRICTED',
  'AMBIGUOUS_CLASSIFICATION',
  'INSUFFICIENT_EVIDENCE',
  'OUTSIDE_REGISTRY',
  'CROSS_PARAMETER_ROUTED',
  'AI_EXPLANATION_FALLBACK',
  'AI_EXPLANATION_BLOCKED',
  'HANDOFF_BLOCKED_STALE',
] as const
export type PhysicalWarningCode = (typeof PHYSICAL_WARNING_CODES)[number]

/** 物理矛盾分析列表排序字段 */
export const PHYSICAL_SORT_FIELDS = [
  'createdAt',
  'severity',
  'confidence',
  'separationAxis',
  'status',
] as const
export type PhysicalSortField = (typeof PHYSICAL_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// 分离原则 Registry（§2.2）
// ---------------------------------------------------------------------------

export interface SeparationPrincipleEntry {
  principleKey: string
  /** 中文权威名 */
  name: string
  /** 中文 PM 落地建议 */
  pmGuidance: string
  /** 适用条件描述 */
  applicabilityConditions: string
  /** 不适用条件描述 */
  nonApplicabilityConditions: string
}

/**
 * PM 适配 TRIZ 分离原则目录。
 * registry 化：新增原则只追加本数组，不改表结构。
 */
export const SEPARATION_PRINCIPLES: readonly SeparationPrincipleEntry[] = [
  {
    principleKey: 'time_separation',
    name: '时间分离',
    pmGuidance:
      '在不同时间段或阶段分别满足对立要求。例如：前期需要大范围探索，后期需要快速收窄交付；旺季高负载，淡季保留缓冲。',
    applicabilityConditions: '对立要求可以在不同时间段或阶段分别满足',
    nonApplicabilityConditions: '两个要求必须在同一时间点同时满足',
  },
  {
    principleKey: 'space_separation',
    name: '空间分离',
    pmGuidance:
      '在不同空间、模块或物理区域分别满足对立要求。例如：核心模块严格质量，探索模块宽松试错；公共组件高利用，实验组件低利用。',
    applicabilityConditions: '对立要求可以在不同模块、子项目或物理区域分别体现',
    nonApplicabilityConditions: '整个项目空间无差异化的部分',
  },
  {
    principleKey: 'condition_separation',
    name: '条件分离',
    pmGuidance:
      '在不同条件或触发规则下分别满足对立要求。例如：高于阈值时严格审批，低于阈值时快速通过；风险偏高时加控，风险偏低时减控。',
    applicabilityConditions: '对立要求取决于可观测、可量化的条件阈值',
    nonApplicabilityConditions: '条件无法量化或观测，或阈值模糊',
  },
  {
    principleKey: 'stakeholder_separation',
    name: '干系人分离',
    pmGuidance:
      '由不同干系人/角色分别满足对立要求。例如：管理层需要全景稳定视图，执行层需要灵活调整空间；客户需要完整范围，开发需要迭代切片。',
    applicabilityConditions: '不同干系人对同一参数有不同且合理的需求',
    nonApplicabilityConditions: '所有干系人偏好一致，或只有一个干系人',
  },
  {
    principleKey: 'level_separation',
    name: '层级分离',
    pmGuidance:
      '在不同层级（项目/子项目/任务）分别满足对立要求。例如：项目级高标准，任务级低门槛；组合层高利用，项目层高缓冲。',
    applicabilityConditions: '对立要求可以在不同管理层级或粒度上分别满足',
    nonApplicabilityConditions: '只有单一层级或粒度有明确约束',
  },
  {
    principleKey: 'phase_separation',
    name: '阶段分离',
    pmGuidance:
      '在不同生命周期阶段分别满足对立要求。例如：概念阶段宽范围，执行阶段深聚焦；计划阶段高沟通，交付阶段低干扰。',
    applicabilityConditions: '项目有明确可区分的生命周期阶段',
    nonApplicabilityConditions: '项目生命周期很短或阶段边界模糊',
  },
  {
    principleKey: 'resource_state_separation',
    name: '资源状态分离',
    pmGuidance:
      '根据不同资源状态分别满足对立要求。例如：高负载资源严格限流，低负载资源可弹性扩；关键资源高保障，非关键资源高效率。',
    applicabilityConditions: '资源有可区分的高/低、关键/非关键状态',
    nonApplicabilityConditions: '所有资源状态相同且不可区分',
  },
  {
    principleKey: 'whole_part_separation',
    name: '整体-部分分离',
    pmGuidance:
      '在整体与部分层级分别满足对立要求。例如：项目整体需要完整范围，各部分可以分批交付；整体计划需要稳定基线，各迭代可以灵活调整。',
    applicabilityConditions: '对立要求在整体视图和局部视图上有不同含义',
    nonApplicabilityConditions: '整体与部分无实质差异',
  },
]

const SEPARATION_PRINCIPLE_MAP: Record<string, SeparationPrincipleEntry> = Object.fromEntries(
  SEPARATION_PRINCIPLES.map((p) => [p.principleKey, p]),
)

/** 查找分离原则目录项；目录外返回 undefined。 */
export function getSeparationPrinciple(key: string): SeparationPrincipleEntry | undefined {
  return SEPARATION_PRINCIPLE_MAP[key]
}

/** 判定给定 key 是否在目录内。 */
export function isSeparationPrincipleKey(key: string): boolean {
  return key in SEPARATION_PRINCIPLE_MAP
}

// ---------------------------------------------------------------------------
// 分析输入（Collector 产物，前后端共享 §2.1）
// ---------------------------------------------------------------------------

export interface PhysicalAnalysisCollectorInput {
  organizationId: number
  projectId: number
  actorId: number
  /** 用户提供的分析上下文（可选自由文本） */
  userContext?: string
}

export interface PhysicalAnalysisCollectorOutput {
  organizationId: number
  projectId: number
  actorId: number

  // 项目基础事实
  projectName: string
  taskCount: number
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
  criticalPathDensity: number
  milestoneCount: number
  changeRequestCount: number

  // 已有矛盾快照引用（低敏摘要）
  existingContradictionCount: number
  existingContradictionHashes: string[]

  // 质量/治理摘要
  governanceComplexity: 'low' | 'medium' | 'high' | null
  informationCompletenessScore: number | null

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
// 物理矛盾候选（§2.1, §2.3）
// ---------------------------------------------------------------------------

export interface PhysicalCandidateRequirement {
  summary: string
  context: string
  conditionRefs: string[]
}

export interface PhysicalContradictionCandidate {
  /** 稳定候选 ID（确定性派生） */
  candidateKey: string
  ruleId: PhysicalRuleId
  ruleVersion: string
  status: PhysicalCandidateStatus

  /** 对立参数 key（同一参数） */
  parameterKey: ProjectParameterKey
  requirementA: PhysicalCandidateRequirement
  requirementB: PhysicalCandidateRequirement

  /** 分离维度 */
  separationAxis: SeparationAxis

  /** 条件上下文（低敏） */
  contextA: string
  contextB: string
  conditionRefs: string[]

  /** 评分 */
  severity: ContradictionSeverity
  confidence: number
  impactScore: number

  /** 低敏证据 refs */
  evidenceRefs: Array<{
    entityType: string
    entityId: number
    lowSensitiveTitle: string
  }>

  /** 影响范围 */
  affectedScope: string[]

  /** 建议的分离原则 refs */
  principleRefs: Array<{
    principleKey: string
    name: string
    relevance: number
    advice: string
  }>

  /** 确定性理由摘要 */
  rationaleSummary: string

  /** 警告代码 */
  warningCodes: PhysicalWarningCode[]

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

export interface PhysicalAnalysisRun {
  id: number
  organizationId: number
  projectId: number
  actorId: number

  status: PhysicalAnalysisRunStatus

  inputSignature: string
  outputHash: string
  ruleVersion: string
  idempotencyKey: string

  sourceSummary: Record<string, { count: number; hash: string }>
  warningSummary: Array<{ code: PhysicalWarningCode; message: string }>
  candidateCount: number

  costSummary: PhysicalAnalysisCost | null

  createdAt: string
  updatedAt: string | null
  completedAt: string | null
  archivedAt: string | null
}

export interface PhysicalAnalysisCost {
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

export interface PhysicalCandidateAiExplanation {
  narrative: string
  isFallback: boolean
  hallucinationChecked: boolean
  degradedReason: string | null
  referencedPrincipleKeys: string[]
  referencedParameterKey: ProjectParameterKey
  confidence: number
  provider: string | null
  model: string | null
  cost: PhysicalAnalysisCost | null
}

// ---------------------------------------------------------------------------
// 确认/交接预览（§2.1）
// ---------------------------------------------------------------------------

export interface PhysicalConfirmationPreview {
  candidateKey: string
  parameterKey: ProjectParameterKey
  projectedType: 'physical'
  projectedRequirementA: string
  projectedRequirementB: string
  projectedSeparationAxis: SeparationAxis
  sourceHashes: Record<string, string>
  warnings: PhysicalWarningCode[]
  stale: boolean
  requiresUserConfirmation: boolean
}

export interface PhysicalHandoffPreview {
  candidateKey: string
  targetType: 'contradiction' | 'decision_log' | 'workbench' | 'draft_layer'
  targetPreview: Record<string, unknown>
  sourceHashes: Record<string, string>
  stale: boolean
  blockingWarnings: PhysicalWarningCode[]
}

// ---------------------------------------------------------------------------
// API 请求/响应（§2.1）
// ---------------------------------------------------------------------------

export interface CreatePhysicalAnalysisRequest {
  userContext?: string
  idempotencyKey?: string
}

export interface CreatePhysicalAnalysisResponse {
  data: PhysicalAnalysisRun & { candidates: PhysicalContradictionCandidate[] }
}

export interface ListPhysicalAnalysesQuery {
  page?: number
  perPage?: number
  status?: PhysicalAnalysisRunStatus
  sort?: string
}

export interface ListPhysicalAnalysesResponse {
  data: PhysicalAnalysisRun[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface PhysicalAnalysisDetailResponse {
  data: PhysicalAnalysisRun
}

export interface ListPhysicalCandidatesQuery {
  page?: number
  perPage?: number
  status?: PhysicalCandidateStatus
  severity?: ContradictionSeverity
  separationAxis?: SeparationAxis
  stale?: boolean
  sort?: string
}

export interface ListPhysicalCandidatesResponse {
  data: PhysicalContradictionCandidate[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface PhysicalCandidateDetailResponse {
  data: PhysicalContradictionCandidate
}

export interface ExplainPhysicalCandidateResponse {
  data: {
    candidateKey: string
    explanation: PhysicalCandidateAiExplanation
  }
}

export interface ReviewPhysicalCandidateRequest {
  action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss'
  reason?: string
}

export interface ReviewPhysicalCandidateResponse {
  data: {
    candidateKey: string
    status: PhysicalCandidateStatus
    reviewedBy: number
    reviewedAt: string
  }
}

export interface PhysicalConfirmationPreviewResponse {
  data: PhysicalConfirmationPreview
}

export interface PhysicalHandoffPreviewResponse {
  data: PhysicalHandoffPreview
}

// 别名以避免和其他模块同名导出冲突
export type { PhysicalConfirmationPreviewResponse as ConfirmationPreviewResponse_Physical }
export type { PhysicalHandoffPreviewResponse as HandoffPreviewResponse_Physical }

// ---------------------------------------------------------------------------
// 确定性纯函数（§2.3–§2.4）
// ---------------------------------------------------------------------------

/**
 * 计算物理分析运行的输入签名。
 * 基于收集输出与用户上下文的确定性序列化。
 */
export function computePhysicalAnalysisInputSignature(
  collected: PhysicalAnalysisCollectorOutput,
): string {
  const sorted = {
    org: collected.organizationId,
    project: collected.projectId,
    actor: collected.actorId,
    taskCount: collected.taskCount,
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
    criticalPathDensity: Number(collected.criticalPathDensity?.toFixed(4) ?? 0),
    milestoneCount: collected.milestoneCount,
    changeRequestCount: collected.changeRequestCount,
    existingContradictionHashes: [...collected.existingContradictionHashes].sort(),
    governanceComplexity: collected.governanceComplexity,
    informationCompletenessScore: collected.informationCompletenessScore,
    compilerHashes: collected.compilerTrizArtifactSummaries.map((a) => a.hash).sort(),
    workbenchHashes: collected.workbenchSourceSummaries.map((s) => s.hash).sort(),
    userContext: collected.userContext ?? '',
    warnings: [...collected.warnings].map((w) => `${w.source ?? ''}:${w.code}:${w.message}`).sort(),
  }
  return `tpa-${deterministicHash(JSON.stringify(sorted))}`
}

/**
 * 计算物理分析运行的幂等 key。
 */
export function computePhysicalAnalysisIdempotencyKey(
  organizationId: number,
  projectId: number,
  actorId: number,
  inputSignature: string,
  userProvidedKey?: string,
): string {
  const base = userProvidedKey ?? `${organizationId}|${projectId}|${actorId}|${inputSignature}`
  return `tpa-idem-${deterministicHash(base)}`
}

/**
 * 计算物理候选的稳定 key。
 */
export function computePhysicalCandidateKey(
  ruleId: PhysicalRuleId,
  parameterKey: string,
  requirementA: string,
  requirementB: string,
): string {
  const parts = [ruleId, parameterKey, ...[requirementA, requirementB].sort()]
  return `tpc-${deterministicHash(parts.join('|'))}`
}

/**
 * 计算物理候选集合的确定性输出 hash。
 */
export function computePhysicalCandidatesOutputHash(
  candidates: Pick<PhysicalContradictionCandidate, 'candidateKey'>[],
): string {
  const keys = candidates.map((c) => c.candidateKey).sort()
  return `tpo-${deterministicHash(keys.join('|'))}`
}

/**
 * 物理候选稳定排序比较器：严重度 → 置信度 → 影响分数 → 规则 ID → candidateKey。
 */
export function comparePhysicalCandidate(
  a: PhysicalContradictionCandidate,
  b: PhysicalContradictionCandidate,
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
 * 计算分离原则与参数对的相关度得分（确定性）。
 */
export function scoreSeparationPrincipleRelevance(
  separationAxis: SeparationAxis,
  parameterKey: ProjectParameterKey,
): number {
  // none 轴表示无明确分离维度，直接返回 0
  if (separationAxis === 'none') return 0

  // 分离维度映射到分离原则的相关度基础分
  const axisBase: Record<SeparationAxis, Record<string, number>> = {
    time: { time_separation: 0.95, phase_separation: 0.8, condition_separation: 0.5 },
    space: { space_separation: 0.95, whole_part_separation: 0.75, level_separation: 0.5 },
    condition: {
      condition_separation: 0.95,
      time_separation: 0.6,
      stakeholder_separation: 0.4,
    },
    stakeholder: {
      stakeholder_separation: 0.95,
      level_separation: 0.7,
      condition_separation: 0.4,
    },
    level: { level_separation: 0.95, whole_part_separation: 0.8, space_separation: 0.5 },
    phase: { phase_separation: 0.95, time_separation: 0.75, condition_separation: 0.5 },
    resource_state: {
      resource_state_separation: 0.95,
      condition_separation: 0.65,
      phase_separation: 0.4,
    },
    none: {},
  }

  // 参数特定微调
  const paramBoost: Partial<Record<ProjectParameterKey, Partial<Record<string, number>>>> = {
    scope: { whole_part_separation: 0.1, time_separation: 0.05 },
    duration: { time_separation: 0.1, phase_separation: 0.1 },
    resource_load: { resource_state_separation: 0.1, condition_separation: 0.05 },
    quality: { condition_separation: 0.05, level_separation: 0.05 },
    stability: { phase_separation: 0.05, condition_separation: 0.05 },
    information_completeness: { stakeholder_separation: 0.1, phase_separation: 0.05 },
    risk_level: { condition_separation: 0.1, stakeholder_separation: 0.05 },
  }

  const base = axisBase[separationAxis] ?? {}
  const boost = (paramBoost as any)[parameterKey] ?? {}

  // 合并：取最高分（每个原则只出现一次）
  const scores: Record<string, number> = {}
  for (const [k, v] of Object.entries(base)) {
    scores[k] = v + ((boost as Record<string, number>)[k] ?? 0)
  }
  for (const [k, v] of Object.entries(boost)) {
    if (!(k in scores)) scores[k] = (v as number) + 0.3
  }

  return (
    Object.entries(scores)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([, v]) => v)[0] ?? 0
  )
}

/**
 * 计算物理候选警告摘要字符串。
 */
export function summarizePhysicalWarnings(codes: PhysicalWarningCode[]): string {
  if (codes.length === 0) return ''
  const labels: Record<PhysicalWarningCode, string> = {
    SOURCE_UNAVAILABLE: '来源模块不可用',
    SOURCE_STALE: '来源数据已过期',
    PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
    AMBIGUOUS_CLASSIFICATION: '分类模糊：是否存在物理矛盾不确定',
    INSUFFICIENT_EVIDENCE: '证据不足',
    OUTSIDE_REGISTRY: '超出分离原则目录',
    CROSS_PARAMETER_ROUTED: '已路由到技术矛盾分析',
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
 * 判定物理候选是否陈旧（基于来源 hash 比对）。
 */
export function isPhysicalCandidateStale(
  sourceHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): boolean {
  for (const [key, hash] of Object.entries(sourceHashes)) {
    if (currentHashes[key] !== undefined && currentHashes[key] !== hash) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 低敏夹具构造器（§2.5）
// ---------------------------------------------------------------------------

export function makePhysicalAnalysisCollectorOutput(
  overrides?: Partial<PhysicalAnalysisCollectorOutput>,
): PhysicalAnalysisCollectorOutput {
  return {
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    projectName: '测试项目',
    taskCount: 20,
    overdueTaskCount: 5,
    scopeItemCount: 25,
    plannedDurationDays: 60,
    resourceUtilization: 0.72,
    resourceOverloadCount: 2,
    activeRiskCount: 4,
    highRiskCount: 2,
    criticalPathDensity: 0.35,
    milestoneCount: 6,
    changeRequestCount: 3,
    existingContradictionCount: 2,
    existingContradictionHashes: ['h1', 'h2'],
    governanceComplexity: 'medium',
    informationCompletenessScore: 0.7,
    compilerTrizArtifactSummaries: [],
    workbenchSourceSummaries: [],
    userContext: null,
    warnings: [],
    sourceHashes: { tasks: 'abc', risks: 'def' },
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makePhysicalCandidateFixture(
  overrides?: Partial<PhysicalContradictionCandidate>,
): PhysicalContradictionCandidate {
  const base: PhysicalContradictionCandidate = {
    candidateKey: 'tpc-test001',
    ruleId: 'PD-001',
    ruleVersion: PHYSICAL_RULESET_VERSION,
    status: 'unreviewed',
    parameterKey: 'scope',
    requirementA: {
      summary: '范围要完整覆盖所有需求',
      context: '干系人期望全面交付',
      conditionRefs: ['cond_stakeholder'],
    },
    requirementB: {
      summary: '交付要快速收敛',
      context: '项目有紧迫的截止日期',
      conditionRefs: ['cond_deadline'],
    },
    separationAxis: 'time',
    contextA: '前期探索阶段需要大范围',
    contextB: '后期交付阶段需要快速收窄',
    conditionRefs: ['cond_phase_exploration', 'cond_phase_delivery'],
    severity: 'high',
    confidence: 0.75,
    impactScore: 0.8,
    evidenceRefs: [
      { entityType: 'task', entityId: 1, lowSensitiveTitle: '逾期任务聚合' },
      { entityType: 'scope_item', entityId: 2, lowSensitiveTitle: '范围条目聚合' },
    ],
    affectedScope: ['scope', 'duration'],
    principleRefs: [
      {
        principleKey: 'time_separation',
        name: '时间分离',
        relevance: 0.9,
        advice: '在不同时间段分别满足对立要求',
      },
    ],
    rationaleSummary: '范围既可全也可快——关键在于按阶段分离要求而非同时满足。',
    warningCodes: [],
    sourceHashes: { tasks: 'abc' },
    outputHash: 'tpo-test-output',
    reviewedBy: null,
    reviewedAt: null,
    aiExplanationRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  }
  return base
}

export function makePhysicalAnalysisRunFixture(
  overrides?: Partial<PhysicalAnalysisRun>,
): PhysicalAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'tpa-test',
    outputHash: 'tpo-test',
    ruleVersion: PHYSICAL_RULESET_VERSION,
    idempotencyKey: 'tpa-idem-test',
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
