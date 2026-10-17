// @aiproj/types — V3 多项目影响分析共享契约（前后端共享）
// v3-multi-project-impact-analysis — §2 共享契约与纯函数
//
// 领域范围：
// - 分析源点、scope、plan、run、snapshot、affected endpoint、path
// - what-if scenario、baseline comparison
// - severity、warning、redaction、stale reason、snapshot status
// - scenario type、follow-up target、feature-unavailable
// - AI explanation draft、audit summary、response envelope
// - 纯函数：scope normalization、stable hash、severity classification
//   redaction warning classification、enum drift guard、baseline vs what-if comparison
//   buffer absorption summary、propagation path summary、stale snapshot detection
//   follow-up draft contract helpers

// ---------------------------------------------------------------------------
// §2.2 枚举
// ---------------------------------------------------------------------------

/** 影响分析严重度 */
export const MULTI_PROJECT_IMPACT_SEVERITIES = [
  'blocker',
  'critical',
  'high',
  'medium',
  'low',
  'none',
] as const
export type MultiProjectImpactSeverity = (typeof MULTI_PROJECT_IMPACT_SEVERITIES)[number]

/** 快照状态 */
export const MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'stale',
] as const
export type MultiProjectImpactSnapshotStatus =
  (typeof MULTI_PROJECT_IMPACT_SNAPSHOT_STATUSES)[number]

/** 警告 code（允许运行时扩展检测但只接受已知码进入稳定 hash） */
export const MULTI_PROJECT_IMPACT_WARNING_CODES = [
  'hidden_dependency_present',
  'hidden_project_present',
  'hidden_task_present',
  'hidden_milestone_present',
  'hidden_owner_present',
  'hidden_resource_present',
  'hidden_risk_present',
  'hidden_okr_present',
  'hidden_bi_metric_present',
  'hidden_evidence_present',
  'stale_source_data',
  'stale_detection_result',
  'stale_risk_summary',
  'stale_resource_summary',
  'stale_okr_summary',
  'stale_bi_summary',
  'source_data_unavailable',
  'detection_unavailable',
  'risk_summary_unavailable',
  'resource_summary_unavailable',
  'okr_summary_unavailable',
  'bi_summary_unavailable',
  'ai_unavailable',
  'feature_disabled',
  'propagation_depth_limit_reached',
  'node_limit_reached',
  'edge_limit_reached',
  'manual_external_reference_ignored',
  'buffer_absorbed',
  'data_quality_flag',
] as const
export type MultiProjectImpactWarningCode = (typeof MULTI_PROJECT_IMPACT_WARNING_CODES)[number]

/** 脱敏原因 */
export const MULTI_PROJECT_IMPACT_REDACTION_REASONS = [
  'hidden_project',
  'hidden_task',
  'hidden_milestone',
  'hidden_owner',
  'hidden_resource',
  'hidden_risk',
  'hidden_okr',
  'hidden_bi_metric',
  'hidden_evidence',
  'permission_denied',
  'cross_organization',
] as const
export type MultiProjectImpactRedactionReason =
  (typeof MULTI_PROJECT_IMPACT_REDACTION_REASONS)[number]

/** 过期原因 */
export const MULTI_PROJECT_IMPACT_STALE_REASONS = [
  'source_data_changed',
  'rule_version_changed',
  'dependency_graph_changed',
  'permission_fingerprint_changed',
  'snapshot_ttl_expired',
  'manual_mark',
] as const
export type MultiProjectImpactStaleReason = (typeof MULTI_PROJECT_IMPACT_STALE_REASONS)[number]

/** What-if 场景类型 */
export const MULTI_PROJECT_IMPACT_SCENARIO_TYPES = [
  'delay',
  'status_change',
  'dependency_disablement',
  'buffer_adjustment',
  'dependency_risk_change',
  'endpoint_completion_assumption',
] as const
export type MultiProjectImpactScenarioType = (typeof MULTI_PROJECT_IMPACT_SCENARIO_TYPES)[number]

/** 后续动作目标能力 */
export const MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS = [
  'multi_project_dependency_crud',
  'dependency_detection_rerun',
  'manual_risk_draft',
  'change_request_summary',
  'report_summary',
  'manual_summary',
] as const
export type MultiProjectImpactFollowUpTarget =
  (typeof MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS)[number]

/** 受影响的维度 */
export const MULTI_PROJECT_IMPACT_DIMENSIONS = [
  'schedule',
  'resource',
  'risk',
  'scope',
  'quality',
  'okr',
  'bi_metric',
  'cost',
] as const
export type MultiProjectImpactDimension = (typeof MULTI_PROJECT_IMPACT_DIMENSIONS)[number]

/** 源点类型（分析触发点类型） */
export const MULTI_PROJECT_IMPACT_SOURCE_TYPES = [
  'project',
  'milestone',
  'task',
  'cross_project_dependency',
  'detection_result',
  'what_if',
] as const
export type MultiProjectImpactSourceType = (typeof MULTI_PROJECT_IMPACT_SOURCE_TYPES)[number]

