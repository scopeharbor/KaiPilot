/**
 * plugin-private-registry-lifecycle-fixtures —— 两组织、多版本、多状态的本机 fixture pack
 * （零网络/零真实第三方安装/provider 调用）。
 *
 * 覆盖两组织同名 identity、多版本、deprecated/withdrawn、stale/replay、
 * maker-checker、回滚成功/失败/degraded 场景。
 */

import {
  type PrivateRegistryEntry,
  type PrivateRegistryRelease,
  type PrivateRegistryReview,
  type PrivateRegistryOperation,
  type PrivateRegistryCommandPreview,
  TEST_ORG_A,
  TEST_ORG_B,
} from './plugin-private-registry-lifecycle.js'

// =============================================================================
// 1. Organization Fixtures
// =============================================================================

export const FIXTURE_ORG_A = TEST_ORG_A
export const FIXTURE_ORG_B = TEST_ORG_B

// =============================================================================
// 2. Entry Fixtures
// =============================================================================

/** Org A — plugin "org-a.logger" with recommended v2.0.0. */
export const ENTRY_LOGGER_V2: PrivateRegistryEntry = {
  id: 'entry-logger-v2',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  pluginName: 'Logger Plugin',
  recommendedReleaseId: 'release-logger-v2',
  recommendedVersion: '2.0.0',
  rowVersion: 3,
  createdAt: '2026-08-16T10:00:00Z',
  updatedAt: '2026-08-16T12:00:00Z',
}

/** Org A — plugin "org-a.logger" with no recommended version (withdrawn). */
export const ENTRY_LOGGER_WITHDRAWN: PrivateRegistryEntry = {
  id: 'entry-logger-withdrawn',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  pluginName: 'Logger Plugin',
  recommendedReleaseId: null,
  recommendedVersion: null,
  rowVersion: 5,
  createdAt: '2026-08-16T10:00:00Z',
  updatedAt: '2026-08-16T14:00:00Z',
}

/** Org B — same plugin identity "org-a.logger" (cross-org same name). */
export const ENTRY_LOGGER_ORG_B: PrivateRegistryEntry = {
  id: 'entry-logger-org-b',
  organizationId: FIXTURE_ORG_B,
  pluginIdentity: 'org-a.logger',
  pluginName: 'Logger Plugin (Org B)',
  recommendedReleaseId: 'release-logger-v1-org-b',
  recommendedVersion: '1.0.0',
  rowVersion: 1,
  createdAt: '2026-08-16T11:00:00Z',
  updatedAt: '2026-08-16T11:00:00Z',
}

/** Org A — plugin "org-a.formatter" with deprecated v1.0.0. */
export const ENTRY_FORMATTER_DEPRECATED: PrivateRegistryEntry = {
  id: 'entry-formatter-deprecated',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.formatter',
  pluginName: 'Formatter Plugin',
  recommendedReleaseId: null,
  recommendedVersion: null,
  rowVersion: 2,
  createdAt: '2026-08-16T09:00:00Z',
  updatedAt: '2026-08-16T13:00:00Z',
}

// =============================================================================
// 3. Release Fixtures
// =============================================================================

/** Org A — logger v1.0.0 (approved). */
export const RELEASE_LOGGER_V1: PrivateRegistryRelease = {
  id: 'release-logger-v1',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  version: '1.0.0',
  packageDigest: 'sha256:aaa111',
  manifestDigest: 'sha256:bbb222',
  compatibilityDigest: 'sha256:ccc333',
  upstreamReceiptRef: 'receipt-hash-1',
  status: 'approved',
  metadata: '{"description":"Initial release"}',
  rowVersion: 2,
  createdAt: '2026-08-16T10:00:00Z',
  updatedAt: '2026-08-16T10:30:00Z',
}

/** Org A — logger v2.0.0 (approved, recommended). */
export const RELEASE_LOGGER_V2: PrivateRegistryRelease = {
  id: 'release-logger-v2',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  version: '2.0.0',
  packageDigest: 'sha256:ddd444',
  manifestDigest: 'sha256:eee555',
  compatibilityDigest: 'sha256:fff666',
  upstreamReceiptRef: 'receipt-hash-2',
  status: 'approved',
  metadata: '{"description":"Major upgrade"}',
  rowVersion: 1,
  createdAt: '2026-08-16T11:00:00Z',
  updatedAt: '2026-08-16T12:00:00Z',
}

