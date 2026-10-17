// @aiproj/types — V3 TRIZ 资源分析器共享契约（前后端共享）
// v3-triz-resource-analyzer / §2.1–§2.6
//
// 设计要点：
// - TRIZ 资源分析器盘点项目可利用资源，生成未利用机会候选。
// - 资源分为内部/外部、系统/子系统/超系统，类别覆盖物质/场/空间/时间/信息/功能/人力/技术/财务/环境。
// - 确定性优先：输入签名 / idempotency key / resource key / opportunity key / 输出 hash 保证可复现。
// - 全部「只建议、不自动执行」；AI 解释可选且可降级。
// - 不替代正式资源登记册；不自动写入资源/任务/计划/风险/预算/文件。

import { deterministicHash } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 资源分析运行状态 */
export const RESOURCE_ANALYSIS_RUN_STATUSES = [
  'queued',
  'completed',
  'completed_with_warnings',
  'failed',
  'stale',
  'archived',
] as const
export type ResourceAnalysisRunStatus = (typeof RESOURCE_ANALYSIS_RUN_STATUSES)[number]

/** 资源分析候选审查状态 */
export const RESOURCE_OPPORTUNITY_STATUSES = [
  'unreviewed',
  'reviewed',
  'previewed',
  'blocked_stale',
  'dismissed',
] as const
export type ResourceOpportunityStatus = (typeof RESOURCE_OPPORTUNITY_STATUSES)[number]

/** TRIZ 资源分类（资源种类） */
export const RESOURCE_KINDS = [
  'human',
  'technical',
  'information',
  'time',
  'space',
  'financial',
  'environmental',
  'functional',
  'material',
  'field',
] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** TRIZ 系统作用域 */
export const SYSTEM_SCOPES = [
  'internal_system',
  'subsystem',
  'supersystem',
  'external_environment',
] as const
export type SystemScope = (typeof SYSTEM_SCOPES)[number]

/** 资源来源类型 */
export const RESOURCE_ORIGINS = [
  'project_registry',
  'organization_pool',
  'task_assignment',
  'risk_register',
  'knowledge_base',
  'compiler_triz',
  'function_analysis',
  'ifr_analysis',
  'workbench',
  'decision_log',
  'user_supplied',
] as const
export type ResourceOrigin = (typeof RESOURCE_ORIGINS)[number]

/** 资源利用状态 */
export const UTILIZATION_STATES = [
  'fully_utilized',
  'partially_utilized',
  'idle',
  'overloaded',
  'unavailable',
  'unknown',
] as const
export type UtilizationState = (typeof UTILIZATION_STATES)[number]

/** 资源可用性评级 */
export const AVAILABILITY_LEVELS = ['high', 'medium', 'low', 'none', 'unknown'] as const
export type AvailabilityLevel = (typeof AVAILABILITY_LEVELS)[number]

/** 未利用资源机会类型 */
export const OPPORTUNITY_TYPES = [
  'idle_capacity',
  'substitute_resource',
  'reuse_existing_asset',
  'external_low_cost_resource',
  'information_gap',
  'automation_opportunity',
  'overload_relief',
  'environmental_resource',
  'constraint_as_resource',
] as const
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number]

/** 资源分析器警告代码 */
export const RESOURCE_WARNING_CODES = [
  'DATA_SOURCE_UNAVAILABLE',
  'INSUFFICIENT_RESOURCE_SOURCE',
  'PERMISSION_RESTRICTED',
  'SOURCE_STALE',
  'SOURCE_HIDDEN',
  'EXTERNAL_SOURCE_NOT_AUTHORIZED',
  'BUDGET_SOURCE_DEGRADED',
  'AI_EXPLANATION_FALLBACK',
  'AI_EXPLANATION_BLOCKED',
  'HANDOFF_BLOCKED_STALE',
] as const
export type ResourceWarningCode = (typeof RESOURCE_WARNING_CODES)[number]

/** 资源分析规则集版本 */
export const RESOURCE_RULESET_VERSION = '1.0.0'

/** 资源分类版本 */
export const RESOURCE_TAXONOMY_VERSION = '1.0.0'

/** 资源分析列表排序字段 */
export const RESOURCE_SORT_FIELDS = [
  'createdAt',
  'severity',
  'confidence',
  'impactScore',
  'status',
] as const
export type ResourceSortField = (typeof RESOURCE_SORT_FIELDS)[number]