/** 可见性状态（端点/路径） */
export const MULTI_PROJECT_IMPACT_VISIBILITY = ['visible', 'redacted', 'hidden'] as const
export type MultiProjectImpactVisibility = (typeof MULTI_PROJECT_IMPACT_VISIBILITY)[number]

/** 严重度排序权重 */
export const MULTI_PROJECT_IMPACT_SEVERITY_ORDER: MultiProjectImpactSeverity[] = [
  'blocker',
  'critical',
  'high',
  'medium',
  'low',
  'none',
]

/** 允许的 sort 字段白名单 */
export const MULTI_PROJECT_IMPACT_SORT_FIELDS = [
  'created_at',
  'generated_at',
  'severity',
  'total_affected',
  'status',
] as const
export type MultiProjectImpactSortField = (typeof MULTI_PROJECT_IMPACT_SORT_FIELDS)[number]

// ---------------------------------------------------------------------------
// §2.1 核心 DTO
// ---------------------------------------------------------------------------

/** 分析源点引用 */
export interface MultiProjectImpactSourceRef {
  sourceType: MultiProjectImpactSourceType
  sourceId: number
  sourceLabel: string
  /** 源点所属项目 ID（用于可见性校验） */
  projectId: number
  /** 可选人工描述 */
  description?: string | null
}

/** 有界分析范围 */
export interface MultiProjectImpactScope {
  /** 必须限定到具体项目集合 */
  projectIds: number[]
  /** 可选源点 */
  sources?: MultiProjectImpactSourceRef[]
  /** 最大传播深度（默认 5，上限 10） */
  maxPropagationDepth: number
  /** 最大节点数（默认 500，上限 2000） */
  maxNodes: number
  /** 最大边数（默认 1000，上限 5000） */
  maxEdges: number
  /** 日期窗口起始 */
  dateWindowStart?: string | null
  /** 日期窗口结束 */
  dateWindowEnd?: string | null
  /** What-if 场景数上限（默认 5，上限 20） */
  maxScenarios: number
}

/** 分析计划 */
export interface MultiProjectImpactPlan {
  /** 计划 token（含过期时间） */
  runToken: string
  /** Scope 稳定 hash */
  scopeHash: string
  /** 规则版本（演进管理） */
  ruleVersion: string
  /** 源数据新鲜度 hash */
  sourceFreshnessHash: string
  /** 权限指纹 */
  permissionFingerprint: string
  /** 计划过期时间 */
  expiresAt: string
  /** 预计成本（节点数/边数/场景数估计） */
  estimatedCost: {
    approximateNodes: number
    approximateEdges: number
    estimatedDurationMs: number
  }
  /** Warnings */
  warnings: MultiProjectImpactWarning[]
  /** 分析的 scope（回显） */
  scope: MultiProjectImpactScope
}

/** 分析运行请求（必须引用有效 plan token） */
export interface MultiProjectImpactRunRequest {
  runToken: string
}

/** 受影响端点摘要 */
export interface MultiProjectImpactAffectedEndpoint {
  /** 端点标识（项目/里程碑/任务/依赖 ID + 类型） */
  endpointType: string
  endpointId: number
  endpointLabel: string
  projectId: number
  projectLabel: string
  /** 传播路径深度 */
  depth: number
  /** 传播延期天数 */
  propagatedDelayDays: number
  /** Buffer 吸收天数（0 表示无 buffer 或已耗尽） */
  bufferAbsorbedDays: number
  /** 剩余 buffer 天数 */
  remainingBufferDays: number
  /** Lead/Lag 调整 */
  leadLagAdjustmentDays: number
  /** 严重度 */
  severity: MultiProjectImpactSeverity
  /** 受影响维度 */
  affectedDimensions: MultiProjectImpactDimension[]
  /** 可见性 */
  visibility: MultiProjectImpactVisibility
  /** 脱敏原因（当 visibility !== 'visible' 时） */
  redactionReason?: MultiProjectImpactRedactionReason | null
  /** 低敏证据 hash */
  evidenceHash: string
}

/** 传播路径条目 */
export interface MultiProjectImpactPathEntry {
  fromType: string
  fromId: number
  fromLabel: string
  fromProjectId: number
  toType: string
  toId: number
  toLabel: string
  toProjectId: number
  relationshipType: string
  delayDays: number
  bufferDays: number
  visibility: MultiProjectImpactVisibility
  redactionReason?: MultiProjectImpactRedactionReason | null
  evidenceHash: string
}

/** 传播路径 */
export interface MultiProjectImpactPropagationPath {
  sourceRef: MultiProjectImpactSourceRef
  entries: MultiProjectImpactPathEntry[]
  totalDelayDays: number
  depth: number
  affectedEndpoints: MultiProjectImpactAffectedEndpoint[]
}