/** Org A — logger v3.0.0 (draft, pending review). */
export const RELEASE_LOGGER_V3_DRAFT: PrivateRegistryRelease = {
  id: 'release-logger-v3-draft',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  version: '3.0.0',
  packageDigest: 'sha256:ggg777',
  manifestDigest: 'sha256:hhh888',
  compatibilityDigest: 'sha256:iii999',
  upstreamReceiptRef: 'receipt-hash-3',
  status: 'draft',
  metadata: null,
  rowVersion: 1,
  createdAt: '2026-08-16T13:00:00Z',
  updatedAt: '2026-08-16T13:00:00Z',
}

/** Org A — logger v2.5.0 (pending_review). */
export const RELEASE_LOGGER_V2_5: PrivateRegistryRelease = {
  id: 'release-logger-v25',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  version: '2.5.0',
  packageDigest: 'sha256:jjj000',
  manifestDigest: 'sha256:kkk111',
  compatibilityDigest: 'sha256:lll222',
  upstreamReceiptRef: 'receipt-hash-25',
  status: 'pending_review',
  metadata: null,
  rowVersion: 1,
  createdAt: '2026-08-16T12:30:00Z',
  updatedAt: '2026-08-16T12:30:00Z',
}

/** Org A — formatter v1.0.0 (deprecated). */
export const RELEASE_FORMATTER_V1_DEPRECATED: PrivateRegistryRelease = {
  id: 'release-formatter-v1-dep',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.formatter',
  version: '1.0.0',
  packageDigest: 'sha256:mmm333',
  manifestDigest: 'sha256:nnn444',
  compatibilityDigest: 'sha256:ooo555',
  upstreamReceiptRef: 'receipt-hash-f1',
  status: 'deprecated',
  metadata: null,
  rowVersion: 2,
  createdAt: '2026-08-16T09:00:00Z',
  updatedAt: '2026-08-16T13:00:00Z',
}

/** Org A — logger v0.9.0 (withdrawn). */
export const RELEASE_LOGGER_V0_9_WITHDRAWN: PrivateRegistryRelease = {
  id: 'release-logger-v09-withdrawn',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  version: '0.9.0',
  packageDigest: 'sha256:ppp666',
  manifestDigest: 'sha256:qqq777',
  compatibilityDigest: 'sha256:rrr888',
  upstreamReceiptRef: 'receipt-hash-09',
  status: 'withdrawn',
  metadata: null,
  rowVersion: 3,
  createdAt: '2026-08-16T08:00:00Z',
  updatedAt: '2026-08-16T14:00:00Z',
}

/** Org B — logger v1.0.0 (approved, cross-org same name). */
export const RELEASE_LOGGER_V1_ORG_B: PrivateRegistryRelease = {
  id: 'release-logger-v1-org-b',
  organizationId: FIXTURE_ORG_B,
  pluginIdentity: 'org-a.logger',
  version: '1.0.0',
  packageDigest: 'sha256:sss999',
  manifestDigest: 'sha256:ttt000',
  compatibilityDigest: 'sha256:uuu111',
  upstreamReceiptRef: 'receipt-hash-b1',
  status: 'approved',
  metadata: null,
  rowVersion: 1,
  createdAt: '2026-08-16T11:00:00Z',
  updatedAt: '2026-08-16T11:00:00Z',
}

/** Org A — logger v2.1.0 (rejected). */
export const RELEASE_LOGGER_V2_1_REJECTED: PrivateRegistryRelease = {
  id: 'release-logger-v21-rejected',
  organizationId: FIXTURE_ORG_A,
  pluginIdentity: 'org-a.logger',
  version: '2.1.0',
  packageDigest: 'sha256:vvv222',
  manifestDigest: 'sha256:www333',
  compatibilityDigest: 'sha256:xxx444',
  upstreamReceiptRef: 'receipt-hash-21',
  status: 'rejected',
  metadata: null,
  rowVersion: 1,
  createdAt: '2026-08-16T11:30:00Z',
  updatedAt: '2026-08-16T12:00:00Z',
}

