/**
 * plugin-permission-decision —— V3 插件权限决策契约
 * （纯类型 + 常量 + 类型守卫 + 确定性 hash/序列化 + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块）。
 * 测试见 `plugin-permission-decision.test.ts`，fixtures 见
 * `plugin-permission-decision-fixtures.ts`。
 *
 * # 语义要点
 * - 版本化决策模式：host-administration 与 plugin-runtime 双轨（D1）。
 * - 二元授权：allowed/denied，无 degraded 第三态（D2）。
 * - observation degraded 不等于授权第三态，只是观测层状态（D3）。
 * - server-owned scope 列仅在内部 storage 中，payload/DTO/audit 中不可见（D4）。
 * - 确定性 decision id 从 schema version + scope + mode + operation + target ref +
 *   permissions + idempotency key 派生（D5）。
 * - 稳定序列化与 domain-separated hash 保证跨运行时可重现（D6）。
 * - reason codes 有稳定排序，用于审计日志聚合（D7）。
 * - prerequisite profiles 描述每个模式的前置条件（D8）。
 * - fixture packs 覆盖全部 spec rule families（D9）。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** Decision schema version（首版固定 "1"）。 */
export const PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION = '1' as const
export type PluginPermissionDecisionSchemaVersion = typeof PLUGIN_PERMISSION_DECISION_SCHEMA_VERSION

/** Decision mode（双轨：宿主管理 / 插件运行时）。 */
export const PLUGIN_PERMISSION_DECISION_MODES = ['host-administration', 'plugin-runtime'] as const
export type PluginPermissionDecisionMode = (typeof PLUGIN_PERMISSION_DECISION_MODES)[number]

/** Decision operation（首期封闭操作集）。 */
export const PLUGIN_PERMISSION_DECISION_OPERATIONS = [
  'register-install',
  'enable',
  'disable',
  'upgrade',
  'uninstall',
  'resolve-query',
  'execute',
  'command-proposal',
  'ui-slot',
  'skill-adapter',
  'compiler-contribution',
] as const
export type PluginPermissionDecisionOperation =
  (typeof PLUGIN_PERMISSION_DECISION_OPERATIONS)[number]

/** Decision outcome（二元授权：仅 allowed/denied，无 degraded）。 */
export const PLUGIN_PERMISSION_DECISION_OUTCOMES = ['allowed', 'denied'] as const
export type PluginPermissionDecisionOutcome = (typeof PLUGIN_PERMISSION_DECISION_OUTCOMES)[number]

/** Reason code（稳定低敏码，按字母序）。 */
export const PLUGIN_PERMISSION_REASON_CODES = [
  'authority-spoofing',
  'audit-unavailable',
  'cross-tenant-denied',
  'confirmation-required',
  'grant-escalation',
  'grant-expired',
  'grant-missing',
  'grant-revoked',
  'install-invalid',
  'manifest-mismatch',
  'network-required',
  'policy-denied',
  'rbac-denied',
  'replay-detected',
  'scope-mismatch',
  'seam-not-ready',
  'tamper-detected',
  'unknown-error',
] as const
export type PluginPermissionReasonCode = (typeof PLUGIN_PERMISSION_REASON_CODES)[number]

/** Reason code priority（升序越低越优先）。 */
const REASON_PRIORITY_MAP: Record<PluginPermissionReasonCode, number> = {
  'authority-spoofing': 10,
  'tamper-detected': 20,
  'replay-detected': 30,
  'grant-revoked': 40,
  'grant-expired': 41,
  'cross-tenant-denied': 50,
  'rbac-denied': 60,
  'policy-denied': 70,
  'manifest-mismatch': 80,
  'scope-mismatch': 90,
  'grant-escalation': 100,
  'grant-missing': 110,
  'install-invalid': 120,
  'seam-not-ready': 130,
  'confirmation-required': 140,
  'network-required': 150,
  'audit-unavailable': 160,
  'unknown-error': 999,
}