/** What-if 场景输入 */
export interface MultiProjectImpactWhatIfScenario {
  scenarioType: MultiProjectImpactScenarioType
  /** 假设描述 */
  assumption: string
  /** 目标端点 */
  targetEndpointType: string
  targetEndpointId: number
  /** 场景参数 */
  params: {
    delayDays?: number
    newStatus?: string
    dependencyIdToDisable?: number
    bufferAdjustmentDays?: number
    newRiskLevel?: string
    completionAssumption?: string
  }
}

/** What-if 场景输出 */
export interface MultiProjectImpactWhatIfOutput {
  scenarioHash: string
  scenario: MultiProjectImpactWhatIfScenario
  /** 假设列表 */
  assumptions: string[]
  /** 基线影响摘要 */
  baseline: {
    totalAffected: number
    severityDistribution: Record<MultiProjectImpactSeverity, number>
    blockedEndpoints: number
  }
  /** 场景影响摘要 */
  scenarioOutput: {
    totalAffected: number
    severityDistribution: Record<MultiProjectImpactSeverity, number>
    blockedEndpoints: number
  }
  /** 变化的受影响端点 */
  changedEndpoints: {
    added: MultiProjectImpactAffectedEndpoint[]
    removed: MultiProjectImpactAffectedEndpoint[]
    severityChanged: {
      endpoint: MultiProjectImpactAffectedEndpoint
      baselineSeverity: MultiProjectImpactSeverity
      newSeverity: MultiProjectImpactSeverity
    }[]
  }
  /** 对比 hash */
  comparisonHash: string
  /** 明确标记为 hypothetical / not applied */
  isHypothetical: true
  isApplied: false
}

/** 影响分析快照 */
export interface MultiProjectImpactSnapshot {
  id: number
  organizationId: number
  actorId: number
  /** 分析计划 hash */
  scopeHash: string
  /** 源数据新鲜度 hash */
  sourceFreshnessHash: string
  /** 依赖图签名 */
  dependencyGraphSignature: string
  /** 规则版本 */
  ruleVersion: string
  /** 权限指纹 */
  permissionFingerprint: string
  /** 输入 hash */
  inputHash: string
  /** 输出 hash */
  outputHash: string
  /** 状态 */
  status: MultiProjectImpactSnapshotStatus
  /** 生成时间 */
  generatedAt: string
  /** 过期时间（TTL） */
  expiresAt: string
  /** 源点摘要 */
  sourceSummary: {
    sourceType: MultiProjectImpactSourceType
    sourceCount?: number
    projectCount?: number
  }
  /** 传播摘要 */
  propagationSummary: {
    propagationPaths: MultiProjectImpactPropagationPath[]
    totalAffectedEndpoints: number
    severityDistribution: Record<MultiProjectImpactSeverity, number>
    blockedEndpoints: number
    maxDepth: number
    averageDelayDays: number
  }
  /** 警告 */
  warnings: MultiProjectImpactWarning[]
  /** 过期信息 */
  isStale: boolean
  staleReason?: MultiProjectImpactStaleReason | null
  /** 低敏证据引用 */
  evidenceReferences: string[]
  /** What-if 对比 */
  whatIfOutputs?: MultiProjectImpactWhatIfOutput[] | null
  /** 操作元数据 */
  createdAt: string
  createdBy: number
}

/** 后续动作草案 */
export interface MultiProjectImpactFollowUpDraft {
  /** 源快照 ID */
  sourceSnapshotId: number
  /** 源快照 hash */
  sourceSnapshotHash: string
  /** 受影响端点 hash（脱敏） */
  affectedEndpointHashes: string[]
  /** 目标能力 */
  targetCapability: MultiProjectImpactFollowUpTarget
  /** 草案载荷 */
  draftPayload: Record<string, unknown>
  /** 警告 */
  warnings: MultiProjectImpactWarning[]
  /** 脱敏状态 */
  redactionState: MultiProjectImpactRedactionReason[]
  /** 新鲜度签名 */
  freshnessSignature: string
  /** 过期时间 */
  expiresAt: string
  /** 必须人工确认 */
  confirmationRequired: true
  /** 目标能力不可用时的 fallback */
  featureUnavailable?: boolean
  /** 人工摘要（当目标能力不可用时） */
  manualSummary?: string | null
  /** 是否人工摘要 fallback */
  isManualFallback: boolean
}

/** AI 解释草案 */
export interface MultiProjectImpactAiExplanation {
  /** 快照引用 */
  snapshotId: number
  snapshotHash: string
  /** 提供者/模型 */
  provider: string | null
  model: string | null
  /** 解释文本 */
  explanation: string
  /** 置信度 */
  confidence: number
  /** 假设列表 */
  assumptions: string[]
  /** 补充问题 */
  followUpQuestions: string[]
  /** 严格 advisory-only */
  advisoryOnly: true
  confirmationRequired: true
  applied: false
  /** 生成时间 */
  generatedAt: string
  /** Token 成本 */
  tokenCost: number | null
}

/** 警告结构 */
export interface MultiProjectImpactWarning {
  code: MultiProjectImpactWarningCode
  message: string
  /** 可选关联端点 hash */
  endpointHash?: string | null
}