// =============================================================================
// 4. Review Fixtures (Maker-Checker)
// =============================================================================

/** Review cycle 1 for logger v2.0.0 — approved by independent reviewer. */
export const REVIEW_LOGGER_V2_CYCLE1: PrivateRegistryReview = {
  id: 'review-logger-v2-c1',
  releaseId: 'release-logger-v2',
  organizationId: FIXTURE_ORG_A,
  cycleNumber: 1,
  submitterRef: 'actor-member-a',
  reviewerRef: 'actor-admin-a',
  decision: 'approved',
  reasonCode: 'reason-status-transition',
  sourceHash: 'hash-preview-1',
  createdAt: '2026-08-16T11:00:00Z',
  resolvedAt: '2026-08-16T11:30:00Z',
}

/** Review cycle 1 for logger v2.5.0 — pending (no reviewer yet). */
export const REVIEW_LOGGER_V25_CYCLE1: PrivateRegistryReview = {
  id: 'review-logger-v25-c1',
  releaseId: 'release-logger-v25',
  organizationId: FIXTURE_ORG_A,
  cycleNumber: 1,
  submitterRef: 'actor-member-a',
  reviewerRef: null,
  decision: 'pending',
  reasonCode: null,
  sourceHash: 'hash-preview-2',
  createdAt: '2026-08-16T12:30:00Z',
  resolvedAt: null,
}

/** Maker-checker violation: submitter tries to approve own submission. */
export const REVIEW_MAKER_CHECKER_VIOLATION: PrivateRegistryReview = {
  id: 'review-violation',
  releaseId: 'release-logger-v25',
  organizationId: FIXTURE_ORG_A,
  cycleNumber: 1,
  submitterRef: 'actor-member-a',
  reviewerRef: 'actor-member-a', // SAME as submitter — violation
  decision: 'rejected',
  reasonCode: 'reason-maker-checker-violation',
  sourceHash: 'hash-preview-3',
  createdAt: '2026-08-16T12:35:00Z',
  resolvedAt: '2026-08-16T12:35:00Z',
}

// =============================================================================
// 5. Operation Fixtures
// =============================================================================

/** Successful rollback operation. */
export const OPERATION_ROLLBACK_SUCCESS: PrivateRegistryOperation = {
  id: 'op-rollback-success',
  organizationId: FIXTURE_ORG_A,
  operationType: 'rollback',
  idempotencyKey: 'idem-rollback-1',
  targetReleaseId: 'release-logger-v1',
  status: 'committed',
  previewSourceHash: 'hash-rollback-1',
  impactSummary: '{"instances":0}',
  errorCode: null,
  reasonCode: 'reason-rollback-success',
  createdAt: '2026-08-16T14:00:00Z',
  updatedAt: '2026-08-16T14:01:00Z',
}

/** Failed rollback operation. */
export const OPERATION_ROLLBACK_FAILED: PrivateRegistryOperation = {
  id: 'op-rollback-failed',
  organizationId: FIXTURE_ORG_A,
  operationType: 'rollback',
  idempotencyKey: 'idem-rollback-2',
  targetReleaseId: 'release-logger-v1',
  status: 'failed',
  previewSourceHash: 'hash-rollback-2',
  impactSummary: '{"instances":1,"failed":1}',
  errorCode: 'registry-rollback-partial-failure',
  reasonCode: 'reason-rollback-failure',
  createdAt: '2026-08-16T14:30:00Z',
  updatedAt: '2026-08-16T14:31:00Z',
}

/** Degraded rollback operation. */
export const OPERATION_ROLLBACK_DEGRADED: PrivateRegistryOperation = {
  id: 'op-rollback-degraded',
  organizationId: FIXTURE_ORG_A,
  operationType: 'rollback',
  idempotencyKey: 'idem-rollback-3',
  targetReleaseId: 'release-logger-v1',
  status: 'degraded',
  previewSourceHash: 'hash-rollback-3',
  impactSummary: '{"instances":2,"compensated":1,"failed":1}',
  errorCode: null,
  reasonCode: 'reason-rollback-degraded',
  createdAt: '2026-08-16T15:00:00Z',
  updatedAt: '2026-08-16T15:02:00Z',
}