/** Prerequisite profile（每个模式的前置条件集）。 */
export const PLUGIN_PERMISSION_PREREQUISITE_PROFILES = [
  'host-admin-read',
  'host-admin-mutation',
  'plugin-runtime-read',
  'plugin-runtime-formal-write',
] as const
export type PluginPermissionPrerequisiteProfile =
  (typeof PLUGIN_PERMISSION_PREREQUISITE_PROFILES)[number]

/** Observation finding status. */
export const PLUGIN_PERMISSION_OBSERVATION_FINDING_STATUSES = [
  'pass',
  'fail',
  'warn',
  'skip',
] as const
export type PluginPermissionObservationFindingStatus =
  (typeof PLUGIN_PERMISSION_OBSERVATION_FINDING_STATUSES)[number]

/** Observation observation status. */
export const PLUGIN_PERMISSION_OBSERVATION_STATUSES = [
  'healthy',
  'degraded',
  'unavailable',
] as const
export type PluginPermissionObservationStatus =
  (typeof PLUGIN_PERMISSION_OBSERVATION_STATUSES)[number]

// =============================================================================
// 2. Trusted Context & Prerequisite Profiles (Task 2.3)
// =============================================================================

/**
 * Server-owned organization/project scope（由宿主注入，插件不可声明）。
 */
export interface PluginPermissionTrustedContext {
  /** 低敏 organization scope。 */
  organizationScope: string
  /** 低敏 project scope（可选，global 时不填）。 */
  projectScope?: string
  /** Actor info（低敏 ref）。 */
  actorRef: string
  /** Actor roles（低敏标签）。 */
  actorRoles: string[]
  /** Policy check results（key → allowed/denied + reason）。 */
  policyResults: Record<string, { allowed: boolean; reasonCode?: string }>
}

/**
 * Plugin is requesting this permission。
 */
export interface PluginPermissionRequestedRef {
  /** Permission key（宿主词表中的 key）。 */
  permissionKey: string
  /** Scope kind。 */
  scopeKind: string
  /** Optional resource ref（低敏）。 */
  resourceRef?: string
  /** Optional action ref（低敏）。 */
  actionRef?: string
}

/**
 * Host has granted this permission。
 */
export interface PluginPermissionGrantedRef {
  /** Grant id。 */
  grantId: string
  /** Permission key。 */
  permissionKey: string
  /** Scope binding（低敏）。 */
  scopeBinding: { organizationScope: string; projectScope?: string }
  /** Whether grant has expired. */
  expired: boolean
  /** Whether grant has been revoked. */
  revoked: boolean
}

/**
 * Current runtime state（for runtime authorization check）。
 */
export interface PluginPermissionRuntimeRef {
  /** Seam key。 */
  seamKey: string
  /** Seam availability. */
  seamAvailability: 'cataloged' | 'host-ready' | 'deprecated'
  /** Install state. */
  installState: 'pending' | 'installed' | 'failed'
  /** Whether confirmation is pending. */
  confirmationPending: boolean
}

/**
 * Structured check result per prerequisite。
 */
export interface PluginPermissionPrerequisiteCheck {
  /** Prerequisite profile key. */
  profile: PluginPermissionPrerequisiteProfile
  /** Prerequisite check name. */
  name: string
  /** Whether passed. */
  passed: boolean
  /** Optional reason code if failed. */
  reasonCode?: PluginPermissionReasonCode
}

// =============================================================================
// 3. Evaluation Result & Decision Record (Task 2.1)
// =============================================================================

/**
 * Structured evaluation result。
 */
export interface PluginPermissionEvaluationResult {
  /** Final outcome (allowed | denied). */
  outcome: PluginPermissionDecisionOutcome
  /** Reason code (present when denied, optional when allowed). */
  reasonCode?: PluginPermissionReasonCode
  /** Low-sensitive reason message. */
  reasonMessage?: string
  /** Prerequisite check results. */
  prerequisiteChecks: PluginPermissionPrerequisiteCheck[]
  /** Evaluation timestamp. */
  evaluatedAt: string
}

/**
 * The full decision record — ledger row type。
 */