/** 脱敏端点（仅含 hash + reason marker） */
export interface MultiProjectImpactRedactedEndpoint {
  endpointHash: string
  redactionReason: MultiProjectImpactRedactionReason
}

// ---------------------------------------------------------------------------
// API 请求/响应类型
// ---------------------------------------------------------------------------

/** Plan 请求 */
export interface MultiProjectImpactPlanRequest {
  scope: MultiProjectImpactScope
}

/** Plan 响应 */
export interface MultiProjectImpactPlanResponse {
  data: MultiProjectImpactPlan
}

/** Run 请求 */
export interface MultiProjectImpactRunRequest {
  runToken: string
}

/** Run 响应 */
export interface MultiProjectImpactRunResponse {
  data: MultiProjectImpactSnapshot
}

/** What-if 请求 */
export interface MultiProjectImpactWhatIfRequest {
  /** 引用 snapshot */
  snapshotId: number
  scenarios: MultiProjectImpactWhatIfScenario[]
}

/** What-if 响应 */
export interface MultiProjectImpactWhatIfResponse {
  data: MultiProjectImpactWhatIfOutput[]
  meta: {
    snapshotId: number
    snapshotHash: string
    isStale: boolean
    staleReason?: MultiProjectImpactStaleReason | null
  }
}

/** Follow-up draft 请求 */
export interface MultiProjectImpactFollowUpRequest {
  snapshotId: number
  affectedEndpointHashes: string[]
  targetCapability: MultiProjectImpactFollowUpTarget
}

/** Follow-up draft 响应 */
export interface MultiProjectImpactFollowUpResponse {
  data: MultiProjectImpactFollowUpDraft
}

/** AI explanation 请求 */
export interface MultiProjectImpactAiExplanationRequest {
  snapshotId: number
  /** 可选聚焦区域 */
  focus?: string | null
}

/** AI explanation 响应 */
export interface MultiProjectImpactAiExplanationResponse {
  data: MultiProjectImpactAiExplanation
}

/** Export 请求 */
export interface MultiProjectImpactExportRequest {
  snapshotId: number
  format: 'json' | 'csv'
}

/** Export 响应 */
export interface MultiProjectImpactExportResponse {
  data: {
    snapshotId: number
    snapshotHash: string
    format: 'json' | 'csv'
    content: string
  }
}

/** Drill-down 请求 */
export interface MultiProjectImpactDrillDownRequest {
  snapshotId: number
  endpointHash: string
}

/** Drill-down 响应 */
export interface MultiProjectImpactDrillDownResponse {
  data: MultiProjectImpactAffectedEndpoint & {
    fullPath: MultiProjectImpactPropagationPath
    authorizationVerified: boolean
  }
}

/** 列表查询参数 */
export interface MultiProjectImpactListQuery {
  organizationId: number
  projectIds?: number[]
  sourceType?: MultiProjectImpactSourceType
  severity?: MultiProjectImpactSeverity
  isStale?: boolean
  status?: MultiProjectImpactSnapshotStatus
  dateWindowStart?: string
  dateWindowEnd?: string
  snapshotId?: number
  scenarioType?: MultiProjectImpactScenarioType
  sort?: string
  page?: number
  perPage?: number
}