/** Stale replay operation. */
export const OPERATION_REPLAY_STALE: PrivateRegistryOperation = {
  id: 'op-replay-stale',
  organizationId: FIXTURE_ORG_A,
  operationType: 'approve',
  idempotencyKey: 'idem-approve-replay',
  targetReleaseId: 'release-logger-v25',
  status: 'confirmed',
  previewSourceHash: 'hash-old-stale',
  impactSummary: null,
  errorCode: 'registry-preview-replayed',
  reasonCode: 'reason-replay-detected',
  createdAt: '2026-08-16T12:40:00Z',
  updatedAt: '2026-08-16T12:40:00Z',
}

// =============================================================================
// 6. Command Preview Fixtures
// =============================================================================

/** Valid preview for approve action. */
export const PREVIEW_APPROVE_VALID: PrivateRegistryCommandPreview = {
  handle: 'handle-approve-valid-1',
  organizationId: FIXTURE_ORG_A,
  actorRef: 'actor-admin-a',
  action: 'approve',
  targetReleaseId: 'release-logger-v25',
  stateVersion: 1,
  sourceHash: 'hash-preview-approve-1',
  diff: 'Status: pending_review → approved',
  impactSummary: ['Release will become discoverable', 'Recommended pointer unchanged'],
  ttlSeconds: 300,
  createdAt: '2026-08-16T12:30:00Z',
  expiresAt: '2026-08-16T12:35:00Z',
}

/** Expired preview. */
export const PREVIEW_APPROVE_EXPIRED: PrivateRegistryCommandPreview = {
  handle: 'handle-approve-expired',
  organizationId: FIXTURE_ORG_A,
  actorRef: 'actor-admin-a',
  action: 'approve',
  targetReleaseId: 'release-logger-v25',
  stateVersion: 1,
  sourceHash: 'hash-preview-expired',
  diff: 'Status: pending_review → approved',
  impactSummary: [],
  ttlSeconds: 0,
  createdAt: '2026-08-16T12:00:00Z',
  expiresAt: '2026-08-16T12:00:00Z', // already expired
}

/** Cross-org preview (wrong org). */
export const PREVIEW_CROSS_ORG: PrivateRegistryCommandPreview = {
  handle: 'handle-cross-org',
  organizationId: FIXTURE_ORG_B, // Org B, but target is Org A's release
  actorRef: 'actor-admin-b',
  action: 'approve',
  targetReleaseId: 'release-logger-v25',
  stateVersion: 1,
  sourceHash: 'hash-preview-cross-org',
  diff: 'Status: pending_review → approved',
  impactSummary: [],
  ttlSeconds: 300,
  createdAt: '2026-08-16T12:30:00Z',
  expiresAt: '2026-08-16T12:35:00Z',
}

/** Stale preview (state changed after preview). */
export const PREVIEW_STALE: PrivateRegistryCommandPreview = {
  handle: 'handle-stale',
  organizationId: FIXTURE_ORG_A,
  actorRef: 'actor-admin-a',
  action: 'approve',
  targetReleaseId: 'release-logger-v25',
  stateVersion: 0, // was 0, now 1
  sourceHash: 'hash-old',
  diff: 'Status: pending_review → approved',
  impactSummary: [],
  ttlSeconds: 300,
  createdAt: '2026-08-16T12:00:00Z',
  expiresAt: '2026-08-16T12:05:00Z',
}

// =============================================================================
// 7. Fixture Coverage Index
// =============================================================================

/**
 * Maps spec Requirements to fixture IDs for coverage tracking.
 * Each Requirement/Scenario maps to at least one fixture.
 */
