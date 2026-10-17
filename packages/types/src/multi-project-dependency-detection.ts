// @aiproj/types —— 多项目依赖检测共享契约（前后端共享）。
// v3-multi-project-dependency-detection §2：DTO、枚举、常量、规则集、warning、
// redaction、freshness、result lifecycle、draft bridge、fixture 与纯函数助手。
//
// 红线：
//   - 共享包零运行时依赖，不含 AdonisJS/React/数据库/AI/缓存/网络导入。
//   - 检测结果 advisory-only，不创建/更新/删除正式依赖事实。
//   - AI 只建议不自动执行：advisoryOnly=true + confirmationRequired=true + applied=false。
//   - 权限脱敏只返回低敏 warning code，不暴露隐藏名称/证据文本。
//   - 确定性规则输出对同一 source snapshot 必须可重复。

// ─── Detection Scope ──────────────────────────────────────────────────────────────

export interface DetectionScope {
  organizationId: number | string
  projectIds?: (number | string)[]
  /** ISO 8601 date range for dependency relevance window */
  dateWindowStart?: string
  dateWindowEnd?: string
  /** Maximum number of projects to scan (prevent unbounded scans) */
  maxProjects?: number
  /** Maximum number of dependency edges to consider */
  maxEdges?: number
  /** Maximum number of tasks per project for local context */
  maxTasksPerProject?: number
  /** Rule set key to apply; defaults to 'default' */
  ruleSetKey?: string
  /** Arbitrary user-supplied metadata (never included in hash) */
  metadata?: Record<string, unknown>
}

export interface NormalizedDetectionScope {
  organizationId: number
  projectIds: number[]
  dateWindowStart: string | null
  dateWindowEnd: string | null
  maxProjects: number
  maxEdges: number
  maxTasksPerProject: number
  ruleSetKey: string
}

// ─── Rule Set ────────────────────────────────────────────────────────────────────

export const DETECTION_RULE_IDS = {
  MISSING_DEPENDENCY: 'missing_dependency',
  DUPLICATE_EQUIVALENT: 'duplicate_equivalent',
  SELF_DEPENDENCY: 'self_dependency',
  CYCLE_RISK: 'cycle_risk',
  BUFFER_SHORTFALL: 'buffer_shortfall',
  SCHEDULE_CONFLICT: 'schedule_conflict',
  STATUS_CONFLICT: 'status_conflict',
  BLOCKED_CHAIN: 'blocked_chain',
  STALE_EVIDENCE: 'stale_evidence',
  ORPHANED_EXTERNAL_REF: 'orphaned_external_ref',
  DATA_QUALITY_WARNING: 'data_quality_warning',
} as const

export type DetectionRuleId = (typeof DETECTION_RULE_IDS)[keyof typeof DETECTION_RULE_IDS]

export const DETECTION_RULE_ID_VALUES = Object.values(
  DETECTION_RULE_IDS,
) as readonly DetectionRuleId[]

export interface DetectionRuleDef {
  id: DetectionRuleId
  enabled: boolean
  /** Whether this rule can be disabled by organization config */
  configurable: boolean
  /** Whether this rule can never be disabled (safety-critical) */
  safetyCritical: boolean
  /** Human-readable label */
  label: string
}

export interface DetectionRuleSet {
  key: string
  label: string
  rules: DetectionRuleDef[]
  /** Maximum scope limits for this rule set */
  scopeLimits: {
    maxProjects: number
    maxEdges: number
    maxTasksPerProject: number
  }
}

// ─── Severity ────────────────────────────────────────────────────────────────────

export const DETECTION_SEVERITIES = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
} as const

export type DetectionSeverity = (typeof DETECTION_SEVERITIES)[keyof typeof DETECTION_SEVERITIES]

export const DETECTION_SEVERITY_VALUES = Object.values(
  DETECTION_SEVERITIES,
) as readonly DetectionSeverity[]

export const DETECTION_SEVERITY_ORDER: Record<DetectionSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

// ─── Confidence ──────────────────────────────────────────────────────────────────