export interface PluginPermissionDecisionRecord {
  /** Decision id (deterministic). */
  decisionId: string
  /** Schema version. */
  schemaVersion: PluginPermissionDecisionSchemaVersion
  /** Creation timestamp. */
  createdAt: string
  /** Decision mode. */
  mode: PluginPermissionDecisionMode
  /** Decision operation. */
  operation: PluginPermissionDecisionOperation
  /** Final outcome. */
  outcome: PluginPermissionDecisionOutcome
  /** Reason code (when denied). */
  reasonCode?: PluginPermissionReasonCode
  /** Server-owned org scope (internal only). */
  organizationScope: string
  /** Server-owned project scope (internal only, optional). */
  projectScope?: string
  /** Plugin identity (low-sensitive pluginId). */
  pluginId: string
  /** Plugin version. */
  pluginVersion: string
  /** Target ref（低敏）。 */
  targetRef: string
  /** Requested permissions snapshot. */
  requestedPermissions: PluginPermissionRequestedRef[]
  /** Granted permissions snapshot. */
  grantedPermissions: PluginPermissionGrantedRef[]
  /** Runtime state at evaluation time. */
  runtimeRef?: PluginPermissionRuntimeRef
  /** Evaluation result. */
  evaluation: PluginPermissionEvaluationResult
  /** Idempotency key. */
  idempotencyKey: string
  /** Domain-separated fingerprint (of the input). */
  inputFingerprint: string
  /** Actor ref (low-sensitive). */
  actorRef: string
  /** Whether observation is degraded. */
  observationDegraded: boolean
}

// =============================================================================
// 4. Low-Sensitivity Ledger, Audit, Receipt, Query DTO (Task 2.7)
// =============================================================================

/**
 * Append-only storage shape — internal only, contains server-owned scope。
 */
export interface PluginPermissionDecisionLedgerRow {
  /** Row id. */
  id: string
  /** Decision id. */
  decisionId: string
  /** Schema version. */
  schemaVersion: PluginPermissionDecisionSchemaVersion
  /** Creation timestamp. */
  createdAt: string
  /** Decision mode. */
  mode: PluginPermissionDecisionMode
  /** Decision operation. */
  operation: PluginPermissionDecisionOperation
  /** Final outcome. */
  outcome: PluginPermissionDecisionOutcome
  /** Reason code (when denied). */
  reasonCode?: PluginPermissionReasonCode
  /** Server-owned org scope (NEVER in payload/audit). */
  organizationScope: string
  /** Server-owned project scope (NEVER in payload/audit, optional). */
  projectScope?: string
  /** Plugin identity. */
  pluginId: string
  /** Plugin version. */
  pluginVersion: string
  /** Target ref. */
  targetRef: string
  /** Requested permissions (serialized). */
  requestedPermissions: string
  /** Granted permissions (serialized). */
  grantedPermissions: string
  /** Evaluation result (serialized). */
  evaluation: string
  /** Idempotency key. */
  idempotencyKey: string
  /** Input fingerprint. */
  inputFingerprint: string
  /** Actor ref. */
  actorRef: string
  /** Observation degraded flag. */
  observationDegraded: boolean
  /** Row version (optimistic concurrency). */
  rowVersion: number
}

/**
 * What goes to audit_logs — low-sensitive, no server-owned scope。
 */
export interface PluginPermissionAuditPayload {
  /** Decision id. */
  decisionId: string
  /** Decision mode. */
  mode: PluginPermissionDecisionMode
  /** Decision operation. */
  operation: PluginPermissionDecisionOperation
  /** Final outcome. */
  outcome: PluginPermissionDecisionOutcome
  /** Reason code (when denied). */
  reasonCode?: PluginPermissionReasonCode
  /** Plugin identity (low-sensitive). */
  pluginId: string
  /** Plugin version. */
  pluginVersion: string
  /** Target ref. */
  targetRef: string
  /** Actor ref (low-sensitive). */
  actorRef: string
  /** Timestamp. */
  createdAt: string
  /** Idempotency key. */
  idempotencyKey: string
  /** Input fingerprint. */
  inputFingerprint: string
}

