// @aiproj/types — V3 TRIZ 进化趋势分析共享契约（前后端共享）
// v3-triz-evolution-trend-analysis / §2.1–§2.9
//
// 设计要点：
// - TRIZ 技术系统进化 8 大趋势：完备性、能量/信息传递、动态化、子系统不均衡进化、
//   向超系统进化、微观化、理想度增长、协调性。
// - 确定性优先：input signature / idempotency key / trend key / risk key / output hash 保证可复现。
// - 趋势评分与风险候选是「诊断与预警产物」，不是正式路线图或风险登记册。
// - 全部「只建议、不自动执行」；AI 解释可选且可降级；handoff 只停在 preview。
// - 不自动写路线图/任务/依赖/资源/风险/排期/范围/里程碑/预算/文件。

import { deterministicHash } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 进化趋势分析运行状态 */
export const EVOLUTION_TREND_RUN_STATUSES = [
  'queued',
  'completed',
  'completed_with_warnings',
  'failed',
  'stale',
  'archived',
] as const
export type EvolutionTrendRunStatus = (typeof EVOLUTION_TREND_RUN_STATUSES)[number]

/** 趋势风险候选审查状态 */
export const TREND_RISK_STATUSES = [
  'unreviewed',
  'reviewed',
  'previewed',
  'blocked_stale',
  'dismissed',
] as const
export type TrendRiskStatus = (typeof TREND_RISK_STATUSES)[number]

/** 分析范围类型 */
export const EVOLUTION_TREND_SCOPE_TYPES = [
  'project',
  'subsystem',
  'technology_stack',
  'custom',
] as const
export type EvolutionTrendScopeType = (typeof EVOLUTION_TREND_SCOPE_TYPES)[number]

/** TRIZ 技术系统进化 8 大趋势 */
export const EVOLUTION_TREND_IDS = [
  'completeness',
  'energy_information_transmission',
  'dynamization',
  'uneven_subsystem_evolution',
  'transition_to_supersystem',
  'micro_level_transition',
  'ideality_increase',
  'coordination',
] as const
export type EvolutionTrendId = (typeof EVOLUTION_TREND_IDS)[number]

/** 8 大趋势中文标签（低敏展示用） */
export const EVOLUTION_TREND_LABELS: Record<EvolutionTrendId, string> = {
  completeness: '完备性',
  energy_information_transmission: '能量/信息传递',
  dynamization: '动态化',
  uneven_subsystem_evolution: '子系统不均衡进化',
  transition_to_supersystem: '向超系统进化',
  micro_level_transition: '微观化',
  ideality_increase: '理想度增长',
  coordination: '协调性',
}

/** 趋势演进阶段 */
export const EVOLUTION_TREND_STAGES = ['nascent', 'developing', 'established', 'advanced'] as const
export type EvolutionTrendStage = (typeof EVOLUTION_TREND_STAGES)[number]

/** 趋势方向 */
export const EVOLUTION_TREND_DIRECTIONS = ['improving', 'stable', 'declining', 'unknown'] as const
export type EvolutionTrendDirection = (typeof EVOLUTION_TREND_DIRECTIONS)[number]

/** 趋势风险候选类型（8 种，与 8 大趋势一一对应） */
export const TREND_RISK_TYPES = [
  'role_gap',
  'information_flow_delay',
  'process_rigidity',
  'subsystem_imbalance',
  'external_dependency_bottleneck',
  'complexity_granularity_risk',
  'ideality_decline',
  'coordination_drift',
] as const
export type TrendRiskType = (typeof TREND_RISK_TYPES)[number]

/** 趋势风险类型 → 关联趋势 */
export const TREND_RISK_TYPE_TREND_MAP: Record<TrendRiskType, EvolutionTrendId> = {
  role_gap: 'completeness',
  information_flow_delay: 'energy_information_transmission',
  process_rigidity: 'dynamization',
  subsystem_imbalance: 'uneven_subsystem_evolution',
  external_dependency_bottleneck: 'transition_to_supersystem',
  complexity_granularity_risk: 'micro_level_transition',
  ideality_decline: 'ideality_increase',
  coordination_drift: 'coordination',
}

/** 趋势风险类型中文标签 */
export const TREND_RISK_TYPE_LABELS: Record<TrendRiskType, string> = {
  role_gap: '角色/能力缺口',
  information_flow_delay: '信息流转迟滞',
  process_rigidity: '变更响应僵化',
  subsystem_imbalance: '子系统进度不均衡',
  external_dependency_bottleneck: '外部依赖瓶颈',
  complexity_granularity_risk: '复杂度/粒度风险',
  ideality_decline: '投入产出恶化',
  coordination_drift: '团队节奏失配',
}

/** 趋势输入来源类型 */
export const EVOLUTION_TREND_SOURCE_KINDS = [
  'project_metadata',
  'members',
  'tasks_wbs',
  'dependencies',
  'resources',
  'risks',
  'changes',
  'compiler_triz',
  'ifr',
  'function_analysis',
  'resource_analysis',
  'workbench',
  'decision_log',
  'manual_signal',
] as const
export type EvolutionTrendSourceKind = (typeof EVOLUTION_TREND_SOURCE_KINDS)[number]

/** 进化趋势分析警告代码 */
export const EVOLUTION_TREND_WARNING_CODES = [
  'DATA_SOURCE_UNAVAILABLE',
  'INSUFFICIENT_TREND_SOURCE',
  'PERMISSION_RESTRICTED',
  'SOURCE_STALE',
  'SOURCE_HIDDEN',
  'EXTERNAL_SOURCE_NOT_AUTHORIZED',
  'INSUFFICIENT_HISTORY',
  'FORECAST_SUPPRESSED',
  'AI_EXPLANATION_FALLBACK',
  'AI_EXPLANATION_BLOCKED',
  'HANDOFF_BLOCKED_STALE',
] as const
export type EvolutionTrendWarningCode = (typeof EVOLUTION_TREND_WARNING_CODES)[number]