export const DETECTION_CONFIDENCE_BANDS = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  UNCERTAIN: 'uncertain',
} as const

export type DetectionConfidenceBand =
  (typeof DETECTION_CONFIDENCE_BANDS)[keyof typeof DETECTION_CONFIDENCE_BANDS]

export const DETECTION_CONFIDENCE_BAND_VALUES = Object.values(
  DETECTION_CONFIDENCE_BANDS,
) as readonly DetectionConfidenceBand[]

export const DETECTION_CONFIDENCE_ORDER: Record<DetectionConfidenceBand, number> = {
  high: 3,
  medium: 2,
  low: 1,
  uncertain: 0,
}

// ─── Result Lifecycle ────────────────────────────────────────────────────────────

export const DETECTION_RESULT_STATUSES = {
  OPEN: 'open',
  IGNORED: 'ignored',
  REOPENED: 'reopened',
  CONVERTED_TO_DRAFT: 'convertedToDraft',
  SUPERSEDED: 'superseded',
  EXPIRED: 'expired',
} as const

export type DetectionResultStatus =
  (typeof DETECTION_RESULT_STATUSES)[keyof typeof DETECTION_RESULT_STATUSES]

export const DETECTION_RESULT_STATUS_VALUES = Object.values(
  DETECTION_RESULT_STATUSES,
) as readonly DetectionResultStatus[]

/** Valid transitions: open->ignored|convertedToDraft|superseded|expired; ignored->reopened|expired; reopened->ignored|convertedToDraft|superseded|expired */
export const DETECTION_RESULT_TRANSITIONS: Record<
  DetectionResultStatus,
  readonly DetectionResultStatus[]
> = {
  open: ['ignored', 'convertedToDraft', 'superseded', 'expired'],
  ignored: ['reopened', 'expired'],
  reopened: ['ignored', 'convertedToDraft', 'superseded', 'expired'],
  convertedToDraft: ['expired'],
  superseded: ['expired'],
  expired: [],
}

// ─── Run Status ──────────────────────────────────────────────────────────────────

export const DETECTION_RUN_STATUSES = {
  PLANNED: 'planned',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  STALE: 'stale',
} as const

export type DetectionRunStatus =
  (typeof DETECTION_RUN_STATUSES)[keyof typeof DETECTION_RUN_STATUSES]

export const DETECTION_RUN_STATUS_VALUES = Object.values(
  DETECTION_RUN_STATUSES,
) as readonly DetectionRunStatus[]

// ─── Warning Codes ───────────────────────────────────────────────────────────────

export const DETECTION_WARNING_CODES = {
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  REDACTED_GRAPH_INTEGRITY: 'REDACTED_GRAPH_INTEGRITY',
  REDACTED_ENDPOINT: 'REDACTED_ENDPOINT',
  REDACTED_DIMENSION: 'REDACTED_DIMENSION',
  REDACTED_EVIDENCE: 'REDACTED_EVIDENCE',
  STALE_SOURCE: 'STALE_SOURCE',
  PARTIAL_SCOPE: 'PARTIAL_SCOPE',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  PERMISSION_LIMITED: 'PERMISSION_LIMITED',
  DRAFT_BRIDGE_DISABLED: 'DRAFT_BRIDGE_DISABLED',
} as const

export type DetectionWarningCode =
  (typeof DETECTION_WARNING_CODES)[keyof typeof DETECTION_WARNING_CODES]

export const DETECTION_WARNING_CODE_VALUES = Object.values(
  DETECTION_WARNING_CODES,
) as readonly DetectionWarningCode[]

// ─── Redaction State ─────────────────────────────────────────────────────────────

export const DETECTION_REDACTION_STATES = {
  NONE: 'none',
  PARTIAL: 'partial',
  FULL: 'full',
} as const

export type DetectionRedactionState =
  (typeof DETECTION_REDACTION_STATES)[keyof typeof DETECTION_REDACTION_STATES]

export const DETECTION_REDACTION_STATE_VALUES = Object.values(
  DETECTION_REDACTION_STATES,
) as readonly DetectionRedactionState[]

// ─── Source Snapshot ─────────────────────────────────────────────────────────────