export const FIXTURE_COVERAGE_INDEX: Record<string, string[]> = {
  // Requirement: 私有插件目录必须由平台核心按组织托管
  'req-org-hosted': ['entry-logger-v2', 'entry-logger-org-b'],
  'req-client-forgery': ['entry-logger-v2'],
  // Requirement: 私有 release 必须引用已验证且不可变的上游包
  'req-release-validated': ['release-logger-v2', 'release-logger-v1'],
  'req-digest-conflict': ['release-logger-v2', 'release-logger-v1'],
  'req-receipt-invalid': ['release-logger-v09-withdrawn'],
  // Requirement: 目录 release 必须遵循确定性审批状态机
  'req-legal-transition': ['release-logger-v3-draft', 'release-logger-v25'],
  'req-illegal-transition': ['release-logger-v09-withdrawn', 'release-logger-v21-rejected'],
  'req-status-not-install': ['release-logger-v2'],
  // Requirement: 批准与回滚必须实行职责分离
  'req-independent-reviewer': ['review-logger-v2-c1'],
  'req-self-approval': ['review-violation'],
  'req-membership-expired': ['review-logger-v25-c1'],
  // Requirement: 所有目录写操作必须经过预览与一次性显式确认
  'req-valid-handle': ['preview-approve-valid-1'],
  'req-cross-org-handle': ['preview-cross-org'],
  'req-replay-handle': ['op-replay-stale'],
  'req-stale-handle': ['preview-stale', 'preview-approve-expired'],
  // Requirement: 组织内发现与版本解析必须确定且兼容
  'req-resolve-highest': ['release-logger-v2', 'release-logger-v1'],
  'req-exclude-deprecated': ['release-formatter-v1-dep'],
  'req-cross-org-same-name': ['release-logger-v1-org-b'],
  // Requirement: 撤回与恢复必须阻断不安全的新分发
  'req-withdraw-clears-pointer': ['release-logger-v09-withdrawn', 'entry-logger-withdrawn'],
  'req-withdraw-reject-direct-restore': ['release-logger-v09-withdrawn'],
  // Requirement: 回滚必须安全委托上游安装生命周期
  'req-rollback-pointer-only': ['operation-rollback-success'],
  'req-rollback-partial-failure': ['operation-rollback-failed'],
  'req-rollback-degraded': ['operation-rollback-degraded'],
  // Requirement: 生命周期必须产生低敏且可关联的可信审计
  'req-audit-success': ['review-logger-v2-c1'],
  'req-audit-rejection': ['review-violation'],
  // Requirement: 私有目录必须保持本机优先并与公开生态分层
  'req-no-external-infra': ['entry-logger-v2'],
  'req-no-remote-registry': ['entry-logger-v2'],
}

// =============================================================================
// 8. All Fixtures Array (for iteration)
// =============================================================================

export const ALL_ENTRIES: readonly PrivateRegistryEntry[] = [
  ENTRY_LOGGER_V2,
  ENTRY_LOGGER_WITHDRAWN,
  ENTRY_LOGGER_ORG_B,
  ENTRY_FORMATTER_DEPRECATED,
]

export const ALL_RELEASES: readonly PrivateRegistryRelease[] = [
  RELEASE_LOGGER_V1,
  RELEASE_LOGGER_V2,
  RELEASE_LOGGER_V3_DRAFT,
  RELEASE_LOGGER_V2_5,
  RELEASE_FORMATTER_V1_DEPRECATED,
  RELEASE_LOGGER_V0_9_WITHDRAWN,
  RELEASE_LOGGER_V1_ORG_B,
  RELEASE_LOGGER_V2_1_REJECTED,
]

export const ALL_REVIEWS: readonly PrivateRegistryReview[] = [
  REVIEW_LOGGER_V2_CYCLE1,
  REVIEW_LOGGER_V25_CYCLE1,
  REVIEW_MAKER_CHECKER_VIOLATION,
]

export const ALL_OPERATIONS: readonly PrivateRegistryOperation[] = [
  OPERATION_ROLLBACK_SUCCESS,
  OPERATION_ROLLBACK_FAILED,
  OPERATION_ROLLBACK_DEGRADED,
  OPERATION_REPLAY_STALE,
]

export const ALL_PREVIEWS: readonly PrivateRegistryCommandPreview[] = [
  PREVIEW_APPROVE_VALID,
  PREVIEW_APPROVE_EXPIRED,
  PREVIEW_CROSS_ORG,
  PREVIEW_STALE,
]