/** 机会严重度（复用 contradiction severity 语义） */
export const OPPORTUNITY_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type OpportunitySeverity = (typeof OPPORTUNITY_SEVERITIES)[number]

// ---------------------------------------------------------------------------
// 来源 ref 与警告（低敏共享）
// ---------------------------------------------------------------------------

export interface ResourceSourceRef {
  origin: ResourceOrigin
  entityType: string
  entityId: number | null
  lowSensitiveTitle: string
  hash: string
}

export interface ResourceInputWarning {
  code: ResourceWarningCode
  source: string | null
  message: string
}

// ---------------------------------------------------------------------------
// 资源快照 DTO
// ---------------------------------------------------------------------------

export interface ResourceSnapshot {
  /** 稳定资源 key（确定性派生） */
  resourceKey: string
  label: string
  resourceKind: ResourceKind
  systemScope: SystemScope
  origin: ResourceOrigin

  /** 可用性 */
  availability: AvailabilityLevel
  /** 利用状态 */
  utilizationState: UtilizationState
  /** 当前利用率 0-1 */
  utilizationRate: number | null
  /** 可访问性 0-1 */
  accessibility: number | null
  /** 成本评级 */
  costRating: 'low' | 'medium' | 'high' | 'unknown'

  /** 数量/容量描述 */
  capacity: string | null

  /** 来源 refs */
  sourceRefs: ResourceSourceRef[]
  sourceHashes: Record<string, string>

  /** 约束代码 */
  constraintCodes: ResourceWarningCode[]
  warningCodes: ResourceWarningCode[]

  /** 度量值 */
  metrics: Record<string, number | string | null>
}

// ---------------------------------------------------------------------------
// 机会候选 DTO
// ---------------------------------------------------------------------------

export interface ResourceOpportunityCandidate {
  /**
   * 持久化行 ID。规则引擎产出阶段尚未落库故为 undefined；
   * 经 API 返回的候选一定带 id，前端 review/preview 调用依赖它。
   */
  id?: number

  /** 稳定候选 key（确定性派生） */
  opportunityKey: string
  opportunityType: OpportunityType
  ruleId: string

  /** 审查状态 */
  status: ResourceOpportunityStatus

  /** 评分 */
  severity: OpportunitySeverity
  confidence: number
  /** 影响得分 0-1 */
  impactScore: number

  /** 低敏中文标题 */
  title: string
  /** 确定性理由摘要 */
  rationaleSummary: string

  /** 关联资源 refs */
  resourceRefs: ResourceSourceRef[]
  /** 关联目标 refs（如任务/风险/WBS/知识条目） */
  targetRefs: ResourceSourceRef[]

  /** 建议操作摘要（审查导向，不含自动执行措辞） */
  suggestedActions: string[]

  /** 来源 hash */
  sourceHashes: Record<string, string>

  /** 警告代码 */
  warningCodes: ResourceWarningCode[]

  /** AI 解释 ref */
  aiExplanationRef: string | null

  /** 审查元数据 */
  reviewedBy: number | null
  reviewedAt: string | null

  /** 确定性输出 hash */
  outputHash: string

  createdAt: string
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// 分析运行 DTO
// ---------------------------------------------------------------------------

export interface ResourceAnalysisRun {
  id: number
  organizationId: number
  projectId: number
  actorId: number

  status: ResourceAnalysisRunStatus

  inputSignature: string
  outputHash: string
  ruleVersion: string
  taxonomyVersion: string
  idempotencyKey: string

  /** 来源摘要（低敏） */
  sourceSummary: Record<string, { count: number; hash: string }>
  /** 警告摘要 */
  warningSummary: Array<{ code: ResourceWarningCode; message: string }>
  /** 资源快照数 */
  resourceCount: number
  /** 机会候选数 */
  opportunityCount: number

  costSummary: ResourceAnalysisCost | null

  createdAt: string
  updatedAt: string | null
  completedAt: string | null
  archivedAt: string | null
}

export interface ResourceAnalysisCost {
  provider: string | null
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  estimatedCost: number | null
  latencyMs: number | null
}

// ---------------------------------------------------------------------------
// 分析输入（Collector 产物）
// ---------------------------------------------------------------------------

export interface ResourceAnalysisCollectorInput {
  organizationId: number
  projectId: number
  actorId: number
  /** 用户补充的资源草稿（低敏） */
  manualResourceDrafts?: ManualResourceDraft[]
  /** 用户提供的分析上下文 */
  userContext?: string
  /** 外部提供的幂等 key */
  idempotencyKey?: string
}

export interface ManualResourceDraft {
  label: string
  resourceKind: ResourceKind
  systemScope: SystemScope
  origin: 'user_supplied'
  availability: AvailabilityLevel
  utilizationState: UtilizationState
  capacity: string | null
  costRating: 'low' | 'medium' | 'high' | 'unknown'
  description: string
}

export interface ResourceAnalysisCollectorOutput {
  organizationId: number
  projectId: number
  actorId: number