export interface DetectionSourceSnapshot {
  scopeHash: string
  ruleSetKey: string
  organizationId: number
  /** Freshness hashes for each source domain */
  freshness: {
    dependencyFactsHash: string
    projectSummaryHash: string
    milestoneSummaryHash: string
    taskSummaryHash: string
    localTaskDepsHash: string
    resourceContentionHash: string | null
    riskHeatmapHash: string | null
    okrAlignmentHash: string | null
    biAggregationHash: string | null
  }
  /** Permission fingerprint — hashed, not raw permissions */
  permissionFingerprint: string
  createdAt: string // ISO 8601
}

// ─── Detection Plan ──────────────────────────────────────────────────────────────

export interface DetectionPlan {
  planToken: string
  scopeHash: string
  normalizedScope: NormalizedDetectionScope
  ruleSetKey: string
  ruleSetLabel: string
  enabledRules: DetectionRuleId[]
  estimatedCost: {
    projectCount: number
    dependencyEdgeCount: number
    taskDependencyContextCount: number
    estimatedRules: number
  }
  sourceFreshness: DetectionSourceSnapshot['freshness']
  permissionSummary: {
    canReadAllProjects: boolean
    partialRedactionExpected: boolean
  }
  warnings: DetectionWarningCode[]
  expiresAt: string // ISO 8601
  createdAt: string // ISO 8601
}

// ─── Detection Run ───────────────────────────────────────────────────────────────