/** 列表响应 */
export interface MultiProjectImpactListResponse {
  data: MultiProjectImpactSnapshot[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 详情响应 */
export interface MultiProjectImpactDetailResponse {
  data: MultiProjectImpactSnapshot
}

/** Refresh 请求 */
export interface MultiProjectImpactRefreshRequest {
  snapshotId: number
}

/** Refresh 响应 */
export interface MultiProjectImpactRefreshResponse {
  data: MultiProjectImpactSnapshot
}

/** Feature-unavailable 响应 */
export interface MultiProjectImpactFeatureUnavailableResponse {
  error: {
    code: 'FEATURE_DISABLED'
    message: string
    details?: {
      featureName: string
      existingSnapshots: number
    }
  }
}

/** 审计摘要 */
export interface MultiProjectImpactAuditSummary {
  actorId: number | null
  organizationId: number
  operation: string
  scopeHash?: string
  sourceFreshnessHash?: string
  ruleVersion?: string
  snapshotId?: number
  snapshotHash?: string
  visibleEndpointHashes?: string[]
  warningCodes?: MultiProjectImpactWarningCode[]
  severityDistribution?: Record<MultiProjectImpactSeverity, number>
  staleReason?: MultiProjectImpactStaleReason | null
  followUpTarget?: MultiProjectImpactFollowUpTarget | null
  aiProvider?: string | null
  aiModel?: string | null
  timestamp: string
}

/** 统一错误码 */
export const MULTI_PROJECT_IMPACT_ERROR_CODES = [
  'VALIDATION_ERROR',
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
  'STALE_PLAN',
  'STALE_SNAPSHOT',
  'FEATURE_DISABLED',
  'UNSUPPORTED_SCENARIO',
  'REDACTION_BLOCK',
  'TARGET_UNAVAILABLE',
  'AI_UNAVAILABLE',
  'ANALYSIS_FAILED',
] as const
export type MultiProjectImpactErrorCode = (typeof MULTI_PROJECT_IMPACT_ERROR_CODES)[number]

/** 统一错误信封 */
export interface MultiProjectImpactErrorResponse {
  error: {
    code: MultiProjectImpactErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

// ---------------------------------------------------------------------------
// 默认常量
// ---------------------------------------------------------------------------

export const MULTI_PROJECT_IMPACT_DEFAULTS = {
  RULE_VERSION: 'v3-impact-1.0.0',
  MAX_PROPAGATION_DEPTH: 10,
  MAX_NODES: 2000,
  MAX_EDGES: 5000,
  MAX_SCENARIOS: 20,
  MAX_PROJECTS_PER_SCOPE: 100,
  SNAPSHOT_TTL_DAYS: 90,
  PLAN_TTL_MS: 5 * 60 * 1000, // 5 minutes
  DEFAULT_PAGE: 1,
  DEFAULT_PER_PAGE: 20,
  MAX_PER_PAGE: 100,
} as const

// ---------------------------------------------------------------------------
// §2.3 纯函数：scope normalization、stable hash、severity、redaction、enum drift guard
// ---------------------------------------------------------------------------

/**
 * 规范化 scope —— 排序、去重、裁剪上限
 */
export function normalizeMultiProjectImpactScope(
  scope: MultiProjectImpactScope,
): MultiProjectImpactScope {
  const sortedProjectIds = [...new Set(scope.projectIds)]
    .sort((a, b) => a - b)
    .slice(0, MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PROJECTS_PER_SCOPE)

  const sortedSources = scope.sources
    ? [...scope.sources]
        .sort((a, b) => a.sourceId - b.sourceId || a.sourceType.localeCompare(b.sourceType))
        .slice(0, MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PROJECTS_PER_SCOPE)
    : undefined

  return {
    projectIds: sortedProjectIds,
    sources: sortedSources,
    maxPropagationDepth: Math.min(
      Math.max(1, scope.maxPropagationDepth),
      MULTI_PROJECT_IMPACT_DEFAULTS.MAX_PROPAGATION_DEPTH,
    ),
    maxNodes: Math.min(Math.max(1, scope.maxNodes), MULTI_PROJECT_IMPACT_DEFAULTS.MAX_NODES),
    maxEdges: Math.min(Math.max(1, scope.maxEdges), MULTI_PROJECT_IMPACT_DEFAULTS.MAX_EDGES),
    dateWindowStart: scope.dateWindowStart ?? null,
    dateWindowEnd: scope.dateWindowEnd ?? null,
    maxScenarios: Math.min(
      Math.max(0, scope.maxScenarios),
      MULTI_PROJECT_IMPACT_DEFAULTS.MAX_SCENARIOS,
    ),
  }
}

/**
 * FNV-1a 稳定 hash（确定性、无运行时依赖、跨平台一致）
 */
export function fnv1aHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash = hash >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 生成 scope 的稳定 hash（字段规范化后 FNV-1a）
 */
export function computeScopeHash(scope: MultiProjectImpactScope): string {
  const normalized = normalizeMultiProjectImpactScope(scope)
  const canonical = JSON.stringify({
    p: normalized.projectIds,
    s: normalized.sources?.map((s) => [s.sourceType, s.sourceId, s.projectId]),
    d: normalized.maxPropagationDepth,
    n: normalized.maxNodes,
    e: normalized.maxEdges,
    dws: normalized.dateWindowStart,
    dwe: normalized.dateWindowEnd,
    sc: normalized.maxScenarios,
  })
  return fnv1aHash(canonical)
}

/**
 * 生成 source freshness hash
 */
export function computeSourceFreshnessHash(inputs: {
  dependencyFactHashes: string[]
  detectionResultHashes: string[]
  riskSummaryHashes: string[]
  resourceSummaryHashes: string[]
  okrSummaryHashes: string[]
  biSummaryHashes: string[]
  manualExternalRefHashes: string[]
}): string {
  const canonical = JSON.stringify({
    df: [...inputs.dependencyFactHashes].sort(),
    dr: [...inputs.detectionResultHashes].sort(),
    rs: [...inputs.riskSummaryHashes].sort(),
    rcs: [...inputs.resourceSummaryHashes].sort(),
    os: [...inputs.okrSummaryHashes].sort(),
    bs: [...inputs.biSummaryHashes].sort(),
    me: [...inputs.manualExternalRefHashes].sort(),
  })
  return fnv1aHash(canonical)
}

/**
 * 生成权限指纹
 */
export function computePermissionFingerprint(input: {
  actorId: number
  organizationId: number
  permissions: string[]
  visibleProjectIds: number[]
}): string {
  const canonical = JSON.stringify({
    a: input.actorId,
    o: input.organizationId,
    p: [...input.permissions].sort(),
    v: [...input.visibleProjectIds].sort(),
  })
  return fnv1aHash(canonical)
}

/**
 * 生成 snapshot 输入 hash
 */
export function computeSnapshotInputHash(inputs: {
  scopeHash: string
  sourceFreshnessHash: string
  dependencyGraphSignature: string
  ruleVersion: string
  permissionFingerprint: string
}): string {
  const canonical = JSON.stringify({
    sh: inputs.scopeHash,
    sf: inputs.sourceFreshnessHash,
    dg: inputs.dependencyGraphSignature,
    rv: inputs.ruleVersion,
    pf: inputs.permissionFingerprint,
  })
  return fnv1aHash(canonical)
}

/**
 * 生成 snapshot 输出 hash
 */
export function computeSnapshotOutputHash(
  propagationPaths: MultiProjectImpactPropagationPath[],
  severityDistribution: Record<MultiProjectImpactSeverity, number>,
): string {
  const canonical = JSON.stringify({
    pp: propagationPaths.map((p) => ({
      s: [p.sourceRef.sourceType, p.sourceRef.sourceId],
      e: p.entries.map((e) => [e.fromType, e.fromId, e.toType, e.toId, e.delayDays, e.bufferDays]),
      td: p.totalDelayDays,
      d: p.depth,
      ae: p.affectedEndpoints.map((ep) => [ep.endpointType, ep.endpointId, ep.severity]),
    })),
    sd: MULTI_PROJECT_IMPACT_SEVERITIES.map((s) => [s, severityDistribution[s] ?? 0]),
  })
  return fnv1aHash(canonical)
}

/**
 * 严重度排序评分
 */
export function multiProjectImpactSeverityScore(severity: MultiProjectImpactSeverity): number {
  if (severity === 'none') return 0
  const idx = MULTI_PROJECT_IMPACT_SEVERITY_ORDER.indexOf(severity)
  return idx >= 0 ? MULTI_PROJECT_IMPACT_SEVERITY_ORDER.length - idx : 0
}

/**
 * 取两严重度中较高者
 */
export function maxMultiProjectImpactSeverity(
  a: MultiProjectImpactSeverity,
  b: MultiProjectImpactSeverity,
): MultiProjectImpactSeverity {
  return multiProjectImpactSeverityScore(a) >= multiProjectImpactSeverityScore(b) ? a : b
}

/**
 * 判断是否为阻塞性严重度
 */
export function isBlockingMultiProjectImpactSeverity(
  severity: MultiProjectImpactSeverity,
): boolean {
  return severity === 'blocker' || severity === 'critical'
}

/**
 * 严重度从 delayDays 推导
 */
export function classifySeverityFromDelay(
  delayDays: number,
  isCriticalPath: boolean,
  hasBuffer: boolean,
): MultiProjectImpactSeverity {
  if (delayDays <= 0) return 'none'
  if (isCriticalPath && delayDays > 10) return 'blocker'
  if (isCriticalPath && delayDays > 3) return 'critical'
  if (!hasBuffer && delayDays > 10) return 'critical'
  if (delayDays > 10) return 'high'
  if (delayDays > 3) return 'medium'
  return 'low'
}

/**
 * 计算 buffer 吸收摘要
 */
export function computeBufferAbsorptionSummary(
  incomingDelayDays: number,
  bufferDays: number,
): {
  absorbedDays: number
  propagatedDelayDays: number
  remainingBufferDays: number
  isFullyAbsorbed: boolean
  absorptionPercent: number
} {
  const absorbedDays = Math.min(incomingDelayDays, Math.max(0, bufferDays))
  const propagatedDelayDays = Math.max(0, incomingDelayDays - absorbedDays)
  const remainingBufferDays = Math.max(0, bufferDays - absorbedDays)
  const isFullyAbsorbed = propagatedDelayDays <= 0
  const absorptionPercent = incomingDelayDays > 0 ? (absorbedDays / incomingDelayDays) * 100 : 100

  return {
    absorbedDays,
    propagatedDelayDays,
    remainingBufferDays,
    isFullyAbsorbed,
    absorptionPercent,
  }
}

/**
 * 生成低敏证据 hash
 */
export function computeLowSensitiveEvidenceHash(evidence: string): string {
  // 剥离可能含敏感信息的字段后，只哈希低敏部分
  return fnv1aHash(evidence.trim().slice(0, 200))
}

/**
 * 判定 snapshop 是否过期
 */
export function detectMultiProjectImpactSnapshotStale(snapshot: {
  generatedAt: string
  expiresAt: string
  ruleVersion: string
  currentRuleVersion: string
  sourceFreshnessChanged: boolean
  permissionFingerprintChanged: boolean
  dependencyGraphChanged: boolean
}): { isStale: boolean; reason: MultiProjectImpactStaleReason | null } {
  const now = new Date()
  const expiresAt = new Date(snapshot.expiresAt)

  if (now >= expiresAt) {
    return { isStale: true, reason: 'snapshot_ttl_expired' }
  }

  if (snapshot.ruleVersion !== snapshot.currentRuleVersion) {
    return { isStale: true, reason: 'rule_version_changed' }
  }

  if (snapshot.sourceFreshnessChanged) {
    return { isStale: true, reason: 'source_data_changed' }
  }

  if (snapshot.dependencyGraphChanged) {
    return { isStale: true, reason: 'dependency_graph_changed' }
  }

  if (snapshot.permissionFingerprintChanged) {
    return { isStale: true, reason: 'permission_fingerprint_changed' }
  }

  return { isStale: false, reason: null }
}

// ---------------------------------------------------------------------------
// §2.4 纯函数：baseline vs what-if comparison、propagation path summary
// ---------------------------------------------------------------------------

/**
 * 对比基线快照与 what-if 输出
 */
export function compareMultiProjectImpactBaselineVsWhatIf(
  _baseline: Pick<MultiProjectImpactSnapshot, 'propagationSummary'>,
  whatIfOutput: Pick<
    MultiProjectImpactWhatIfOutput,
    'baseline' | 'scenarioOutput' | 'changedEndpoints'
  >,
): {
  severityDelta: Record<MultiProjectImpactSeverity, number>
  totalAffectedDelta: number
  blockedEndpointsDelta: number
  maxSeverityChanged: boolean
  summary: string
} {
  const severityDelta: Record<string, number> = {}
  for (const sev of MULTI_PROJECT_IMPACT_SEVERITIES) {
    const baselineCount = whatIfOutput.baseline.severityDistribution[sev] ?? 0
    const scenarioCount = whatIfOutput.scenarioOutput.severityDistribution[sev] ?? 0
    severityDelta[sev] = scenarioCount - baselineCount
  }

  return {
    severityDelta: severityDelta as Record<MultiProjectImpactSeverity, number>,
    totalAffectedDelta:
      whatIfOutput.scenarioOutput.totalAffected - whatIfOutput.baseline.totalAffected,
    blockedEndpointsDelta:
      whatIfOutput.scenarioOutput.blockedEndpoints - whatIfOutput.baseline.blockedEndpoints,
    maxSeverityChanged:
      JSON.stringify(whatIfOutput.baseline.severityDistribution) !==
      JSON.stringify(whatIfOutput.scenarioOutput.severityDistribution),
    summary: `Baseline: ${whatIfOutput.baseline.totalAffected} affected · Scenario: ${whatIfOutput.scenarioOutput.totalAffected} affected`,
  }
}

/**
 * 传播路径摘要（只返回低敏信息）
 */
export function summarizePropagationPath(path: MultiProjectImpactPropagationPath): {
  totalDepth: number
  totalDelayDays: number
  affectedEndpointCount: number
  visibleEndpointCount: number
  redactedEndpointCount: number
  highestSeverity: MultiProjectImpactSeverity
  hasBlockedEndpoints: boolean
} {
  let highestSeverity: MultiProjectImpactSeverity = 'none'
  let visibleCount = 0
  let redactedCount = 0

  for (const ep of path.affectedEndpoints) {
    highestSeverity = maxMultiProjectImpactSeverity(highestSeverity, ep.severity)
    if (ep.visibility === 'visible') visibleCount++
    else redactedCount++
  }

  return {
    totalDepth: path.depth,
    totalDelayDays: path.totalDelayDays,
    affectedEndpointCount: path.affectedEndpoints.length,
    visibleEndpointCount: visibleCount,
    redactedEndpointCount: redactedCount,
    highestSeverity,
    hasBlockedEndpoints: isBlockingMultiProjectImpactSeverity(highestSeverity),
  }
}

// ---------------------------------------------------------------------------
// §2.5 纯函数：follow-up draft contract helpers
// ---------------------------------------------------------------------------

/**
 * 构建 CRUD preview 草案输入
 */
export function buildMultiProjectDependencyCrudDraftInput(params: {
  affectedEndpointHash: string
  endpointType: string
  endpointId: number
  suggestedAction: 'create' | 'update' | 'archive' | 'restore'
  suggestedFields: Record<string, unknown>
}): Record<string, unknown> {
  return {
    action: 'preview_dependency_input',
    target: 'multi_project_dependency_crud',
    suggestedAction: params.suggestedAction,
    endpointType: params.endpointType,
    endpointId: params.endpointId,
    suggestedFields: params.suggestedFields,
    sourceDraftHash: fnv1aHash(JSON.stringify(params.suggestedFields)),
    _meta: {
      generatedBy: 'multi_project_impact_analysis',
      affectedEndpointHash: params.affectedEndpointHash,
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * 构建 Detection rerun scope 草案
 */
export function buildDetectionRerunScopeDraft(params: {
  projectIds: number[]
  affectedEndpointHashes: string[]
  reason: string
}): Record<string, unknown> {
  return {
    action: 'rerun_detection_scope',
    target: 'dependency_detection_rerun',
    projectIds: params.projectIds,
    affectedEndpointHashes: params.affectedEndpointHashes,
    reason: params.reason,
    _meta: {
      generatedBy: 'multi_project_impact_analysis',
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * 构建人工风险草案
 */
export function buildManualRiskDraft(params: {
  projectId: number
  riskTitle: string
  riskDescription: string
  severity: MultiProjectImpactSeverity
  affectedEndpointHashes: string[]
}): Record<string, unknown> {
  return {
    action: 'create_risk_draft',
    target: 'manual_risk_draft',
    projectId: params.projectId,
    title: params.riskTitle,
    description: params.riskDescription,
    severity: params.severity,
    sourceEndpointHashes: params.affectedEndpointHashes,
    _meta: {
      generatedBy: 'multi_project_impact_analysis',
      generatedAt: new Date().toISOString(),
    },
  }
}

/**
 * 构建人工摘要草案（fallback）
 */
export function buildManualSummaryDraft(params: {
  snapshotId: number
  affectedEndpointHashes: string[]
  reason: string
}): MultiProjectImpactFollowUpDraft {
  return {
    sourceSnapshotId: params.snapshotId,
    sourceSnapshotHash: '',
    affectedEndpointHashes: params.affectedEndpointHashes,
    targetCapability: 'manual_summary',
    draftPayload: {
      reason: params.reason,
      suggestedActions: [
        '请在 PMO 工作台人工审视受影响端点',
        '如需创建风险：进入风险工作台填写人工风险登记',
        '如需创建跨项目依赖：等跨项目依赖 CRUD 能力可用后操作',
      ],
    },
    warnings: [
      {
        code: 'source_data_unavailable' as MultiProjectImpactWarningCode,
        message: '部分目标能力尚未启用，已生成人工摘要作为替代',
      },
    ],
    redactionState: [],
    freshnessSignature: '',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    confirmationRequired: true,
    isManualFallback: true,
    manualSummary: params.reason,
  }
}

/**
 * 检查 follow-up draft 目标能力可用性
 */
export function isFollowUpTargetAvailable(
  target: MultiProjectImpactFollowUpTarget,
  availableTargets: MultiProjectImpactFollowUpTarget[],
): boolean {
  return availableTargets.includes(target)
}

// ---------------------------------------------------------------------------
// §2.3 §2.4 补充：enum drift guard
// ---------------------------------------------------------------------------

/**
 * 验证枚举值是否在允许范围内（不变式守卫）
 */
export function guardMultiProjectImpactEnum<T extends readonly string[]>(
  allowed: T,
  value: string,
  label: string,
): asserts value is T[number] {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `Enum drift: "${value}" is not a valid ${label}. Allowed: ${allowed.join(', ')}`,
    )
  }
}

/**
 * 安全地检查值是否为合法的 warning code
 */
export function isValidMultiProjectImpactWarningCode(
  value: string,
): value is MultiProjectImpactWarningCode {
  return (MULTI_PROJECT_IMPACT_WARNING_CODES as readonly string[]).includes(value)
}

/**
 * 安全地检查值是否为合法的 severity
 */
export function isValidMultiProjectImpactSeverity(
  value: string,
): value is MultiProjectImpactSeverity {
  return (MULTI_PROJECT_IMPACT_SEVERITIES as readonly string[]).includes(value)
}

/**
 * 安全地检查值是否为合法的 stale reason
 */
export function isValidMultiProjectImpactStaleReason(
  value: string,
): value is MultiProjectImpactStaleReason {
  return (MULTI_PROJECT_IMPACT_STALE_REASONS as readonly string[]).includes(value)
}

/**
 * 安全地检查值是否为合法的 scenario type
 */
export function isValidMultiProjectImpactScenarioType(
  value: string,
): value is MultiProjectImpactScenarioType {
  return (MULTI_PROJECT_IMPACT_SCENARIO_TYPES as readonly string[]).includes(value)
}

/**
 * 安全地检查值是否为合法的 follow-up target
 */
export function isValidMultiProjectImpactFollowUpTarget(
  value: string,
): value is MultiProjectImpactFollowUpTarget {
  return (MULTI_PROJECT_IMPACT_FOLLOW_UP_TARGETS as readonly string[]).includes(value)
}

/**
 * 创建 warning 对象
 */
export function makeMultiProjectImpactWarning(
  code: MultiProjectImpactWarningCode,
  message: string,
  endpointHash?: string | null,
): MultiProjectImpactWarning {
  return { code, message, endpointHash: endpointHash ?? null }
}

/**
 * 空严重度分布
 */
export function emptyMultiProjectImpactSeverityDistribution(): Record<
  MultiProjectImpactSeverity,
  number
> {
  return { blocker: 0, critical: 0, high: 0, medium: 0, low: 0, none: 0 }
}

/**
 * 合并严重度分布
 */
export function mergeMultiProjectImpactSeverityDistribution(
  a: Record<MultiProjectImpactSeverity, number>,
  b: Record<MultiProjectImpactSeverity, number>,
): Record<MultiProjectImpactSeverity, number> {
  const result = emptyMultiProjectImpactSeverityDistribution()
  for (const sev of MULTI_PROJECT_IMPACT_SEVERITIES) {
    result[sev] = (a[sev] ?? 0) + (b[sev] ?? 0)
  }
  return result
}