  // 项目基础事实
  projectName: string
  taskTotal: number
  memberCount: number

  // 正式资源摘要
  projectResourceCount: number
  projectResourceSummary: Array<{
    resourceId: number
    label: string
    resourceKind: ResourceKind
    systemScope: SystemScope
    utilizationState: UtilizationState
    availability: AvailabilityLevel
    hash: string
  }>
  resourceUtilization: number | null
  resourceOverloadCount: number
  resourceGapCount: number

  // 任务/WBS 摘要
  wbsNodeCount: number

  // 风险摘要
  activeRiskCount: number
  highRiskCount: number

  // 文件/知识 refs
  knowledgeRefCount: number

  // Compiler TRIZ artifact 摘要
  compilerTrizArtifactSummaries: Array<{
    artifactId: number
    kind: string
    shortSummary: string
    hash: string
    warnings: string[]
  }>

  // 功能分析/IFR refs
  functionAnalysisRefs: Array<{ artifactId: number; shortSummary: string; hash: string }>
  ifrRefs: Array<{ artifactId: number; shortSummary: string; hash: string }>

  // Workbench/Decision 来源
  workbenchSourceSummaries: Array<{ schemeId: number; title: string; hash: string }>
  decisionLogSummaries: Array<{ logId: number; title: string; hash: string }>

  // 用户补充
  manualResourceDrafts: ManualResourceDraft[]
  userContext: string | null