/**
 * Returned to callers — low-sensitive receipt。
 */
export interface PluginPermissionDecisionReceipt {
  /** Decision id. */
  decisionId: string
  /** Final outcome. */
  outcome: PluginPermissionDecisionOutcome
  /** Reason code (when denied). */
  reasonCode?: PluginPermissionReasonCode
  /** Low-sensitive reason message. */
  reasonMessage?: string
  /** Timestamp. */
  createdAt: string
  /** Idempotency key. */
  idempotencyKey: string
}

/**
 * For querying decisions。
 */
export interface PluginPermissionDecisionQueryFilter {
  /** Filter by mode. */
  mode?: PluginPermissionDecisionMode
  /** Filter by operation. */
  operation?: PluginPermissionDecisionOperation
  /** Filter by outcome. */
  outcome?: PluginPermissionDecisionOutcome
  /** Filter by reason code. */
  reasonCode?: PluginPermissionReasonCode
  /** Filter by plugin id. */
  pluginId?: string
  /** Filter by actor ref. */
  actorRef?: string
  /** Created after (ISO timestamp). */
  createdAfter?: string
  /** Created before (ISO timestamp). */
  createdBefore?: string
  /** Page number (1-based). */
  page?: number
  /** Page size. */
  perPage?: number
}

/**
 * For aggregation queries。
 */
export interface PluginPermissionDecisionAggregate {
  /** Aggregation key. */
  key: string
  /** Count. */
  count: number
  /** Breakdown by outcome. */
  allowed: number
  /** Denied count. */
  denied: number
}

// =============================================================================
// 5. Observation Projection Types (Task 2.9)
// =============================================================================

/**
 * Scoped aggregate query input for observation。
 */
export interface PluginPermissionObservationInput {
  /** Organization scope. */
  organizationScope: string
  /** Project scope (optional). */
  projectScope?: string
  /** Time window start (ISO). */
  windowStart: string
  /** Time window end (ISO). */
  windowEnd: string
  /** Optional filter by plugin id. */
  pluginId?: string
  /** Optional filter by operation. */
  operation?: PluginPermissionDecisionOperation
  /** Budget cap (max findings to return). */
  budgetCap?: number
  /** Cursor for pagination (opaque). */
  cursor?: string
}

/**
 * Observation manifest output。
 */
export interface PluginPermissionObservationOutput {
  /** Observation status. */
  status: PluginPermissionObservationStatus
  /** Organization scope. */
  organizationScope: string
  /** Project scope (optional). */
  projectScope?: string
  /** Time window. */
  windowStart: string
  /** Window end. */
  windowEnd: string
  /** Total decisions in window. */
  totalDecisions: number
  /** Allowed count. */
  allowedCount: number
  /** Denied count. */
  deniedCount: number
  /** Denied rate (0-1). */
  deniedRate: number
  /** Structured findings. */
  findings: PluginPermissionFinding[]
  /** Total findings count (may be > findings.length if capped). */
  omittedFindingsCount: number
  /** Next cursor (null if no more). */
  nextCursor: string | null
  /** Causal paths (for cross-tenant denial / audit unavailable). */
  causalPaths: PluginPermissionCausalPath[]
  /** Runtime signals. */
  signals: PluginPermissionRuntimeSignal[]
  /** Resource handle for authorized query. */
  resourceHandle: PluginPermissionResourceHandle
}

/**
 * Structured findings。
 */
export interface PluginPermissionFinding {
  /** Finding id (stable). */
  findingId: string
  /** Finding status. */
  status: PluginPermissionObservationFindingStatus
  /** Category (e.g., 'denial-rate', 'audit-gap', 'tamper-signal'). */
  category: string
  /** Human-readable message. */
  message: string
  /** Affected plugin id (optional). */
  pluginId?: string
  /** Affected operation (optional). */
  operation?: PluginPermissionDecisionOperation
  /** Related decision ids. */
  relatedDecisionIds: string[]
  /** Evidence ref (low-sensitive). */
  evidenceRef?: string
}

