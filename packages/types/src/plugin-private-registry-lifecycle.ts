/**
 * plugin-private-registry-lifecycle —— V3 组织私有插件目录生命周期共享契约
 * （纯类型 + 常量 + 状态机 + 确定性 hash/序列化 + 类型守卫 + 低敏 sanitization，
 * 零运行时依赖，零网络/IO/时间/随机数依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块。fixtures 见
 * `plugin-private-registry-lifecycle-fixtures.ts`，测试见
 * `plugin-private-registry-lifecycle.test.ts`。
 *
 * # 语义要点（对应 design.md D1–D11 与 spec Requirements）
 * - hybrid 所有权：核心托管目录索引/权限/状态机/事务/审计，组织拥有私有内容。
 * - 目录只存不可变引用，不成为第二个包仓库（D3）。
 * - 目录状态机与安装状态机严格分离（D4）。
 * - 所有变更走通用 preview/confirm command boundary（D5）。
 * - 批准/回滚采用 maker-checker（D6）。
 * - 发现与版本解析确定、租户内且兼容（D7）。
 * - 回滚先准备、后委托生命周期、最后切换推荐指针（D8）。
 * - 低敏审计复用现有可信写入（D11）。
 */

// =============================================================================
// 1. 枚举与常量
// =============================================================================

/** 目录 release 状态（封闭枚举，state machine D4）。 */
export const REGISTRY_RELEASE_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'deprecated',
  'withdrawn',
] as const
export type RegistryReleaseStatus = (typeof REGISTRY_RELEASE_STATUSES)[number]

/** 目录状态迁移表（D4：只允许这些迁移）。 */
export const REGISTRY_STATUS_TRANSITIONS: Record<
  RegistryReleaseStatus,
  readonly RegistryReleaseStatus[]
> = {
  draft: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  approved: ['deprecated', 'withdrawn'],
  rejected: [], // terminal — rejected releases cannot transition
  deprecated: ['approved', 'withdrawn'],
  withdrawn: [], // must re-enter through new review cycle (new release)
}
export type RegistryStatusTransition = {
  from: RegistryReleaseStatus
  to: RegistryReleaseStatus
}

/** 命令 action（preview/confirm boundary D5）。 */
export const REGISTRY_COMMAND_ACTIONS = [
  'create-release',
  'submit-for-review',
  'approve',
  'reject',
  'deprecate',
  'undeprecate',
  'withdraw',
  'restore-request',
  'rollback',
] as const
export type RegistryCommandAction = (typeof REGISTRY_COMMAND_ACTIONS)[number]

/** 审核决策。 */
export const REGISTRY_REVIEW_DECISIONS = ['approved', 'rejected'] as const
export type RegistryReviewDecision = (typeof REGISTRY_REVIEW_DECISIONS)[number]

/** 操作/命令状态（幂等操作生命周期）。 */
export const REGISTRY_OPERATION_STATUSES = [
  'pending',
  'confirmed',
  'applying',
  'committed',
  'failed',
  'degraded',
  'compensated',
] as const
export type RegistryOperationStatus = (typeof REGISTRY_OPERATION_STATUSES)[number]

/** 操作类型。 */
export const REGISTRY_OPERATION_TYPES = [
  'submit',
  'approve',
  'reject',
  'deprecate',
  'undeprecate',
  'withdraw',
  'restore-request',
  'rollback',
] as const
export type RegistryOperationType = (typeof REGISTRY_OPERATION_TYPES)[number]

/** RBAC permission codes（W6 私有目录）。 */
export const REGISTRY_PERMISSIONS = [
  'plugin_registry:view',
  'plugin_registry:submit',
  'plugin_registry:review',
  'plugin_registry:manage',
  'plugin_registry:rollback',
] as const
export type RegistryPermission = (typeof REGISTRY_PERMISSIONS)[number]