export interface DetectionRun {
  id: number
  organizationId: number
  actorId: number
  planToken: string
  scopeHash: string
  ruleSetKey: string
  sourceFreshnessHash: string
  status: DetectionRunStatus
  resultCount: number
  /** Aggregated counts by severity */
  resultSummary: Record<DetectionSeverity, number>
  warnings: DetectionWarningCode[]
  startedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Detection Result ────────────────────────────────────────────────────────────

export interface DetectionResult {
  id: number
  runId: number
  organizationId: number
  ruleId: DetectionRuleId
  severity: DetectionSeverity
  confidence: DetectionConfidenceBand
  status: DetectionResultStatus
  /** Stable fingerprint for dedup across runs */
  fingerprint: string
  /** Low-sensitive rationale text */
  rationale: string
  /** Low-sensitive evidence summary (never contains hidden labels/full evidence) */
  evidenceSummary: string | null
  /** Hash of the full evidence for audit trail */
  evidenceHash: string | null
  /** Hashes of affected endpoint references (not names) */
  affectedEndpointHashes: string[]
  sourceFreshness: {
    dependencyFactsHash: string
    snapshotCreatedAt: string
  }
  warnings: DetectionWarningCode[]
  redactionState: DetectionRedactionState
  /** Whether this result is eligible for draft bridge */
  draftEligible: boolean
  /** If ignored, the bounded reason hash */
  ignoreReasonHash: string | null
  /** AI advisory metadata if AI was involved */
  aiAdvisory: DetectionAiAdvisory | null
  createdAt: string
  updatedAt: string
}

export interface DetectionAiAdvisory {
  /** Always true — AI is never the source of truth */
  advisoryOnly: true
  /** Always true — requires human confirmation */
  confirmationRequired: true
  /** Always false — AI cannot apply changes */
  applied: false
  provider: string | null
  model: string | null
  callSummaryHash: string | null
}

// ─── Draft Bridge ────────────────────────────────────────────────────────────────

// ─── API Envelopes ───────────────────────────────────────────────────────────────

export interface DetectionPlanResponse {
  data: DetectionPlan
}

export interface DetectionRunResponse {
  data: DetectionRun
}

export interface DetectionRunListResponse {
  data: DetectionRun[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface DetectionResultResponse {
  data: DetectionResult
}

export interface DetectionResultListResponse {
  data: DetectionResult[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface DetectionFeatureUnavailableResponse {
  error: {
    code: 'FEATURE_DISABLED'
    message: string
  }
}

// ─── Request DTOs ────────────────────────────────────────────────────────────────

export interface DetectionPlanRequest {
  organizationId: number | string
  scope: DetectionScope
}

export interface DetectionRunRequest {
  organizationId: number | string
  planToken: string
}

export interface DetectionListRunsQuery {
  page?: number
  perPage?: number
  status?: DetectionRunStatus
  sort?: string // e.g. '-createdAt'
}

export interface DetectionListResultsQuery {
  page?: number
  perPage?: number
  runId?: number | string
  severity?: DetectionSeverity | DetectionSeverity[]
  confidence?: DetectionConfidenceBand | DetectionConfidenceBand[]
  status?: DetectionResultStatus | DetectionResultStatus[]
  ruleId?: DetectionRuleId | DetectionRuleId[]
  dateFrom?: string
  dateTo?: string
  sort?: string
}

export interface DetectionIgnoreRequest {
  reasonHash?: string
}

export interface DetectionReopenRequest {
  reasonHash?: string
}

export interface DetectionDraftBridgeRequest {
  resultId: number | string
}

// ─── Pure Functions ──────────────────────────────────────────────────────────────

/** Normalize a detection scope to a deterministic shape */
export function normalizeDetectionScope(scope: DetectionScope): NormalizedDetectionScope {
  const projectIds = scope.projectIds
    ? [...new Set(scope.projectIds.map((id) => Number(id)))].sort((a, b) => a - b)
    : []

  return {
    organizationId: Number(scope.organizationId),
    projectIds,
    dateWindowStart: scope.dateWindowStart ?? null,
    dateWindowEnd: scope.dateWindowEnd ?? null,
    maxProjects: scope.maxProjects ?? 100,
    maxEdges: scope.maxEdges ?? 5000,
    maxTasksPerProject: scope.maxTasksPerProject ?? 500,
    ruleSetKey: scope.ruleSetKey ?? 'default',
  }
}

/** Generate a stable hash from a normalized detection scope */
export function hashDetectionScope(scope: NormalizedDetectionScope): string {
  const payload = JSON.stringify({
    o: scope.organizationId,
    p: scope.projectIds,
    dws: scope.dateWindowStart,
    dwe: scope.dateWindowEnd,
    mp: scope.maxProjects,
    me: scope.maxEdges,
    mt: scope.maxTasksPerProject,
    rs: scope.ruleSetKey,
  })
  return simpleStableHash(payload)
}

/** Simple stable hash (FNV-1a inspired, no crypto dependency) */
function simpleStableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Generate a stable fingerprint for a detection result */
export function fingerprintDetectionResult(
  ruleId: DetectionRuleId,
  scopeHash: string,
  affectedEndpointHashes: string[],
): string {
  const payload = JSON.stringify({
    r: ruleId,
    s: scopeHash,
    e: [...affectedEndpointHashes].sort(),
  })
  return simpleStableHash(payload)
}

/** Classify severity from rule output signals */
export function classifyDetectionSeverity(input: {
  ruleId: DetectionRuleId
  propagationDays?: number
  confidenceScore?: number
  isBlocking?: boolean
}): DetectionSeverity {
  if (input.ruleId === 'cycle_risk' || input.ruleId === 'blocked_chain') {
    return input.isBlocking ? 'critical' : 'high'
  }
  if (input.ruleId === 'buffer_shortfall') {
    if (input.propagationDays !== undefined && input.propagationDays > 30) return 'critical'
    if (input.propagationDays !== undefined && input.propagationDays > 14) return 'high'
    if (input.propagationDays !== undefined && input.propagationDays > 7) return 'medium'
    return 'low'
  }
  if (input.ruleId === 'schedule_conflict' || input.ruleId === 'status_conflict') {
    return input.isBlocking ? 'high' : 'medium'
  }
  if (input.ruleId === 'stale_evidence' || input.ruleId === 'data_quality_warning') {
    return 'low'
  }
  return 'medium'
}

/** Classify confidence from rule output signals */
export function classifyDetectionConfidence(input: {
  evidenceCount: number
  matchQuality?: number
  dataQualityScore?: number
}): DetectionConfidenceBand {
  const quality = input.matchQuality ?? 0.5
  if (input.evidenceCount >= 3 && quality >= 0.8) return 'high'
  if (input.evidenceCount >= 2 && quality >= 0.5) return 'medium'
  if (input.evidenceCount >= 1) return 'low'
  return 'uncertain'
}

/** Validate a lifecycle transition */
export function isValidDetectionResultTransition(
  from: DetectionResultStatus,
  to: DetectionResultStatus,
): boolean {
  const allowed = DETECTION_RESULT_TRANSITIONS[from]
  return allowed !== undefined && allowed.includes(to)
}

/** Check if a rule ID is valid */
export function isDetectionRuleId(value: string): value is DetectionRuleId {
  return DETECTION_RULE_ID_VALUES.includes(value as DetectionRuleId)
}

/** Check if a severity is valid */
export function isDetectionSeverity(value: string): value is DetectionSeverity {
  return DETECTION_SEVERITY_VALUES.includes(value as DetectionSeverity)
}

/** Check if a confidence band is valid */
export function isDetectionConfidenceBand(value: string): value is DetectionConfidenceBand {
  return DETECTION_CONFIDENCE_BAND_VALUES.includes(value as DetectionConfidenceBand)
}

/** Check if a result status is valid */
export function isDetectionResultStatus(value: string): value is DetectionResultStatus {
  return DETECTION_RESULT_STATUS_VALUES.includes(value as DetectionResultStatus)
}

/** Check if a run status is valid */
export function isDetectionRunStatus(value: string): value is DetectionRunStatus {
  return DETECTION_RUN_STATUS_VALUES.includes(value as DetectionRunStatus)
}

/** Check if a warning code is valid */
export function isDetectionWarningCode(value: string): value is DetectionWarningCode {
  return DETECTION_WARNING_CODE_VALUES.includes(value as DetectionWarningCode)
}

/** Check if a redaction state is valid */
export function isDetectionRedactionState(value: string): value is DetectionRedactionState {
  return DETECTION_REDACTION_STATE_VALUES.includes(value as DetectionRedactionState)
}

/** Build a plan token from plan data */
export function buildPlanToken(plan: Omit<DetectionPlan, 'planToken'>): string {
  const payload = JSON.stringify({
    sh: plan.scopeHash,
    rs: plan.ruleSetKey,
    er: [...plan.enabledRules].sort(),
    sf: plan.sourceFreshness,
    ex: plan.expiresAt,
  })
  return simpleStableHash(payload)
}

/** Compare two normalized scopes for equality */
export function areScopesEqual(a: NormalizedDetectionScope, b: NormalizedDetectionScope): boolean {
  return hashDetectionScope(a) === hashDetectionScope(b)
}

// ─── Default Rule Set ────────────────────────────────────────────────────────────

export const DEFAULT_DETECTION_RULE_SET: DetectionRuleSet = {
  key: 'default',
  label: '默认规则集',
  rules: [
    {
      id: 'missing_dependency',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '疑似缺失依赖',
    },
    {
      id: 'duplicate_equivalent',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '重复/等价依赖',
    },
    {
      id: 'self_dependency',
      enabled: true,
      configurable: false,
      safetyCritical: true,
      label: '自依赖',
    },
    {
      id: 'cycle_risk',
      enabled: true,
      configurable: false,
      safetyCritical: true,
      label: '循环风险',
    },
    {
      id: 'buffer_shortfall',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '缓冲不足',
    },
    {
      id: 'schedule_conflict',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '排程冲突',
    },
    {
      id: 'status_conflict',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '状态冲突',
    },
    {
      id: 'blocked_chain',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '下游阻塞链',
    },
    {
      id: 'stale_evidence',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '证据过期',
    },
    {
      id: 'orphaned_external_ref',
      enabled: true,
      configurable: true,
      safetyCritical: false,
      label: '孤立外部引用',
    },
    {
      id: 'data_quality_warning',
      enabled: true,
      configurable: false,
      safetyCritical: true,
      label: '数据质量警告',
    },
  ],
  scopeLimits: {
    maxProjects: 100,
    maxEdges: 5000,
    maxTasksPerProject: 500,
  },
}

// ─── Fixtures ────────────────────────────────────────────────────────────────────

export interface DetectionFixtureSet {
  label: string
  scope: DetectionScope
  expectedNormalizedScope: NormalizedDetectionScope
}

export const DETECTION_FIXTURE_SCOPES: Record<string, DetectionFixtureSet> = {
  minimal: {
    label: '最小合法 scope',
    scope: { organizationId: 1, projectIds: [1, 2] },
    expectedNormalizedScope: {
      organizationId: 1,
      projectIds: [1, 2],
      dateWindowStart: null,
      dateWindowEnd: null,
      maxProjects: 100,
      maxEdges: 5000,
      maxTasksPerProject: 500,
      ruleSetKey: 'default',
    },
  },
  boundedWithDates: {
    label: '有日期窗口的 scope',
    scope: {
      organizationId: 1,
      projectIds: [1, 2, 3],
      dateWindowStart: '2026-01-01',
      dateWindowEnd: '2026-12-31',
      maxProjects: 50,
      maxEdges: 1000,
      ruleSetKey: 'default',
    },
    expectedNormalizedScope: {
      organizationId: 1,
      projectIds: [1, 2, 3],
      dateWindowStart: '2026-01-01',
      dateWindowEnd: '2026-12-31',
      maxProjects: 50,
      maxEdges: 1000,
      maxTasksPerProject: 500,
      ruleSetKey: 'default',
    },
  },
  customRuleSet: {
    label: '自定义规则集 scope',
    scope: {
      organizationId: 2,
      projectIds: [5],
      ruleSetKey: 'strict',
      maxTasksPerProject: 200,
    },
    expectedNormalizedScope: {
      organizationId: 2,
      projectIds: [5],
      dateWindowStart: null,
      dateWindowEnd: null,
      maxProjects: 100,
      maxEdges: 5000,
      maxTasksPerProject: 200,
      ruleSetKey: 'strict',
    },
  },
}

export const DETECTION_FIXTURE_RESULTS: Record<string, DetectionResult> = {
  missingDependency: {
    id: 1,
    runId: 1,
    organizationId: 1,
    ruleId: 'missing_dependency',
    severity: 'high',
    confidence: 'high',
    status: 'open',
    fingerprint: 'abc123def',
    rationale: '项目 B 的里程碑 M2 依赖项目 A 的交付物 D1，但未记录跨项目依赖',
    evidenceSummary: 'consumer=项目B/里程碑M2, provider=项目A/交付物D1, gap_days=5',
    evidenceHash: 'ev_hash_001',
    affectedEndpointHashes: ['proj_a_d1', 'proj_b_m2'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: [],
    redactionState: 'none',
    draftEligible: true,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
  },
  duplicateEquivalent: {
    id: 2,
    runId: 1,
    organizationId: 1,
    ruleId: 'duplicate_equivalent',
    severity: 'medium',
    confidence: 'high',
    status: 'open',
    fingerprint: 'def456abc',
    rationale: '项目 C→项目 D 存在两条等价依赖，类型和端点均相同',
    evidenceSummary: 'dep1=hash_a, dep2=hash_b, type=blocks',
    evidenceHash: 'ev_hash_002',
    affectedEndpointHashes: ['dep_hash_a', 'dep_hash_b'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: [],
    redactionState: 'none',
    draftEligible: false,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:01.000Z',
    updatedAt: '2026-07-31T10:00:01.000Z',
  },
  cycleRisk: {
    id: 3,
    runId: 1,
    organizationId: 1,
    ruleId: 'cycle_risk',
    severity: 'critical',
    confidence: 'medium',
    status: 'open',
    fingerprint: 'ghi789jkl',
    rationale: '检测到跨项目依赖循环：项目E→项目F→项目E',
    evidenceSummary: 'cycle涉及项目，但部分路径因权限受限已脱敏',
    evidenceHash: 'ev_hash_003',
    affectedEndpointHashes: ['proj_e_endpoint', 'proj_f_endpoint'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: ['REDACTED_GRAPH_INTEGRITY'],
    redactionState: 'partial',
    draftEligible: false,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:02.000Z',
    updatedAt: '2026-07-31T10:00:02.000Z',
  },
  bufferShortfall: {
    id: 4,
    runId: 1,
    organizationId: 1,
    ruleId: 'buffer_shortfall',
    severity: 'high',
    confidence: 'high',
    status: 'open',
    fingerprint: 'jkl012mno',
    rationale: '项目 G 的交付物延迟 15 天，超出项目 H 设置的 7 天缓冲',
    evidenceSummary: 'provider_delay=15, buffer=7, shortfall=8, affected=项目H/任务T3',
    evidenceHash: 'ev_hash_004',
    affectedEndpointHashes: ['proj_g_deliverable', 'proj_h_task_t3'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: [],
    redactionState: 'none',
    draftEligible: true,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:03.000Z',
    updatedAt: '2026-07-31T10:00:03.000Z',
  },
  statusConflict: {
    id: 5,
    runId: 1,
    organizationId: 1,
    ruleId: 'status_conflict',
    severity: 'medium',
    confidence: 'medium',
    status: 'open',
    fingerprint: 'pqr345stu',
    rationale: '项目 I 的里程碑 M5 状态为"已完成"，但上游依赖项目 J 的交付物尚未完成',
    evidenceSummary: 'provider_status=in_progress, consumer_status=completed, conflict=true',
    evidenceHash: 'ev_hash_005',
    affectedEndpointHashes: ['proj_i_m5', 'proj_j_deliverable'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: [],
    redactionState: 'none',
    draftEligible: false,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:04.000Z',
    updatedAt: '2026-07-31T10:00:04.000Z',
  },
  staleEvidence: {
    id: 6,
    runId: 1,
    organizationId: 1,
    ruleId: 'stale_evidence',
    severity: 'low',
    confidence: 'medium',
    status: 'open',
    fingerprint: 'vwx678yza',
    rationale: '依赖事实的源证据超过 30 天未更新',
    evidenceSummary: 'last_updated=2026-06-15, age_days=46, threshold=30',
    evidenceHash: 'ev_hash_006',
    affectedEndpointHashes: ['stale_dep_hash'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: ['STALE_SOURCE'],
    redactionState: 'none',
    draftEligible: false,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:05.000Z',
    updatedAt: '2026-07-31T10:00:05.000Z',
  },
  redactedSource: {
    id: 7,
    runId: 1,
    organizationId: 1,
    ruleId: 'missing_dependency',
    severity: 'medium',
    confidence: 'low',
    status: 'open',
    fingerprint: 'bcd901efg',
    rationale: '疑似缺失依赖，但提供方项目不可见，已脱敏处理',
    evidenceSummary: null,
    evidenceHash: null,
    affectedEndpointHashes: ['redacted_provider_hash', 'visible_consumer_hash'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: ['REDACTED_ENDPOINT', 'REDACTED_EVIDENCE'],
    redactionState: 'partial',
    draftEligible: false,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:06.000Z',
    updatedAt: '2026-07-31T10:00:06.000Z',
  },
  aiUnavailable: {
    id: 8,
    runId: 1,
    organizationId: 1,
    ruleId: 'missing_dependency',
    severity: 'medium',
    confidence: 'medium',
    status: 'open',
    fingerprint: 'hij234klm',
    rationale: '基于规则检测的疑似缺失依赖（AI 辅助不可用）',
    evidenceSummary: 'consumer=项目K/任务T9, provider=项目L/里程碑M3',
    evidenceHash: 'ev_hash_008',
    affectedEndpointHashes: ['proj_k_t9', 'proj_l_m3'],
    sourceFreshness: {
      dependencyFactsHash: 'dh_001',
      snapshotCreatedAt: '2026-07-31T10:00:00.000Z',
    },
    warnings: ['AI_UNAVAILABLE'],
    redactionState: 'none',
    draftEligible: true,
    ignoreReasonHash: null,
    aiAdvisory: null,
    createdAt: '2026-07-31T10:00:07.000Z',
    updatedAt: '2026-07-31T10:00:07.000Z',
  },
}