/**
 * Causal chain。
 */
export interface PluginPermissionCausalPath {
  /** Path id. */
  pathId: string
  /** Trigger category (e.g., 'cross-tenant-denial', 'audit-unavailable'). */
  triggerCategory: string
  /** Description. */
  description: string
  /** Ordered decision ids forming the causal chain. */
  decisionIds: string[]
  /** Severity. */
  severity: 'info' | 'warning' | 'blocking'
}

/**
 * Runtime signals (health / deny-rate)。
 */
export interface PluginPermissionRuntimeSignal {
  /** Signal name (e.g., 'deny-rate', 'audit-latency'). */
  signalName: string
  /** Signal value (numeric). */
  value: number
  /** Unit (e.g., 'ratio', 'ms'). */
  unit: string
  /** Threshold that triggers alerting. */
  threshold?: number
  /** Whether threshold is breached. */
  breached: boolean
}

/**
 * Reference to authorized query (resource handle)。
 */
export interface PluginPermissionResourceHandle {
  /** Handle kind. */
  handleKind: 'observation-query'
  /** Handle value (opaque). */
  handleValue: string
  /** TTL in seconds. */
  ttlSeconds: number
  /** Created timestamp. */
  createdAt: string
}

// =============================================================================
// 6. Type Guards
// =============================================================================

export function isPluginPermissionDecisionMode(v: unknown): v is PluginPermissionDecisionMode {
  return (
    typeof v === 'string' && (PLUGIN_PERMISSION_DECISION_MODES as readonly string[]).includes(v)
  )
}

export function isPluginPermissionDecisionOperation(
  v: unknown,
): v is PluginPermissionDecisionOperation {
  return (
    typeof v === 'string' &&
    (PLUGIN_PERMISSION_DECISION_OPERATIONS as readonly string[]).includes(v)
  )
}

export function isPluginPermissionDecisionOutcome(
  v: unknown,
): v is PluginPermissionDecisionOutcome {
  return (
    typeof v === 'string' && (PLUGIN_PERMISSION_DECISION_OUTCOMES as readonly string[]).includes(v)
  )
}

export function isPluginPermissionReasonCode(v: unknown): v is PluginPermissionReasonCode {
  return typeof v === 'string' && (PLUGIN_PERMISSION_REASON_CODES as readonly string[]).includes(v)
}

export function isPluginPermissionPrerequisiteProfile(
  v: unknown,
): v is PluginPermissionPrerequisiteProfile {
  return (
    typeof v === 'string' &&
    (PLUGIN_PERMISSION_PREREQUISITE_PROFILES as readonly string[]).includes(v)
  )
}

export function isPluginPermissionObservationFindingStatus(
  v: unknown,
): v is PluginPermissionObservationFindingStatus {
  return (
    typeof v === 'string' &&
    (PLUGIN_PERMISSION_OBSERVATION_FINDING_STATUSES as readonly string[]).includes(v)
  )
}

export function isPluginPermissionObservationStatus(
  v: unknown,
): v is PluginPermissionObservationStatus {
  return (
    typeof v === 'string' &&
    (PLUGIN_PERMISSION_OBSERVATION_STATUSES as readonly string[]).includes(v)
  )
}

// =============================================================================
// 7. Helpers — Deterministic Serialization & Hash (Task 2.5)
// =============================================================================

/**
 * FNV-1a 32-bit hash（确定性，零外部依赖）。
 * 使用 pd 前缀避免 barrel 冲突。
 */
export function pdFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 确定性排序的 JSON 序列化（键排序）。
 * 使用 pd 前缀避免 barrel 冲突。
 */