/** 趋势严重度（复用 TRIZ severity 语义） */
export const TREND_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type TrendSeverity = (typeof TREND_SEVERITIES)[number]

/** 进化趋势规则集版本 */
export const EVOLUTION_TREND_RULESET_VERSION = '1.0.0'

/** 8 大趋势 taxonomy 版本 */
export const EVOLUTION_TREND_TAXONOMY_VERSION = '1.0.0'

/** 趋势列表排序字段 */
export const EVOLUTION_TREND_SORT_FIELDS = [
  'createdAt',
  'severity',
  'confidence',
  'impactScore',
  'score',
  'status',
] as const
export type EvolutionTrendSortField = (typeof EVOLUTION_TREND_SORT_FIELDS)[number]

/** 历史对比模式 */
export const HISTORY_COMPARISON_MODES = ['latest_prior', 'explicit_baseline'] as const
export type HistoryComparisonMode = (typeof HISTORY_COMPARISON_MODES)[number]

/** 触发预测抑制所需的最少历史样本数 */
export const MIN_HISTORY_SAMPLES_FOR_FORECAST = 2

// ---------------------------------------------------------------------------
// 来源 ref 与警告（低敏共享）
// ---------------------------------------------------------------------------

export interface EvolutionTrendSourceRef {
  sourceKind: EvolutionTrendSourceKind
  entityType: string
  entityId: number | null
  lowSensitiveTitle: string
  hash: string
}

export interface EvolutionTrendInputWarning {
  code: EvolutionTrendWarningCode
  source: string | null
  message: string
}

// ---------------------------------------------------------------------------
// 趋势评分快照 DTO
// ---------------------------------------------------------------------------

export interface EvolutionTrendScore {
  /**
   * 持久化行 ID。规则引擎产出阶段尚未落库故为 undefined；
   * 经 API 返回的趋势评分一定带 id。
   */
  id?: number

  /** 稳定趋势 key（确定性派生） */
  trendKey: string
  /** 8 大趋势之一 */
  trendId: EvolutionTrendId

  /** 演进阶段 */
  stage: EvolutionTrendStage
  /** 归一化评分 0-1（越高表示该趋势演进越充分/健康） */
  score: number
  /** 置信度 0-1（来源覆盖不足时降级） */
  confidence: number
  /** 风险严重度 */
  severity: TrendSeverity
  /** 趋势方向 */
  direction: EvolutionTrendDirection

  /** 来源 refs（低敏） */
  sourceRefs: EvolutionTrendSourceRef[]
  /** 来源 hash */
  sourceHashes: Record<string, string>

  /** 度量值 */
  metrics: Record<string, number | string | null>

  /** 警告代码 */
  warningCodes: EvolutionTrendWarningCode[]

  createdAt: string
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// 趋势风险候选 DTO
// ---------------------------------------------------------------------------

export interface EvolutionTrendRiskCandidate {
  /**
   * 持久化行 ID。规则引擎产出阶段尚未落库故为 undefined；
   * 经 API 返回的候选一定带 id，前端 review/preview 调用依赖它。
   */
  id?: number

  /** 稳定候选 key（确定性派生） */
  riskKey: string
  /** 风险类型 */
  riskType: TrendRiskType
  /** 主要关联趋势 */
  trendId: EvolutionTrendId
  /** 规则 ID */
  ruleId: string

  /** 审查状态 */
  status: TrendRiskStatus

  /** 评分 */
  severity: TrendSeverity
  confidence: number
  /** 影响得分 0-1 */
  impactScore: number

  /** 低敏中文标题 */
  title: string
  /** 确定性理由摘要 */
  rationaleSummary: string

  /** 关联趋势 refs */
  trendRefs: string[]
  /** 关联目标 refs（如任务/依赖/成员角色/WBS） */
  targetRefs: EvolutionTrendSourceRef[]

  /** 建议操作摘要（审查导向，不含自动执行措辞） */
  suggestedActions: string[]

  /** 来源 hash */
  sourceHashes: Record<string, string>

  /** 警告代码 */
  warningCodes: EvolutionTrendWarningCode[]

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

export interface EvolutionTrendAnalysisCost {
  provider: string | null
  model: string | null
  promptTokens: number | null
  completionTokens: number | null
  estimatedCost: number | null
  latencyMs: number | null
}

export interface EvolutionTrendAnalysisRun {
  id: number
  organizationId: number
  projectId: number
  actorId: number

  status: EvolutionTrendRunStatus
  scopeType: EvolutionTrendScopeType

  inputSignature: string
  outputHash: string
  ruleVersion: string
  taxonomyVersion: string
  idempotencyKey: string

  /** 来源摘要（低敏：仅计数 + hash） */
  sourceSummary: Record<string, { count: number; hash: string }>
  /** 警告摘要 */
  warningSummary: Array<{ code: EvolutionTrendWarningCode; message: string }>
  /** 趋势评分数（恒为 8，缺失来源时评分降级但维度齐全） */
  trendCount: number
  /** 风险候选数 */
  riskCount: number

  costSummary: EvolutionTrendAnalysisCost | null