/** 稳定错误码（非泄露）。 */
export const REGISTRY_ERROR_CODES = [
  // validation
  'registry-invalid-identity',
  'registry-invalid-version',
  'registry-invalid-digest',
  'registry-invalid-range',
  'registry-invalid-action',
  'registry-invalid-handle',
  'registry-payload-too-large',
  // state machine
  'registry-illegal-status-transition',
  'registry-release-not-found',
  'registry-release-already-exists',
  'registry-digest-conflict',
  // receipt
  'registry-receipt-invalid',
  'registry-receipt-cross-org',
  'registry-receipt-expired',
  'registry-receipt-revoked',
  'registry-receipt-integrity-failed',
  // authorization
  'registry-org-not-found',
  'registry-org-membership-expired',
  'registry-permission-denied',
  'registry-maker-checker-violation',
  // preview/confirm
  'registry-preview-expired',
  'registry-preview-replayed',
  'registry-preview-stale',
  'registry-preview-cross-org',
  'registry-preview-target-mismatch',
  'registry-preview-action-mismatch',
  'registry-preview-digest-mismatch',
  // rollback
  'registry-rollback-target-invalid',
  'registry-rollback-target-withdrawn',
  'registry-rollback-target-incompatible',
  'registry-rollback-no-instances',
  'registry-rollback-partial-failure',
  'registry-rollback-degraded-blocks-new',
  // version resolution
  'registry-no-compatible-version',
  'registry-version-excluded',
  // concurrency
  'registry-stale-cas',
  'registry-concurrent-modification',
  // general
  'registry-tool-error',
  'registry-network-forbidden',
] as const
export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number]

/** 低敏 reason codes（审计用）。 */
export const REGISTRY_REASON_CODES = [
  'reason-status-transition',
  'reason-permission-denied',
  'reason-maker-checker-violation',
  'reason-stale-preview',
  'reason-replay-detected',
  'reason-cross-org-attempt',
  'reason-receipt-invalid',
  'reason-digest-conflict',
  'reason-rollback-success',
  'reason-rollback-failure',
  'reason-rollback-degraded',
  'reason-rollback-compensated',
  'reason-org-not-found',
  'reason-membership-expired',
  'reason-validation-error',
  'reason-concurrent-modification',
] as const
export type RegistryReasonCode = (typeof REGISTRY_REASON_CODES)[number]

// =============================================================================
// 2. 核心类型
// =============================================================================

/** plugin identity within an organization. */
export interface PluginIdentity {
  /** Normalized pluginId (lowercase namespace format: `org.plugin-name`). */
  pluginId: string
  /** Display name. */
  name: string
}

/** Digest triple for release integrity. */
export interface ReleaseDigests {
  /** Package content digest (sha256/sha512). */
  packageDigest: string
  /** Manifest digest. */
  manifestDigest: string
  /** Compatibility digest (host/seam compatibility hash). */
  compatibilityDigest: string
}

/** Low-sensitive provenance metadata. */
export interface RegistryProvenance {
  /** Distribution class from manifest. */
  distribution: string
  /** Low-sensitive source ref (e.g., "fixture:first-party"). */
  sourceRef?: string
  /** Upstream package receipt reference (hash only, not full receipt). */
  receiptRef?: string
}

/** Compatibility metadata (resolved from W1 seam catalog). */
export interface RegistryCompatibility {
  /** Host contract version. */
  hostContractVersion: string
  /** Required seams (seamKey + version range). */
  requiredSeams: Array<{ seamKey: string; version: string }>
}

/**
 * Private registry entry (organization-scoped plugin identity).
 * Table: plugin_private_registry_entries
 */
export interface PrivateRegistryEntry {
  /** Row UUID. */
  id: string
  /** Organization FK (never nullable in queries). */
  organizationId: string
  /** Normalized plugin identity (pluginId). */
  pluginIdentity: string
  /** Display name. */
  pluginName: string
  /** Recommended release FK (nullable when no release is recommended). */
  recommendedReleaseId: string | null
  /** Recommended semantic version (denormalized for display). */
  recommendedVersion: string | null
  /** Optimistic concurrency version. */
  rowVersion: number
  /** Created timestamp. */
  createdAt: string
  /** Updated timestamp. */
  updatedAt: string
}