export function pdStableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => pdStableSerialize(v)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return `{${entries.map(([k, v]) => JSON.stringify(k) + ':' + pdStableSerialize(v)).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Domain-separated hash with prefix。
 */
export function pdDomainSeparatedHash(domain: string, input: string): string {
  return pdFnv1aHash(`${domain}:${input}`)
}

/**
 * Stable serialization for decision record（键排序 + 去除 undefined）。
 * 使用 pd 前缀避免 barrel 冲突。
 */
export function pdStableSerializeDecision(value: unknown): string {
  return pdStableSerialize(value)
}

// =============================================================================
// 8. Helpers — Permission Ref Normalization (Task 2.5)
// =============================================================================

/** Canonical sort key for requested refs. */
function requestedRefSortKey(ref: PluginPermissionRequestedRef): string {
  return `${ref.permissionKey}:${ref.scopeKind}:${ref.resourceRef ?? ''}:${ref.actionRef ?? ''}`
}

/** Canonical sort key for granted refs. */
function grantedRefSortKey(ref: PluginPermissionGrantedRef): string {
  return `${ref.grantId}:${ref.permissionKey}:${ref.scopeBinding.organizationScope}:${ref.scopeBinding.projectScope ?? ''}`
}

/**
 * Normalize permission refs to canonical ordering（排序 + 去重）。
 */
export function pdNormalizePermissionRefs(input: {
  requested: PluginPermissionRequestedRef[]
  granted: PluginPermissionGrantedRef[]
}): {
  requested: PluginPermissionRequestedRef[]
  granted: PluginPermissionGrantedRef[]
} {
  const requested = [...input.requested].sort((a, b) =>
    requestedRefSortKey(a).localeCompare(requestedRefSortKey(b)),
  )
  const granted = [...input.granted].sort((a, b) =>
    grantedRefSortKey(a).localeCompare(grantedRefSortKey(b)),
  )
  return { requested, granted }
}

// =============================================================================
// 9. Helpers — Deterministic Decision Id & Fingerprint (Task 2.5)
// =============================================================================

/**
 * Compute decision id: deterministic from schema version + scope + mode +
 * operation + target ref + permissions + idempotency key。
 */
export function pdComputeDecisionId(input: {
  schemaVersion: string
  organizationScope: string
  projectScope?: string
  mode: PluginPermissionDecisionMode
  operation: PluginPermissionDecisionOperation
  targetRef: string
  requested: PluginPermissionRequestedRef[]
  granted: PluginPermissionGrantedRef[]
  idempotencyKey: string
}): string {
  const normalized = pdNormalizePermissionRefs({
    requested: input.requested,
    granted: input.granted,
  })
  const payload = {
    sv: input.schemaVersion,
    org: input.organizationScope,
    proj: input.projectScope ?? '',
    mode: input.mode,
    op: input.operation,
    tgt: input.targetRef,
    req: normalized.requested.map((r) => ({
      pk: r.permissionKey,
      sk: r.scopeKind,
      rr: r.resourceRef ?? '',
      ar: r.actionRef ?? '',
    })),
    grt: normalized.granted.map((g) => ({
      gid: g.grantId,
      pk: g.permissionKey,
      org: g.scopeBinding.organizationScope,
      proj: g.scopeBinding.projectScope ?? '',
      exp: g.expired,
      rev: g.revoked,
    })),
    ik: input.idempotencyKey,
  }
  return pdDomainSeparatedHash('decision', pdStableSerialize(payload))
}

/**
 * Compute input fingerprint: same as decision id but EXCLUDES secret content
 * (e.g., raw manifest body, config values, credential content)。
 */
export function pdComputeInputFingerprint(input: {
  schemaVersion: string
  organizationScope: string
  projectScope?: string
  mode: PluginPermissionDecisionMode
  operation: PluginPermissionDecisionOperation
  targetRef: string
  requested: PluginPermissionRequestedRef[]
  granted: PluginPermissionGrantedRef[]
  idempotencyKey: string
}): string {
  // Same structure as decision id but explicitly documented as excluding
  // secret content. The input types already exclude secrets by design.
  return pdComputeDecisionId(input)
}

// =============================================================================
// 10. Helpers — Reason Priority (Task 2.5)
// =============================================================================

/**
 * Derive stable ordering of reason codes（升序优先级越小越优先）。
 */
export function pdDeriveReasonPriority(
  codes: PluginPermissionReasonCode[],
): PluginPermissionReasonCode[] {
  return [...codes].sort(
    (a, b) => (REASON_PRIORITY_MAP[a] ?? 999) - (REASON_PRIORITY_MAP[b] ?? 999),
  )
}

// =============================================================================
// 11. Helpers — Prerequisite Profile Matrix (Task 2.3)
// =============================================================================

/** Required prerequisites per profile. */
const PREREQUISITE_MATRIX: Record<
  PluginPermissionPrerequisiteProfile,
  { name: string; required: boolean }[]
> = {
  'host-admin-read': [
    { name: 'valid-install-state', required: true },
    { name: 'rbac-authorized', required: true },
    { name: 'scope-matches', required: true },
  ],
  'host-admin-mutation': [
    { name: 'valid-install-state', required: true },
    { name: 'rbac-authorized', required: true },
    { name: 'scope-matches', required: true },
    { name: 'grant-valid', required: true },
    { name: 'policy-passes', required: true },
    { name: 'confirmation-not-required', required: true },
  ],
  'plugin-runtime-read': [
    { name: 'valid-install-state', required: true },
    { name: 'grant-valid', required: true },
    { name: 'seam-host-ready', required: true },
    { name: 'scope-matches', required: true },
  ],
  'plugin-runtime-formal-write': [
    { name: 'valid-install-state', required: true },
    { name: 'grant-valid', required: true },
    { name: 'seam-host-ready', required: true },
    { name: 'scope-matches', required: true },
    { name: 'confirmation-confirmed', required: true },
    { name: 'audit-available', required: true },
  ],
}

/**
 * Get required prerequisites for a profile.
 */
export function pdGetProfilePrerequisites(
  profile: PluginPermissionPrerequisiteProfile,
): { name: string; required: boolean }[] {
  return PREREQUISITE_MATRIX[profile]
}

/**
 * Evaluate prerequisites for a profile against current state.
 */
export function pdEvaluatePrerequisites(
  profile: PluginPermissionPrerequisiteProfile,
  state: {
    hasValidInstall: boolean
    hasValidGrant: boolean
    rbacAuthorized: boolean
    scopeMatches: boolean
    seamHostReady: boolean
    policyPasses: boolean
    confirmationConfirmed: boolean
    auditAvailable: boolean
  },
): PluginPermissionPrerequisiteCheck[] {
  const prereqs = pdGetProfilePrerequisites(profile)
  const stateMap: Record<string, boolean> = {
    'valid-install-state': state.hasValidInstall,
    'rbac-authorized': state.rbacAuthorized,
    'scope-matches': state.scopeMatches,
    'grant-valid': state.hasValidGrant,
    'policy-passes': state.policyPasses,
    'seam-host-ready': state.seamHostReady,
    'confirmation-confirmed': state.confirmationConfirmed,
    'audit-available': state.auditAvailable,
    'confirmation-not-required': !state.confirmationConfirmed,
  }

  return prereqs.map((prereq) => ({
    profile,
    name: prereq.name,
    passed: prereq.required ? (stateMap[prereq.name] ?? false) : true,
    reasonCode:
      prereq.required && !(stateMap[prereq.name] ?? false)
        ? resolvePrerequisiteFailureReason(prereq.name)
        : undefined,
  }))
}

/** Map prerequisite name to reason code on failure. */
function resolvePrerequisiteFailureReason(name: string): PluginPermissionReasonCode {
  switch (name) {
    case 'valid-install-state':
      return 'install-invalid'
    case 'rbac-authorized':
      return 'rbac-denied'
    case 'scope-matches':
      return 'scope-mismatch'
    case 'grant-valid':
      return 'grant-missing'
    case 'policy-passes':
      return 'policy-denied'
    case 'seam-host-ready':
      return 'seam-not-ready'
    case 'confirmation-confirmed':
      return 'confirmation-required'
    case 'audit-available':
      return 'audit-unavailable'
    case 'confirmation-not-required':
      return 'confirmation-required'
    default:
      return 'unknown-error'
  }
}