  createdAt: string
  updatedAt: string | null
  completedAt: string | null
  archivedAt: string | null
}

// ---------------------------------------------------------------------------
// 历史对比 DTO
// ---------------------------------------------------------------------------

export interface EvolutionTrendDelta {
  trendId: EvolutionTrendId
  trendKey: string
  currentScore: number
  baselineScore: number
  scoreDelta: number
  currentStage: EvolutionTrendStage
  baselineStage: EvolutionTrendStage
  stageChanged: boolean
  direction: EvolutionTrendDirection
}

export interface EvolutionTrendRiskDeltaSummary {
  newRiskCount: number
  resolvedRiskCount: number
  persistentRiskCount: number
  severityUpgradedCount: number
  severityDowngradedCount: number
  newRiskKeys: string[]
  resolvedRiskKeys: string[]
}

export interface EvolutionTrendSourceHashComparison {
  matched: string[]
  changed: string[]
  added: string[]
  removed: string[]
}

export interface EvolutionTrendHistoryComparison {
  runId: number
  baselineRunId: number | null
  comparisonMode: HistoryComparisonMode
  scopeType: EvolutionTrendScopeType

  trendDeltas: EvolutionTrendDelta[]
  riskDeltaSummary: EvolutionTrendRiskDeltaSummary
  sourceHashComparison: EvolutionTrendSourceHashComparison

  /** 警告变化 */
  warningChanges: {
    added: EvolutionTrendWarningCode[]
    removed: EvolutionTrendWarningCode[]
  }

  /** 任一来源 hash 失配则为 true */
  stale: boolean

  /** 历史样本不足时抑制预测 */
  forecastSuppressed: boolean
  /** 确定性、advisory 的短期方向提示（样本不足时为 null） */
  forecast: Array<{
    trendId: EvolutionTrendId
    direction: EvolutionTrendDirection
    advisoryNote: string
  }> | null

  warningCodes: EvolutionTrendWarningCode[]
  createdAt: string
}

// ---------------------------------------------------------------------------
// 分析输入（Collector 产物）
// ---------------------------------------------------------------------------

export interface ManualTrendSignal {
  /** 关联趋势（可选，空表示通用信号） */
  trendId: EvolutionTrendId | null
  /** 信号方向 */
  direction: EvolutionTrendDirection
  /** 低敏信号描述（用户补充的外部演进信号） */
  signal: string
  /** 低敏来源说明 */
  sourceNote: string | null
}

export interface EvolutionTrendCollectorInput {
  organizationId: number
  projectId: number
  actorId: number
  scopeType?: EvolutionTrendScopeType
  /** 用户补充的趋势信号（低敏） */
  manualTrendSignals?: ManualTrendSignal[]
  /** 用户提供的分析上下文 */
  userContext?: string
  /** 外部提供的幂等 key */
  idempotencyKey?: string
}

export interface EvolutionTrendCollectorOutput {
  organizationId: number
  projectId: number
  actorId: number
  scopeType: EvolutionTrendScopeType

  // 项目基础事实
  projectName: string
  projectStatus: string | null
  taskTotal: number
  taskCompleted: number
  memberCount: number

  // 成员角色摘要（完备性）
  memberRoleSummaries: Array<{
    roleKey: string
    memberCount: number
    hash: string
  }>
  distinctRoleCount: number
  singlePersonRoleCount: number

  // 任务/WBS/依赖摘要
  wbsNodeCount: number
  subsystemProgressSpread: number | null
  blockedTaskCount: number
  averageBlockedWaitDays: number | null
  dependencyCount: number
  externalDependencyCount: number
  unhealthyExternalDependencyCount: number

  // 资源摘要
  resourceUtilization: number | null
  resourceOverloadCount: number
  resourceGapCount: number

  // 风险摘要
  activeRiskCount: number
  highRiskCount: number

  // 变更/审计摘要（动态化）
  changeRequestCount: number
  averageChangeResponseDays: number | null
  reworkRatio: number | null

  // 微观化信号
  averageTaskGranularityDays: number | null
  deepWbsLevelCount: number

  // 理想度信号
  deliveredValueItemCount: number
  costGrowthSignals: number
  harmOrRiskGrowthSignals: number

  // 协调性信号
  dependencyRhythmMismatchCount: number
  resourceLoadSyncSpread: number | null

  // Compiler TRIZ artifact 摘要
  compilerTrizArtifactSummaries: Array<{
    artifactId: number
    kind: string
    shortSummary: string
    hash: string
    warnings: string[]
  }>

  // IFR/功能分析/资源分析 refs
  ifrRefs: Array<{ artifactId: number; shortSummary: string; hash: string }>
  functionAnalysisRefs: Array<{ artifactId: number; shortSummary: string; hash: string }>
  resourceAnalysisRefs: Array<{ artifactId: number; shortSummary: string; hash: string }>

  // Workbench/Decision 来源
  workbenchSourceSummaries: Array<{ schemeId: number; title: string; hash: string }>
  decisionLogSummaries: Array<{ logId: number; title: string; hash: string }>

  // 用户补充
  manualTrendSignals: ManualTrendSignal[]
  userContext: string | null

  // 历史样本（同项目同 scope 的既有 run 数，用于预测抑制判定）
  priorRunCount: number