/**
 * Immutable release reference.
 * Table: plugin_private_registry_releases
 */
export interface PrivateRegistryRelease {
  /** Row UUID. */
  id: string
  /** Organization FK. */
  organizationId: string
  /** Plugin identity (pluginId). */
  pluginIdentity: string
  /** Semantic version (unique within org+pluginId). */
  version: string
  /** Digest triple. */
  packageDigest: string
  manifestDigest: string
  compatibilityDigest: string
  /** Upstream package receipt reference (hash). */
  upstreamReceiptRef: string
  /** Release status. */
  status: RegistryReleaseStatus
  /** Low-sensitive metadata (JSON, no secrets). */
  metadata: string | null
  /** Optimistic concurrency version. */
  rowVersion: number
  /** Created timestamp. */
  createdAt: string
  /** Updated timestamp. */
  updatedAt: string
}

/**
 * Review cycle record (maker-checker).
 * Table: plugin_private_registry_reviews
 */
export interface PrivateRegistryReview {
  /** Row UUID. */
  id: string
  /** Release FK. */
  releaseId: string
  /** Organization FK. */
  organizationId: string
  /** Review cycle number (monotonic per release). */
  cycleNumber: number
  /** Submitter actor reference hash. */
  submitterRef: string
  /** Reviewer actor reference hash (must differ from submitter). */
  reviewerRef: string | null
  /** Review decision (pending until reviewer acts). */
  decision: RegistryReviewDecision | 'pending'
  /** Low-sensitive reason code. */
  reasonCode: RegistryReasonCode | null
  /** Source hash for stale detection. */
  sourceHash: string
  /** Created timestamp. */
  createdAt: string
  /** Resolved timestamp (null if pending). */
  resolvedAt: string | null
}

/**
 * Command/rollback operation (idempotent).
 * Table: plugin_private_registry_operations
 */
export interface PrivateRegistryOperation {
  /** Row UUID. */
  id: string
  /** Organization FK. */
  organizationId: string
  /** Operation type. */
  operationType: RegistryOperationType
  /** Idempotency key (unique within org). */
  idempotencyKey: string
  /** Target release FK (nullable for list/resolve). */
  targetReleaseId: string | null
  /** Operation status. */
  status: RegistryOperationStatus
  /** Preview source hash (stale detection). */
  previewSourceHash: string
  /** Impact summary (JSON, low-sensitive). */
  impactSummary: string | null
  /** Error code (if failed/degraded). */
  errorCode: RegistryErrorCode | null
  /** Reason code (for audit). */
  reasonCode: RegistryReasonCode | null
  /** Created timestamp. */
  createdAt: string
  /** Updated timestamp. */
  updatedAt: string
}

/**
 * Command preview (pre-confirm diff).
 * Generated by preview service; consumed by confirm service.
 */
export interface PrivateRegistryCommandPreview {
  /** Preview handle (one-time use, TTL-bound). */
  handle: string
  /** Organization FK. */
  organizationId: string
  /** Actor reference hash. */
  actorRef: string
  /** Command action. */
  action: RegistryCommandAction
  /** Target release ID. */
  targetReleaseId: string
  /** State version at preview time (for stale detection). */
  stateVersion: number
  /** Source hash (for stale detection). */
  sourceHash: string
  /** Diff description (low-sensitive, no secrets). */
  diff: string
  /** Impact summary (low-sensitive). */
  impactSummary: string[]
  /** TTL in seconds. */
  ttlSeconds: number
  /** Created timestamp. */
  createdAt: string
  /** Expires at timestamp. */
  expiresAt: string
}

/**
 * Rollback plan (D8: pre-prepare, delegate lifecycle, commit pointer).
 */