  // 收集元数据
  warnings: ResourceInputWarning[]
  sourceHashes: Record<string, string>
  collectedAt: string
}

// ---------------------------------------------------------------------------
// AI 解释
// ---------------------------------------------------------------------------

export interface ResourceOpportunityAiExplanation {
  narrative: string
  isFallback: boolean
  hallucinationChecked: boolean
  degradedReason: string | null
  referencedResourceKeys: string[]
  confidence: number
  provider: string | null
  model: string | null
  cost: ResourceAnalysisCost | null
}

// ---------------------------------------------------------------------------
// 确认/交接预览
// ---------------------------------------------------------------------------

export interface ResourceOpportunityConfirmationPreview {
  opportunityKey: string
  opportunityType: OpportunityType
  projectedTitle: string
  projectedResourceRefs: ResourceSourceRef[]
  projectedSuggestedActions: string[]
  sourceHashes: Record<string, string>
  warnings: ResourceWarningCode[]
  stale: boolean
  requiresUserConfirmation: boolean
}

export interface ResourceOpportunityHandoffPreview {
  opportunityKey: string
  targetType: 'workbench' | 'decision_log' | 'draft_layer' | 'resource_preview'
  targetPreview: Record<string, unknown>
  sourceHashes: Record<string, string>
  stale: boolean
  blockingWarnings: ResourceWarningCode[]
}

// ---------------------------------------------------------------------------
// API 请求/响应
// ---------------------------------------------------------------------------

export interface CreateResourceAnalysisRequest {
  manualResourceDrafts?: ManualResourceDraft[]
  userContext?: string
  idempotencyKey?: string
}

export interface CreateResourceAnalysisResponse {
  data: ResourceAnalysisRun & {
    resources: ResourceSnapshot[]
    opportunities: ResourceOpportunityCandidate[]
  }
}

export interface ListResourceAnalysesQuery {
  page?: number
  perPage?: number
  status?: ResourceAnalysisRunStatus
  sort?: string
}

export interface ListResourceAnalysesResponse {
  data: ResourceAnalysisRun[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ResourceAnalysisDetailResponse {
  data: ResourceAnalysisRun
}

export interface ListResourceSnapshotsQuery {
  page?: number
  perPage?: number
  resourceKind?: ResourceKind
  systemScope?: SystemScope
  origin?: ResourceOrigin
  sort?: string
}

export interface ListResourceSnapshotsResponse {
  data: ResourceSnapshot[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ListResourceOpportunitiesQuery {
  page?: number
  perPage?: number
  status?: ResourceOpportunityStatus
  opportunityType?: OpportunityType
  severity?: OpportunitySeverity
  stale?: boolean
  sort?: string
}

export interface ListResourceOpportunitiesResponse {
  data: ResourceOpportunityCandidate[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ResourceOpportunityDetailResponse {
  data: ResourceOpportunityCandidate
}

export interface ExplainResourceOpportunityResponse {
  data: {
    opportunityKey: string
    explanation: ResourceOpportunityAiExplanation
  }
}

export interface ReviewResourceOpportunityRequest {
  action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss'
  reason?: string
}

export interface ReviewResourceOpportunityResponse {
  data: {
    opportunityKey: string
    status: ResourceOpportunityStatus
    reviewedBy: number
    reviewedAt: string
  }
}

export interface ResourceOpportunityConfirmationPreviewResponse {
  data: ResourceOpportunityConfirmationPreview
}

export interface ResourceOpportunityHandoffPreviewResponse {
  data: ResourceOpportunityHandoffPreview
}

// ---------------------------------------------------------------------------
// 确定性纯函数
// ---------------------------------------------------------------------------

/**
 * 计算资源 key（稳定标识符）。
 * 基于资源种类 + 来源 + 标签确定性派生。
 */
export function computeResourceKey(
  resourceKind: ResourceKind,
  origin: ResourceOrigin,
  label: string,
): string {
  return `res-${deterministicHash([resourceKind, origin, label].join('|'))}`
}

/**
 * 计算机会候选 key。
 * 基于机会类型 + 规则 ID + 关联资源 refs 确定性派生。
 */
export function computeResourceOpportunityKey(
  opportunityType: OpportunityType,
  ruleId: string,
  resourceKeys: string[],
): string {
  const sorted = [...resourceKeys].sort()
  return `rop-${deterministicHash([opportunityType, ruleId, ...sorted].join('|'))}`
}

/**
 * 计算资源分析运行的输入签名。
 * 基于收集输出确定性序列化。
 */
export function computeResourceAnalysisInputSignature(
  collected: ResourceAnalysisCollectorOutput,
): string {
  const sorted = {
    org: collected.organizationId,
    project: collected.projectId,
    actor: collected.actorId,
    taskTotal: collected.taskTotal,
    memberCount: collected.memberCount,
    projectResourceCount: collected.projectResourceCount,
    resourceUtilization:
      collected.resourceUtilization === null
        ? null
        : Number(collected.resourceUtilization.toFixed(4)),
    resourceOverloadCount: collected.resourceOverloadCount,
    resourceGapCount: collected.resourceGapCount,
    wbsNodeCount: collected.wbsNodeCount,
    activeRiskCount: collected.activeRiskCount,
    highRiskCount: collected.highRiskCount,
    knowledgeRefCount: collected.knowledgeRefCount,
    compilerHashes: collected.compilerTrizArtifactSummaries.map((a) => a.hash).sort(),
    functionAnalysisHashes: collected.functionAnalysisRefs.map((r) => r.hash).sort(),
    ifrHashes: collected.ifrRefs.map((r) => r.hash).sort(),
    workbenchHashes: collected.workbenchSourceSummaries.map((s) => s.hash).sort(),
    decisionLogHashes: collected.decisionLogSummaries.map((d) => d.hash).sort(),
    manualDraftLabels: collected.manualResourceDrafts
      .map((d) => `${d.resourceKind}:${d.label}`)
      .sort(),
    userContext: collected.userContext ?? '',
    warnings: [...collected.warnings].map((w) => `${w.source ?? ''}:${w.code}:${w.message}`).sort(),
  }
  return `tra-${deterministicHash(JSON.stringify(sorted))}`
}

/**
 * 计算资源分析的幂等 key。
 */
export function computeResourceAnalysisIdempotencyKey(
  organizationId: number,
  projectId: number,
  actorId: number,
  inputSignature: string,
  userProvidedKey?: string,
): string {
  const base = userProvidedKey ?? `${organizationId}|${projectId}|${actorId}|${inputSignature}`
  return `tra-idem-${deterministicHash(base)}`
}

/**
 * 计算资源机会候选集合的确定性输出 hash。
 */
export function computeResourceOpportunitiesOutputHash(
  opportunities: Pick<ResourceOpportunityCandidate, 'opportunityKey'>[],
): string {
  const keys = opportunities.map((o) => o.opportunityKey).sort()
  return `tro-${deterministicHash(keys.join('|'))}`
}

/**
 * 计算资源快照集合的确定性输出 hash。
 */
export function computeResourceSnapshotsOutputHash(
  resources: Pick<ResourceSnapshot, 'resourceKey'>[],
): string {
  const keys = resources.map((r) => r.resourceKey).sort()
  return `trs-${deterministicHash(keys.join('|'))}`
}

/**
 * 资源机会候选稳定排序比较器：
 * 严重度 → 置信度 → 影响分数 → 机会类型 → opportunityKey。
 */
export function compareResourceOpportunity(
  a: ResourceOpportunityCandidate,
  b: ResourceOpportunityCandidate,
): number {
  const sevOrder: OpportunitySeverity[] = ['critical', 'high', 'medium', 'low']
  const bySev = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
  if (bySev !== 0) return bySev
  const byConf = (b.confidence ?? 0) - (a.confidence ?? 0)
  if (Math.abs(byConf) > 1e-9) return byConf
  const byImpact = (b.impactScore ?? 0) - (a.impactScore ?? 0)
  if (Math.abs(byImpact) > 1e-9) return byImpact
  if (a.opportunityType !== b.opportunityType)
    return a.opportunityType.localeCompare(b.opportunityType)
  return a.opportunityKey.localeCompare(b.opportunityKey)
}

/**
 * 资源快照稳定排序比较器：
 * 种类 → 系统作用域 → 来源 → resourceKey。
 */
export function compareResourceSnapshot(a: ResourceSnapshot, b: ResourceSnapshot): number {
  if (a.resourceKind !== b.resourceKind) return a.resourceKind.localeCompare(b.resourceKind)
  if (a.systemScope !== b.systemScope) return a.systemScope.localeCompare(b.systemScope)
  if (a.origin !== b.origin) return a.origin.localeCompare(b.origin)
  return a.resourceKey.localeCompare(b.resourceKey)
}

/**
 * 归一化严重度到数值（用于 impactScore 计算）。
 */
export function resourceSeverityToScore(severity: OpportunitySeverity): number {
  const map: Record<OpportunitySeverity, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  }
  return map[severity] ?? 0.25
}

/**
 * 计算资源机会的 impactScore（0–1）。
 * 综合严重度(40%)、置信度(30%)、资源覆盖度(30%)。
 */
export function computeResourceOpportunityImpactScore(
  severity: OpportunitySeverity,
  confidence: number,
  resourceRefCount: number,
): number {
  const sevScore = resourceSeverityToScore(severity) * 0.4
  const confScore = (confidence ?? 0.5) * 0.3
  const resScore = Math.min(1, resourceRefCount / 5) * 0.3
  return Number((sevScore + confScore + resScore).toFixed(2))
}

/**
 * 聚合警告摘要字符串。
 */
export function summarizeResourceWarnings(codes: ResourceWarningCode[]): string {
  if (codes.length === 0) return ''
  const labels: Record<ResourceWarningCode, string> = {
    DATA_SOURCE_UNAVAILABLE: '数据来源不可用',
    INSUFFICIENT_RESOURCE_SOURCE: '资源来源不足',
    PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
    SOURCE_STALE: '来源数据已过期',
    SOURCE_HIDDEN: '来源数据已脱敏',
    EXTERNAL_SOURCE_NOT_AUTHORIZED: '外部来源未授权',
    BUDGET_SOURCE_DEGRADED: '预算来源已降级',
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
 * 判定机会候选是否陈旧（基于来源 hash 比对）。
 */
export function isResourceOpportunityStale(
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
export function isResourceAnalysisRunStale(
  runSourceHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): boolean {
  return isResourceOpportunityStale(runSourceHashes, currentHashes)
}

/**
 * 判定可用性等级的数值化（用于规则引擎排序/评分）。
 */
export function availabilityToScore(availability: AvailabilityLevel): number {
  const map: Record<AvailabilityLevel, number> = {
    high: 1.0,
    medium: 0.6,
    low: 0.3,
    none: 0.0,
    unknown: 0.2,
  }
  return map[availability] ?? 0.2
}

/**
 * 判定利用状态到数值化（低利用 → 高机会）。
 */
export function utilizationToOpportunityScore(state: UtilizationState): number {
  const map: Record<UtilizationState, number> = {
    idle: 1.0,
    partially_utilized: 0.7,
    fully_utilized: 0.1,
    overloaded: 0.4,
    unavailable: 0.0,
    unknown: 0.3,
  }
  return map[state] ?? 0.3
}

// ---------------------------------------------------------------------------
// 低敏夹具构造器
// ---------------------------------------------------------------------------

export function makeResourceAnalysisCollectorOutput(
  overrides?: Partial<ResourceAnalysisCollectorOutput>,
): ResourceAnalysisCollectorOutput {
  return {
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    projectName: '测试项目',
    taskTotal: 30,
    memberCount: 8,
    projectResourceCount: 10,
    projectResourceSummary: [
      {
        resourceId: 1,
        label: '后端工程师-张三',
        resourceKind: 'human',
        systemScope: 'internal_system',
        utilizationState: 'fully_utilized',
        availability: 'low',
        hash: 'res-h1',
      },
      {
        resourceId: 2,
        label: '测试服务器',
        resourceKind: 'technical',
        systemScope: 'internal_system',
        utilizationState: 'idle',
        availability: 'high',
        hash: 'res-h2',
      },
      {
        resourceId: 3,
        label: '云存储额度',
        resourceKind: 'technical',
        systemScope: 'supersystem',
        utilizationState: 'partially_utilized',
        availability: 'high',
        hash: 'res-h3',
      },
    ],
    resourceUtilization: 0.68,
    resourceOverloadCount: 2,
    resourceGapCount: 1,
    wbsNodeCount: 12,
    activeRiskCount: 4,
    highRiskCount: 2,
    knowledgeRefCount: 5,
    compilerTrizArtifactSummaries: [],
    functionAnalysisRefs: [],
    ifrRefs: [],
    workbenchSourceSummaries: [],
    decisionLogSummaries: [],
    manualResourceDrafts: [],
    userContext: null,
    warnings: [],
    sourceHashes: { project_resources: 'abc', risks: 'def' },
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function makeResourceSnapshotFixture(
  overrides?: Partial<ResourceSnapshot>,
): ResourceSnapshot {
  return {
    resourceKey: 'res-test001',
    label: '后端工程师-张三',
    resourceKind: 'human',
    systemScope: 'internal_system',
    origin: 'project_registry',
    availability: 'medium',
    utilizationState: 'fully_utilized',
    utilizationRate: 0.9,
    accessibility: 0.8,
    costRating: 'high',
    capacity: '1 FTE',
    sourceRefs: [
      {
        origin: 'project_registry',
        entityType: 'resource',
        entityId: 1,
        lowSensitiveTitle: '项目资源分配记录',
        hash: 'res-h1',
      },
    ],
    sourceHashes: { project_resources: 'res-h1' },
    constraintCodes: [],
    warningCodes: [],
    metrics: { allocatedHours: 160, availableHours: 40 },
    ...overrides,
  }
}

export function makeResourceOpportunityFixture(
  overrides?: Partial<ResourceOpportunityCandidate>,
): ResourceOpportunityCandidate {
  return {
    opportunityKey: 'rop-test001',
    opportunityType: 'idle_capacity',
    ruleId: 'RO-001',
    status: 'unreviewed',
    severity: 'high',
    confidence: 0.85,
    impactScore: 0.76,
    title: '测试服务器存在大量闲置算力',
    rationaleSummary: '测试服务器当前利用率仅15%，可在非测试窗口复用为 CI/构建节点或训练环境。',
    resourceRefs: [
      {
        origin: 'project_registry',
        entityType: 'resource',
        entityId: 2,
        lowSensitiveTitle: '项目资源分配记录',
        hash: 'res-h2',
      },
    ],
    targetRefs: [],
    suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
    sourceHashes: { project_resources: 'res-h2' },
    warningCodes: [],
    aiExplanationRef: null,
    reviewedBy: null,
    reviewedAt: null,
    outputHash: 'tro-test-output',
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  }
}

export function makeResourceAnalysisRunFixture(
  overrides?: Partial<ResourceAnalysisRun>,
): ResourceAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    status: 'completed_with_warnings',
    inputSignature: 'tra-test',
    outputHash: 'tro-test',
    ruleVersion: RESOURCE_RULESET_VERSION,
    taxonomyVersion: RESOURCE_TAXONOMY_VERSION,
    idempotencyKey: 'tra-idem-test',
    sourceSummary: { project_resources: { count: 10, hash: 'abc' } },
    warningSummary: [],
    resourceCount: 10,
    opportunityCount: 3,
    costSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    completedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  }
}