  // 收集元数据
  warnings: EvolutionTrendInputWarning[]
  sourceHashes: Record<string, string>
  collectedAt: string
}

// ---------------------------------------------------------------------------
// AI 解释
// ---------------------------------------------------------------------------

export interface EvolutionTrendAiExplanation {
  narrative: string
  isFallback: boolean
  hallucinationChecked: boolean
  degradedReason: string | null
  referencedTrendKeys: string[]
  referencedRiskKeys: string[]
  confidence: number
  provider: string | null
  model: string | null
  cost: EvolutionTrendAnalysisCost | null
}

// ---------------------------------------------------------------------------
// 确认/交接预览
// ---------------------------------------------------------------------------

export type EvolutionTrendPreviewTarget =
  'workbench' | 'decision_log' | 'draft_layer' | 'risk_preview'

export interface EvolutionTrendHandoffPreview {
  runId: number
  riskKey: string
  riskType: TrendRiskType
  targetType: EvolutionTrendPreviewTarget
  /** 候选输入（低敏，供目标链路预览/确认） */
  candidateInput: Record<string, unknown>
  trendRefs: string[]
  sourceHashes: Record<string, string>
  warnings: EvolutionTrendWarningCode[]
  actorId: number
  organizationId: number
  projectId: number
  idempotencyKey: string
  stale: boolean
  blockingWarnings: EvolutionTrendWarningCode[]
  requiresUserConfirmation: boolean
}

// ---------------------------------------------------------------------------
// API 请求/响应
// ---------------------------------------------------------------------------

export interface CreateEvolutionTrendAnalysisRequest {
  scopeType?: EvolutionTrendScopeType
  manualTrendSignals?: ManualTrendSignal[]
  userContext?: string
  idempotencyKey?: string
}

export interface CreateEvolutionTrendAnalysisResponse {
  data: EvolutionTrendAnalysisRun & {
    trends: EvolutionTrendScore[]
    risks: EvolutionTrendRiskCandidate[]
  }
}

export interface ListEvolutionTrendAnalysesQuery {
  page?: number
  perPage?: number
  status?: EvolutionTrendRunStatus
  scopeType?: EvolutionTrendScopeType
  sort?: string
}

export interface ListEvolutionTrendAnalysesResponse {
  data: EvolutionTrendAnalysisRun[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface EvolutionTrendAnalysisDetailResponse {
  data: EvolutionTrendAnalysisRun
}

export interface ListEvolutionTrendScoresQuery {
  page?: number
  perPage?: number
  trendId?: EvolutionTrendId
  severity?: TrendSeverity
  sort?: string
}

export interface ListEvolutionTrendScoresResponse {
  data: EvolutionTrendScore[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface ListEvolutionTrendRisksQuery {
  page?: number
  perPage?: number
  status?: TrendRiskStatus
  riskType?: TrendRiskType
  trendId?: EvolutionTrendId
  severity?: TrendSeverity
  stale?: boolean
  sort?: string
}

export interface ListEvolutionTrendRisksResponse {
  data: EvolutionTrendRiskCandidate[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface EvolutionTrendHistoryQuery {
  baselineRunId?: number
}

export interface EvolutionTrendHistoryResponse {
  data: EvolutionTrendHistoryComparison
}

export interface ExplainEvolutionTrendRiskResponse {
  data: {
    riskKey: string
    explanation: EvolutionTrendAiExplanation
  }
}

export interface ReviewEvolutionTrendRiskRequest {
  action: 'mark_reviewed' | 'mark_unreviewed' | 'dismiss'
  reason?: string
}

export interface ReviewEvolutionTrendRiskResponse {
  data: {
    riskKey: string
    status: TrendRiskStatus
    reviewedBy: number
    reviewedAt: string
  }
}

export interface EvolutionTrendHandoffPreviewRequest {
  /** 调用方提供的当前来源 hash（用于 stale 校验） */
  currentSourceHashes?: Record<string, string>
}

export interface EvolutionTrendHandoffPreviewResponse {
  data: EvolutionTrendHandoffPreview
}

// ---------------------------------------------------------------------------
// 确定性纯函数 — key / hash / signature
// ---------------------------------------------------------------------------

/**
 * 计算趋势 key（稳定标识符）。
 * 基于项目 + 趋势 id + scope 确定性派生。
 */
export function computeTrendKey(
  projectId: number,
  trendId: EvolutionTrendId,
  scopeType: EvolutionTrendScopeType,
): string {
  return `trk-${deterministicHash([projectId, trendId, scopeType].join('|'))}`
}

/**
 * 计算趋势风险候选 key。
 * 基于风险类型 + 规则 ID + 关联趋势 key + 目标 ref hash 确定性派生。
 */
export function computeTrendRiskKey(
  riskType: TrendRiskType,
  ruleId: string,
  trendKeys: string[],
  targetHashes: string[],
): string {
  const sortedTrends = [...trendKeys].sort()
  const sortedTargets = [...targetHashes].sort()
  return `trr-${deterministicHash([riskType, ruleId, ...sortedTrends, ...sortedTargets].join('|'))}`
}

/**
 * 计算进化趋势分析运行的输入签名。
 * 基于收集输出确定性序列化。
 */
export function computeEvolutionTrendInputSignature(
  collected: EvolutionTrendCollectorOutput,
): string {
  const sorted = {
    org: collected.organizationId,
    project: collected.projectId,
    actor: collected.actorId,
    scope: collected.scopeType,
    taskTotal: collected.taskTotal,
    taskCompleted: collected.taskCompleted,
    memberCount: collected.memberCount,
    memberRoleHashes: collected.memberRoleSummaries.map((r) => r.hash).sort(),
    distinctRoleCount: collected.distinctRoleCount,
    singlePersonRoleCount: collected.singlePersonRoleCount,
    wbsNodeCount: collected.wbsNodeCount,
    subsystemProgressSpread: round4(collected.subsystemProgressSpread),
    blockedTaskCount: collected.blockedTaskCount,
    averageBlockedWaitDays: round4(collected.averageBlockedWaitDays),
    dependencyCount: collected.dependencyCount,
    externalDependencyCount: collected.externalDependencyCount,
    unhealthyExternalDependencyCount: collected.unhealthyExternalDependencyCount,
    resourceUtilization: round4(collected.resourceUtilization),
    resourceOverloadCount: collected.resourceOverloadCount,
    resourceGapCount: collected.resourceGapCount,
    activeRiskCount: collected.activeRiskCount,
    highRiskCount: collected.highRiskCount,
    changeRequestCount: collected.changeRequestCount,
    averageChangeResponseDays: round4(collected.averageChangeResponseDays),
    reworkRatio: round4(collected.reworkRatio),
    averageTaskGranularityDays: round4(collected.averageTaskGranularityDays),
    deepWbsLevelCount: collected.deepWbsLevelCount,
    deliveredValueItemCount: collected.deliveredValueItemCount,
    costGrowthSignals: collected.costGrowthSignals,
    harmOrRiskGrowthSignals: collected.harmOrRiskGrowthSignals,
    dependencyRhythmMismatchCount: collected.dependencyRhythmMismatchCount,
    resourceLoadSyncSpread: round4(collected.resourceLoadSyncSpread),
    compilerHashes: collected.compilerTrizArtifactSummaries.map((a) => a.hash).sort(),
    ifrHashes: collected.ifrRefs.map((r) => r.hash).sort(),
    functionAnalysisHashes: collected.functionAnalysisRefs.map((r) => r.hash).sort(),
    resourceAnalysisHashes: collected.resourceAnalysisRefs.map((r) => r.hash).sort(),
    workbenchHashes: collected.workbenchSourceSummaries.map((s) => s.hash).sort(),
    decisionLogHashes: collected.decisionLogSummaries.map((d) => d.hash).sort(),
    manualSignals: collected.manualTrendSignals
      .map((s) => `${s.trendId ?? ''}:${s.direction}:${s.signal}`)
      .sort(),
    userContext: collected.userContext ?? '',
    warnings: [...collected.warnings].map((w) => `${w.source ?? ''}:${w.code}:${w.message}`).sort(),
  }
  return `tet-${deterministicHash(JSON.stringify(sorted))}`
}

/**
 * 计算进化趋势分析的幂等 key。
 */
export function computeEvolutionTrendIdempotencyKey(
  organizationId: number,
  projectId: number,
  actorId: number,
  inputSignature: string,
  userProvidedKey?: string,
): string {
  const base = userProvidedKey ?? `${organizationId}|${projectId}|${actorId}|${inputSignature}`
  return `tet-idem-${deterministicHash(base)}`
}

/**
 * 计算趋势评分集合的确定性输出 hash。
 */
export function computeTrendScoresOutputHash(
  trends: Pick<EvolutionTrendScore, 'trendKey'>[],
): string {
  const keys = trends.map((t) => t.trendKey).sort()
  return `tet-t-${deterministicHash(keys.join('|'))}`
}

/**
 * 计算趋势风险候选集合的确定性输出 hash。
 */
export function computeTrendRisksOutputHash(
  risks: Pick<EvolutionTrendRiskCandidate, 'riskKey'>[],
): string {
  const keys = risks.map((r) => r.riskKey).sort()
  return `tet-r-${deterministicHash(keys.join('|'))}`
}

/**
 * 计算单个趋势风险候选的确定性输出 hash。
 */
export function computeTrendRiskOutputHash(
  risk: Pick<
    EvolutionTrendRiskCandidate,
    'riskKey' | 'riskType' | 'severity' | 'confidence' | 'impactScore'
  >,
): string {
  return `tet-ro-${deterministicHash(
    [risk.riskKey, risk.riskType, risk.severity, risk.confidence, risk.impactScore].join('|'),
  )}`
}

// ---------------------------------------------------------------------------
// 确定性纯函数 — 排序 / 聚合 / stale
// ---------------------------------------------------------------------------

/**
 * 趋势风险候选稳定排序比较器：
 * 严重度 → 置信度 → 影响分数 → 风险类型 → riskKey。
 */
export function compareTrendRiskCandidate(
  a: EvolutionTrendRiskCandidate,
  b: EvolutionTrendRiskCandidate,
): number {
  const sevOrder: TrendSeverity[] = ['critical', 'high', 'medium', 'low']
  const bySev = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
  if (bySev !== 0) return bySev
  const byConf = (b.confidence ?? 0) - (a.confidence ?? 0)
  if (Math.abs(byConf) > 1e-9) return byConf
  const byImpact = (b.impactScore ?? 0) - (a.impactScore ?? 0)
  if (Math.abs(byImpact) > 1e-9) return byImpact
  if (a.riskType !== b.riskType) return a.riskType.localeCompare(b.riskType)
  return a.riskKey.localeCompare(b.riskKey)
}

/**
 * 趋势评分稳定排序比较器：
 * 严重度 → 评分升序（短板在前） → trendId → trendKey。
 */
export function compareTrendScore(a: EvolutionTrendScore, b: EvolutionTrendScore): number {
  const sevOrder: TrendSeverity[] = ['critical', 'high', 'medium', 'low']
  const bySev = sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
  if (bySev !== 0) return bySev
  const byScore = (a.score ?? 0) - (b.score ?? 0)
  if (Math.abs(byScore) > 1e-9) return byScore
  if (a.trendId !== b.trendId) return a.trendId.localeCompare(b.trendId)
  return a.trendKey.localeCompare(b.trendKey)
}

/**
 * 聚合警告摘要字符串。
 */
export function summarizeEvolutionTrendWarnings(codes: EvolutionTrendWarningCode[]): string {
  if (codes.length === 0) return ''
  const labels: Record<EvolutionTrendWarningCode, string> = {
    DATA_SOURCE_UNAVAILABLE: '数据来源不可用',
    INSUFFICIENT_TREND_SOURCE: '趋势来源不足',
    PERMISSION_RESTRICTED: '部分来源因权限被隐藏',
    SOURCE_STALE: '来源数据已过期',
    SOURCE_HIDDEN: '来源数据已脱敏',
    EXTERNAL_SOURCE_NOT_AUTHORIZED: '外部来源未授权',
    INSUFFICIENT_HISTORY: '历史样本不足',
    FORECAST_SUPPRESSED: '趋势预测已抑制',
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
 * 判定风险候选是否陈旧（基于来源 hash 比对）。
 */
export function isTrendRiskStale(
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
export function isEvolutionTrendRunStale(
  runSourceHashes: Record<string, string>,
  currentHashes: Record<string, string>,
): boolean {
  return isTrendRiskStale(runSourceHashes, currentHashes)
}

// ---------------------------------------------------------------------------
// 确定性纯函数 — 评分 helpers
// ---------------------------------------------------------------------------

function round4(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(4))
}

/**
 * 归一化评分到 0-1。
 */
export function normalizeTrendScore(raw: number, min = 0, max = 1): number {
  if (max <= min) return 0
  const clamped = Math.min(max, Math.max(min, raw))
  return Number(((clamped - min) / (max - min)).toFixed(2))
}

/**
 * 由归一化评分推导演进阶段。
 */
export function computeTrendStage(score: number): EvolutionTrendStage {
  if (score >= 0.75) return 'advanced'
  if (score >= 0.5) return 'established'
  if (score >= 0.25) return 'developing'
  return 'nascent'
}

/**
 * 由评分增量推导趋势方向。
 */
export function classifyTrendDirection(scoreDelta: number | null): EvolutionTrendDirection {
  if (scoreDelta === null || Number.isNaN(scoreDelta)) return 'unknown'
  if (scoreDelta > 0.05) return 'improving'
  if (scoreDelta < -0.05) return 'declining'
  return 'stable'
}

/**
 * 由评分推导风险严重度（评分越低风险越高）。
 */
export function trendScoreToSeverity(score: number): TrendSeverity {
  if (score < 0.2) return 'critical'
  if (score < 0.4) return 'high'
  if (score < 0.6) return 'medium'
  return 'low'
}

/**
 * 严重度数值化。
 */
export function trendSeverityToScore(severity: TrendSeverity): number {
  const map: Record<TrendSeverity, number> = {
    critical: 1.0,
    high: 0.75,
    medium: 0.5,
    low: 0.25,
  }
  return map[severity] ?? 0.25
}

/**
 * 计算来源覆盖度（0-1）：有数据来源数 / 该趋势期望来源数。
 */
export function computeSourceCoverage(
  availableSourceCount: number,
  expectedSourceCount: number,
): number {
  if (expectedSourceCount <= 0) return 0
  return normalizeTrendScore(availableSourceCount / expectedSourceCount)
}

/**
 * 来源覆盖不足时降级置信度。
 */
export function adjustConfidenceForCoverage(baseConfidence: number, coverage: number): number {
  return Number((baseConfidence * (0.4 + 0.6 * coverage)).toFixed(2))
}

/**
 * 警告严重度：聚合 warning codes 为最严重级别。
 */
export function warningCodesToSeverity(codes: EvolutionTrendWarningCode[]): TrendSeverity {
  const rank: Record<EvolutionTrendWarningCode, number> = {
    DATA_SOURCE_UNAVAILABLE: 3,
    EXTERNAL_SOURCE_NOT_AUTHORIZED: 3,
    HANDOFF_BLOCKED_STALE: 3,
    SOURCE_STALE: 2,
    INSUFFICIENT_TREND_SOURCE: 2,
    INSUFFICIENT_HISTORY: 2,
    FORECAST_SUPPRESSED: 1,
    PERMISSION_RESTRICTED: 1,
    SOURCE_HIDDEN: 1,
    AI_EXPLANATION_FALLBACK: 1,
    AI_EXPLANATION_BLOCKED: 1,
  }
  const max = codes.reduce((acc, c) => Math.max(acc, rank[c] ?? 0), 0)
  if (max >= 3) return 'high'
  if (max === 2) return 'medium'
  return 'low'
}

/**
 * 计算趋势风险候选的 impactScore（0–1）。
 * 综合严重度(35%)、置信度(25%)、趋势低分(25%)、目标覆盖(15%)。
 */
export function computeTrendRiskImpactScore(
  severity: TrendSeverity,
  confidence: number,
  trendScore: number,
  targetRefCount: number,
): number {
  const sevScore = trendSeverityToScore(severity) * 0.35
  const confScore = (confidence ?? 0.5) * 0.25
  const trendWeakness = (1 - (trendScore ?? 0.5)) * 0.25
  const targetScore = Math.min(1, targetRefCount / 5) * 0.15
  return Number((sevScore + confScore + trendWeakness + targetScore).toFixed(2))
}

// ---------------------------------------------------------------------------
// 确定性纯函数 — 历史对比
// ---------------------------------------------------------------------------

/**
 * 计算两轮运行的趋势 delta（按 trendId 对齐，顺序稳定）。
 */
export function computeTrendDeltas(
  current: EvolutionTrendScore[],
  baseline: EvolutionTrendScore[],
): EvolutionTrendDelta[] {
  const baselineByTrend = new Map(baseline.map((t) => [t.trendId, t]))
  const deltas: EvolutionTrendDelta[] = []
  for (const trendId of EVOLUTION_TREND_IDS) {
    const cur = current.find((t) => t.trendId === trendId)
    if (!cur) continue
    const base = baselineByTrend.get(trendId)
    if (!base) {
      deltas.push({
        trendId,
        trendKey: cur.trendKey,
        currentScore: cur.score,
        baselineScore: cur.score,
        scoreDelta: 0,
        currentStage: cur.stage,
        baselineStage: cur.stage,
        stageChanged: false,
        direction: 'unknown',
      })
      continue
    }
    const scoreDelta = Number((cur.score - base.score).toFixed(4))
    deltas.push({
      trendId,
      trendKey: cur.trendKey,
      currentScore: cur.score,
      baselineScore: base.score,
      scoreDelta,
      currentStage: cur.stage,
      baselineStage: base.stage,
      stageChanged: cur.stage !== base.stage,
      direction: classifyTrendDirection(scoreDelta),
    })
  }
  return deltas
}

/**
 * 计算风险 delta 摘要（按 riskKey 对齐）。
 */
export function computeTrendRiskDeltaSummary(
  current: EvolutionTrendRiskCandidate[],
  baseline: EvolutionTrendRiskCandidate[],
): EvolutionTrendRiskDeltaSummary {
  const currentKeys = new Set(current.map((r) => r.riskKey))
  const baselineKeys = new Set(baseline.map((r) => r.riskKey))
  const newRiskKeys = [...currentKeys].filter((k) => !baselineKeys.has(k)).sort()
  const resolvedRiskKeys = [...baselineKeys].filter((k) => !currentKeys.has(k)).sort()
  const baselineByKey = new Map(baseline.map((r) => [r.riskKey, r]))
  let severityUpgradedCount = 0
  let severityDowngradedCount = 0
  for (const cur of current) {
    const base = baselineByKey.get(cur.riskKey)
    if (!base) continue
    const diff = trendSeverityToScore(cur.severity) - trendSeverityToScore(base.severity)
    if (diff > 1e-9) severityUpgradedCount += 1
    else if (diff < -1e-9) severityDowngradedCount += 1
  }
  return {
    newRiskCount: newRiskKeys.length,
    resolvedRiskCount: resolvedRiskKeys.length,
    persistentRiskCount: current.filter((r) => baselineKeys.has(r.riskKey)).length,
    severityUpgradedCount,
    severityDowngradedCount,
    newRiskKeys,
    resolvedRiskKeys,
  }
}

/**
 * 比较两组来源 hash。
 */
export function compareSourceHashes(
  current: Record<string, string>,
  baseline: Record<string, string>,
): EvolutionTrendSourceHashComparison {
  const matched: string[] = []
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []
  for (const key of Object.keys(current).sort()) {
    if (baseline[key] === undefined) added.push(key)
    else if (baseline[key] === current[key]) matched.push(key)
    else changed.push(key)
  }
  for (const key of Object.keys(baseline).sort()) {
    if (current[key] === undefined) removed.push(key)
  }
  return { matched, changed, added, removed }
}

/**
 * 历史样本不足时抑制预测。
 */
export function shouldSuppressForecast(availableSampleCount: number): boolean {
  return availableSampleCount < MIN_HISTORY_SAMPLES_FOR_FORECAST
}

// ---------------------------------------------------------------------------
// 低敏夹具构造器
// ---------------------------------------------------------------------------

export function makeEvolutionTrendCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return {
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    scopeType: 'project',
    projectName: '测试项目',
    projectStatus: 'active',
    taskTotal: 30,
    taskCompleted: 12,
    memberCount: 8,
    memberRoleSummaries: [
      { roleKey: 'developer', memberCount: 4, hash: 'role-h1' },
      { roleKey: 'tester', memberCount: 2, hash: 'role-h2' },
      { roleKey: 'pm', memberCount: 2, hash: 'role-h3' },
    ],
    distinctRoleCount: 3,
    singlePersonRoleCount: 0,
    wbsNodeCount: 12,
    subsystemProgressSpread: 0.2,
    blockedTaskCount: 1,
    averageBlockedWaitDays: 1.5,
    dependencyCount: 6,
    externalDependencyCount: 1,
    unhealthyExternalDependencyCount: 0,
    resourceUtilization: 0.68,
    resourceOverloadCount: 1,
    resourceGapCount: 0,
    activeRiskCount: 3,
    highRiskCount: 1,
    changeRequestCount: 5,
    averageChangeResponseDays: 2.0,
    reworkRatio: 0.1,
    averageTaskGranularityDays: 3.0,
    deepWbsLevelCount: 2,
    deliveredValueItemCount: 10,
    costGrowthSignals: 1,
    harmOrRiskGrowthSignals: 1,
    dependencyRhythmMismatchCount: 0,
    resourceLoadSyncSpread: 0.15,
    compilerTrizArtifactSummaries: [],
    ifrRefs: [],
    functionAnalysisRefs: [],
    resourceAnalysisRefs: [],
    workbenchSourceSummaries: [],
    decisionLogSummaries: [],
    manualTrendSignals: [],
    userContext: null,
    priorRunCount: 0,
    warnings: [],
    sourceHashes: { tasks_wbs: 'abc', members: 'def', risks: 'ghi' },
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

/** 子系统进度严重不均衡场景 */
export function makeSubsystemImbalanceCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return makeEvolutionTrendCollectorOutput({
    subsystemProgressSpread: 0.85,
    resourceLoadSyncSpread: 0.7,
    ...overrides,
  })
}

/** 角色/能力缺口场景 */
export function makeRoleGapCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return makeEvolutionTrendCollectorOutput({
    memberCount: 3,
    memberRoleSummaries: [{ roleKey: 'developer', memberCount: 3, hash: 'role-h1' }],
    distinctRoleCount: 1,
    singlePersonRoleCount: 1,
    resourceGapCount: 2,
    ...overrides,
  })
}

/** 外部依赖瓶颈场景 */
export function makeExternalDependencyBottleneckCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return makeEvolutionTrendCollectorOutput({
    dependencyCount: 12,
    externalDependencyCount: 5,
    unhealthyExternalDependencyCount: 3,
    blockedTaskCount: 4,
    averageBlockedWaitDays: 6.5,
    ...overrides,
  })
}

/** 理想度恶化场景 */
export function makeIdealityDeclineCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return makeEvolutionTrendCollectorOutput({
    deliveredValueItemCount: 2,
    costGrowthSignals: 5,
    harmOrRiskGrowthSignals: 4,
    activeRiskCount: 9,
    highRiskCount: 4,
    reworkRatio: 0.4,
    ...overrides,
  })
}

/** 缺失来源场景（模块不可用 → warning，不当作无风险） */
export function makeMissingSourceCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return makeEvolutionTrendCollectorOutput({
    subsystemProgressSpread: null,
    averageBlockedWaitDays: null,
    resourceUtilization: null,
    averageChangeResponseDays: null,
    reworkRatio: null,
    warnings: [
      {
        code: 'DATA_SOURCE_UNAVAILABLE',
        source: 'resources',
        message: '资源摘要不可用',
      },
      {
        code: 'INSUFFICIENT_TREND_SOURCE',
        source: 'changes',
        message: '变更响应数据来源不足',
      },
    ],
    ...overrides,
  })
}

/** 来源过期场景 */
export function makeStaleSourceCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  return makeEvolutionTrendCollectorOutput({
    warnings: [{ code: 'SOURCE_STALE', source: 'tasks_wbs', message: '任务摘要已过期' }],
    ...overrides,
  })
}

/** 隐藏来源场景（无权限 → 完全省略，不泄露计数/标签/hash） */
export function makeHiddenSourceCollectorOutput(
  overrides?: Partial<EvolutionTrendCollectorOutput>,
): EvolutionTrendCollectorOutput {
  const base = makeEvolutionTrendCollectorOutput(overrides)
  return {
    ...base,
    memberRoleSummaries: [],
    distinctRoleCount: 0,
    singlePersonRoleCount: 0,
    activeRiskCount: 0,
    highRiskCount: 0,
    sourceHashes: { tasks_wbs: base.sourceHashes['tasks_wbs'] ?? 'abc' },
    warnings: [
      ...base.warnings,
      {
        code: 'PERMISSION_RESTRICTED',
        source: null,
        message: '部分来源因权限被隐藏',
      },
    ],
  }
}

export function makeTrendScoreFixture(
  overrides?: Partial<EvolutionTrendScore>,
): EvolutionTrendScore {
  return {
    trendKey: 'trk-test001',
    trendId: 'completeness',
    stage: 'established',
    score: 0.55,
    confidence: 0.8,
    severity: 'medium',
    direction: 'stable',
    sourceRefs: [
      {
        sourceKind: 'members',
        entityType: 'project_member',
        entityId: 1,
        lowSensitiveTitle: '项目成员角色摘要',
        hash: 'role-h1',
      },
    ],
    sourceHashes: { members: 'def' },
    metrics: { distinctRoleCount: 3, singlePersonRoleCount: 0 },
    warningCodes: [],
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  }
}

export function makeTrendRiskCandidateFixture(
  overrides?: Partial<EvolutionTrendRiskCandidate>,
): EvolutionTrendRiskCandidate {
  return {
    riskKey: 'trr-test001',
    riskType: 'subsystem_imbalance',
    trendId: 'uneven_subsystem_evolution',
    ruleId: 'ET-004',
    status: 'unreviewed',
    severity: 'high',
    confidence: 0.85,
    impactScore: 0.72,
    title: '子系统之间进度差异显著',
    rationaleSummary:
      '授权任务/WBS 摘要显示子系统进度差达到 0.85，超过不均衡阈值 0.5，存在集成与交付节奏风险。',
    trendRefs: ['trk-test004'],
    targetRefs: [
      {
        sourceKind: 'tasks_wbs',
        entityType: 'wbs_node',
        entityId: 7,
        lowSensitiveTitle: 'WBS 子系统节点摘要',
        hash: 'wbs-h7',
      },
    ],
    suggestedActions: ['查看依据', '加入方案篮子', '记录审查'],
    sourceHashes: { tasks_wbs: 'abc' },
    warningCodes: [],
    aiExplanationRef: null,
    reviewedBy: null,
    reviewedAt: null,
    outputHash: 'tet-ro-test-output',
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  }
}

export function makeEvolutionTrendAnalysisRunFixture(
  overrides?: Partial<EvolutionTrendAnalysisRun>,
): EvolutionTrendAnalysisRun {
  return {
    id: 1,
    organizationId: 1,
    projectId: 1,
    actorId: 1,
    status: 'completed_with_warnings',
    scopeType: 'project',
    inputSignature: 'tet-test',
    outputHash: 'tet-out-test',
    ruleVersion: EVOLUTION_TREND_RULESET_VERSION,
    taxonomyVersion: EVOLUTION_TREND_TAXONOMY_VERSION,
    idempotencyKey: 'tet-idem-test',
    sourceSummary: { tasks_wbs: { count: 30, hash: 'abc' } },
    warningSummary: [],
    trendCount: 8,
    riskCount: 3,
    costSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    completedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  }
}

export function makeHistoryComparisonFixture(
  overrides?: Partial<EvolutionTrendHistoryComparison>,
): EvolutionTrendHistoryComparison {
  return {
    runId: 2,
    baselineRunId: 1,
    comparisonMode: 'latest_prior',
    scopeType: 'project',
    trendDeltas: EVOLUTION_TREND_IDS.map((trendId) => ({
      trendId,
      trendKey: `trk-${trendId}`,
      currentScore: 0.5,
      baselineScore: 0.5,
      scoreDelta: 0,
      currentStage: 'established' as EvolutionTrendStage,
      baselineStage: 'established' as EvolutionTrendStage,
      stageChanged: false,
      direction: 'stable' as EvolutionTrendDirection,
    })),
    riskDeltaSummary: {
      newRiskCount: 0,
      resolvedRiskCount: 0,
      persistentRiskCount: 3,
      severityUpgradedCount: 0,
      severityDowngradedCount: 0,
      newRiskKeys: [],
      resolvedRiskKeys: [],
    },
    sourceHashComparison: { matched: ['tasks_wbs'], changed: [], added: [], removed: [] },
    warningChanges: { added: [], removed: [] },
    stale: false,
    forecastSuppressed: true,
    forecast: null,
    warningCodes: ['INSUFFICIENT_HISTORY', 'FORECAST_SUPPRESSED'],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}