export interface PrivateRegistryRollbackPlan {
  /** Plan ID. */
  id: string
  /** Organization FK. */
  organizationId: string
  /** Current recommended release ID. */
  currentRecommendedReleaseId: string
  /** Target release ID (must be approved, complete, compatible). */
  targetReleaseId: string
  /** Target semantic version. */
  targetVersion: string
  /** Whether to update recommended pointer (default true). */
  updateRecommendedPointer: boolean
  /** Explicitly selected installation instance IDs (empty = pointer only). */
  selectedInstanceIds: string[]
  /** Diff description (low-sensitive). */
  diff: string
  /** Preview handle. */
  handle: string
}

/**
 * 回滚阻断 finding 稳定码（v3-organization-private-plugin-directory tasks 3.5/3.6）。
 * 任一存在时回滚预览 MUST 标记 blocking，且不得创建确认提交。
 */
export const PRIVATE_REGISTRY_ROLLBACK_BLOCKING_CODES = [
  'rollback-target-not-approved',
  'rollback-target-integrity-incomplete',
  'rollback-target-incompatible',
  'rollback-permission-elevation',
  'rollback-target-same-as-current',
] as const
export type PrivateRegistryRollbackBlockingCode =
  (typeof PRIVATE_REGISTRY_ROLLBACK_BLOCKING_CODES)[number]

/**
 * 回滚结构化预览 diff（低敏）：manifest/package digest 与权限/兼容性的 from->to 对照，
 * 附阻断 finding 集合。digest 只作对照不回显内容；权限仅列 key 词表。
 */
export interface PrivateRegistryRollbackDiff {
  /** 当前推荐 release id（字符串化）。 */
  currentReleaseId: string
  /** 回滚目标 release id。 */
  targetReleaseId: string
  /** 当前版本。 */
  currentVersion: string
  /** 目标版本。 */
  targetVersion: string
  /** manifest digest 对照（缺失以 null 呈现）。 */
  manifestDigestBefore: string | null
  manifestDigestAfter: string | null
  /** package digest 对照。 */
  packageDigestBefore: string | null
  packageDigestAfter: string | null
  /** 兼容性摘要 digest 对照。 */
  compatibilityDigestBefore: string | null
  compatibilityDigestAfter: string | null
  /** 权限差异（目标相对当前）。 */
  permissionDelta: {
    added: readonly string[]
    removed: readonly string[]
    unchanged: readonly string[]
  }
  /** 阻断 finding 稳定码集合（空 = 可提交）。 */
  blockingFindings: readonly PrivateRegistryRollbackBlockingCode[]
  /** 受影响安装计数（低敏聚合）。 */
  affectedActiveCount: number
  /** 显式选中待降级的安装实例 id（空 = 仅指针切换）。 */
  selectedInstanceIds?: readonly number[]
}

/**
 * Low-sensitive read model for list/detail views.
 */
export interface PrivateRegistryReadModel {
  /** Entry ID. */
  entryId: string
  /** Plugin identity. */
  pluginIdentity: string
  /** Display name. */
  pluginName: string
  /** Recommended version (if any). */
  recommendedVersion: string | null
  /** Total release count. */
  releaseCount: number
  /** Latest approved version. */
  latestApprovedVersion: string | null
  /** Latest status. */
  latestStatus: RegistryReleaseStatus
  /** Created timestamp. */
  createdAt: string
  /** Updated timestamp. */
  updatedAt: string
}

/**
 * Release detail read model.
 */
export interface PrivateRegistryReleaseDetail {
  /** Release ID. */
  id: string
  /** Plugin identity. */
  pluginIdentity: string
  /** Display name. */
  pluginName: string
  /** Semantic version. */
  version: string
  /** Status. */
  status: RegistryReleaseStatus
  /** Digests (low-sensitive — hashes only). */
  packageDigest: string
  manifestDigest: string
  compatibilityDigest: string
  /** Upstream receipt ref. */
  upstreamReceiptRef: string
  /** Review cycle count. */
  reviewCycleCount: number
  /** Latest review decision. */
  latestReviewDecision: RegistryReviewDecision | 'pending'
  /** Is this the recommended release? */
  isRecommended: boolean
  /** Metadata. */
  metadata: string | null
  /** Row version. */
  rowVersion: number
  /** Timestamps. */
  createdAt: string
  updatedAt: string
}

/**
 * Paginated list response (generic).
 */
export interface RegistryListResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

// =============================================================================
// 3. State Machine Helpers
// =============================================================================

/**
 * Determine whether a status transition is legal.
 * D4: directory status machine — only specified transitions allowed.
 */
export function isValidStatusTransition(
  from: RegistryReleaseStatus,
  to: RegistryReleaseStatus,
): boolean {
  return REGISTRY_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Get all legal target statuses from a given status.
 */
export function legalTransitionsFrom(
  from: RegistryReleaseStatus,
): readonly RegistryReleaseStatus[] {
  return REGISTRY_STATUS_TRANSITIONS[from]
}

/**
 * Determine whether a status is a terminal state (no outgoing transitions).
 */
export function isTerminalStatus(status: RegistryReleaseStatus): boolean {
  return REGISTRY_STATUS_TRANSITIONS[status].length === 0
}

/**
 * Determine whether a release status allows discovery/resolution.
 * D7: only 'approved' participates in default resolution.
 */
export function isDiscoverable(status: RegistryReleaseStatus): boolean {
  return status === 'approved'
}

/**
 * Determine whether a release can be an installation candidate.
 * D7: excluded statuses for installation.
 */
export function isInstallationCandidate(status: RegistryReleaseStatus): boolean {
  return status === 'approved' || status === 'deprecated'
}

// =============================================================================
// 4. Canonical Serialization & Hash Helpers
// =============================================================================

/**
 * Stable serialization for deterministic hashing.
 * Sorts object keys alphabetically; arrays preserve order.
 */
export function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = (val as Record<string, unknown>)[key]
          return sorted
        }, {})
    }
    return val
  })
}

/**
 * FNV-1a 32-bit hash (deterministic, fast).
 */
export function fnv1a32(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Compute source hash from deterministic serialization.
 */
export function computeRegistrySourceHash(data: unknown): string {
  return fnv1a32(stableSerialize(data))
}

/**
 * Generate a stable release ID from org + pluginId + version.
 */
export function makeReleaseStableId(
  organizationId: string,
  pluginIdentity: string,
  version: string,
): string {
  return fnv1a32(`${organizationId}:${pluginIdentity}:${version}`)
}

/**
 * Generate a preview handle (stable, one-time use).
 */
export function makePreviewHandle(
  organizationId: string,
  action: RegistryCommandAction,
  targetReleaseId: string,
  stateVersion: number,
  createdAt: string,
): string {
  return fnv1a32(`${organizationId}:${action}:${targetReleaseId}:${stateVersion}:${createdAt}`)
}

/**
 * Semantic version comparison (returns -1, 0, or 1).
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

/**
 * Validate semantic version format (MAJOR.MINOR.PATCH, no pre-release).
 */
export function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version)
}

// =============================================================================
// 5. Low-Sensitive Sanitization
// =============================================================================

/** Keys that must be stripped or redacted in output. */
const SENSITIVE_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private.key/i,
  /private-key/i,
]

/** Value patterns that indicate sensitive content. */
const SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)(?:sk|pk|tk)_[A-Za-z0-9]{20,}/,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._\-]+/,
  /(?:^|\s)(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
]

/**
 * Check if a key name is sensitive (registry-specific variant).
 */
export function isRegistrySensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key))
}

/**
 * Check if a value contains sensitive patterns (registry-specific variant).
 */
export function containsRegistrySensitiveValue(value: string): boolean {
  return SENSITIVE_VALUE_PATTERNS.some((p) => p.test(value))
}

/**
 * Sanitize an object for low-sensitive output.
 * Strips sensitive keys and redacts sensitive values.
 */
export function sanitizeForAudit<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (isRegistrySensitiveKey(key)) {
      continue // strip entire key
    }
    if (typeof value === 'string' && containsRegistrySensitiveValue(value)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeForAudit(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result as Partial<T>
}

/**
 * Sanitize an error response for non-leak output.
 * Returns only code + sanitized message; no stack, no internal details.
 */
export function sanitizeErrorResponse(
  code: RegistryErrorCode,
  message: string,
): { error: { code: RegistryErrorCode; message: string } } {
  return {
    error: {
      code,
      message: containsRegistrySensitiveValue(message) ? '[REDACTED]' : message,
    },
  }
}

/**
 * Create a low-sensitive audit event object.
 */
export interface RegistryAuditEvent {
  /** Organization-scoped reference hash (not raw ID). */
  orgRefHash: string
  /** Plugin identity hash. */
  pluginIdentityHash: string
  /** Version (low-sensitive). */
  version: string
  /** Action. */
  action: RegistryCommandAction | 'rollback'
  /** Result/reason code. */
  reasonCode: RegistryReasonCode
  /** Actor reference hash. */
  actorRefHash: string
  /** Correlation ID for traceability. */
  correlationId: string
}

// =============================================================================
// 6. Type Guards
// =============================================================================

export function isRegistryReleaseStatus(s: string): s is RegistryReleaseStatus {
  return (REGISTRY_RELEASE_STATUSES as readonly string[]).includes(s)
}

export function isRegistryCommandAction(a: string): a is RegistryCommandAction {
  return (REGISTRY_COMMAND_ACTIONS as readonly string[]).includes(a)
}

export function isRegistryOperationStatus(s: string): s is RegistryOperationStatus {
  return (REGISTRY_OPERATION_STATUSES as readonly string[]).includes(s)
}

export function isRegistryErrorCode(c: string): c is RegistryErrorCode {
  return (REGISTRY_ERROR_CODES as readonly string[]).includes(c)
}

export function isRegistryPermission(p: string): p is RegistryPermission {
  return (REGISTRY_PERMISSIONS as readonly string[]).includes(p)
}

// =============================================================================
// 7. Maker-Checker Helpers
// =============================================================================

/**
 * Check whether the actor is allowed to perform the action on the target.
 * D6: approve/reject/rollback require different actor than submitter.
 * Returns null if allowed, or error code if denied.
 */
export function checkMakerChecker(
  action: RegistryCommandAction,
  submitterRef: string,
  reviewerRef: string,
): RegistryErrorCode | null {
  if (
    (action === 'approve' || action === 'reject' || action === 'rollback') &&
    submitterRef === reviewerRef
  ) {
    return 'registry-maker-checker-violation'
  }
  return null
}

// =============================================================================
// 8. Version Resolution Helpers
// =============================================================================

/**
 * Check whether a release is compatible with given host/seam requirements.
 * Simplified deterministic check (no external calls).
 */
export function isReleaseCompatible(
  releaseHostVersion: string,
  requiredHostVersion: string,
): boolean {
  // Host version must be >= required version
  return compareSemver(releaseHostVersion, requiredHostVersion) >= 0
}

/**
 * Filter and sort candidate releases for version resolution.
 * D7: approved only for default; deprecated requires explicit pin.
 */
export function resolveCandidates(
  releases: PrivateRegistryRelease[],
  opts: { includeDeprecated?: boolean } = {},
): PrivateRegistryRelease[] {
  return releases
    .filter((r) => {
      if (r.status === 'approved') return true
      if (r.status === 'deprecated' && opts.includeDeprecated) return true
      return false
    })
    .sort((a, b) => {
      const vc = compareSemver(b.version, a.version)
      if (vc !== 0) return vc
      // Stable tiebreak by ID
      return a.id.localeCompare(b.id)
    })
}

// =============================================================================
// 9. Fixture Constants
// =============================================================================

/** Test organization IDs. */
export const TEST_ORG_A = 'org-test-a'
export const TEST_ORG_B = 'org-test-b'

/** Test actor reference hashes. */
export const TEST_ACTOR_ADMIN_A = 'actor-admin-a'
export const TEST_ACTOR_ADMIN_B = 'actor-admin-b'
export const TEST_ACTOR_MEMBER_A = 'actor-member-a'
export const TEST_ACTOR_REVIEWER_B = 'actor-reviewer-b'
