/**
 * v3-copilot-web-search-tool — 外部检索 fixtures
 *
 * 覆盖五态：授权未开、域名放行、域名拒绝、超配额、部分失败。
 * 命名纪律：全部导出使用 CopilotWebSearch / copilotWebSearch 前缀。
 */

import type {
  RetrievalAuthorizationState,
  RetrievalDecisionRecord,
  RetrievalQueryCategory,
  RetrievalRejectionReason,
  RetrievalResultEntry,
  RetrievalResultSet,
  DomainPolicy,
  RetrievalQuotaPolicy,
  RetrievalQuotaResult,
} from './copilot-web-search.js'

// ---------------------------------------------------------------------------
// 辅助构造器
// ---------------------------------------------------------------------------

/** 构造授权状态（未授权）。 */
export function copilotWebSearchFixtureUnauthorized(
  organizationId: number = 1,
): RetrievalAuthorizationState {
  return {
    organizationId,
    authorized: false,
    authorizedByUserId: null,
    authorizedAt: null,
  }
}

/** 构造授权状态（已授权）。 */
export function copilotWebSearchFixtureAuthorized(
  organizationId: number = 1,
  userId: number = 10,
): RetrievalAuthorizationState {
  return {
    organizationId,
    authorized: true,
    authorizedByUserId: userId,
    authorizedAt: '2026-08-19T10:00:00Z',
  }
}

/** 构造结果条目（完整抓取）。 */
export function copilotWebSearchFixtureResultEntry(
  overrides: Partial<RetrievalResultEntry> = {},
): RetrievalResultEntry {
  return {
    url: 'https://example.com/article',
    title: '示例文章',
    snippet: '这是摘要',
    fetchedAt: '2026-08-19T10:00:01Z',
    snapshotHash: 'abc123',
    source: 'external',
    isComplete: true,
    ...overrides,
  }
}

/** 构造结果条目（抓取失败）。 */
export function copilotWebSearchFixtureFailedEntry(
  failureReason: RetrievalRejectionReason = 'fetch_timeout',
): RetrievalResultEntry {
  return copilotWebSearchFixtureResultEntry({
    url: 'https://example.com/timeout',
    title: '',
    snippet: '',
    isComplete: false,
    failureReason,
  })
}

/** 构造完整结果集。 */
export function copilotWebSearchFixtureResultSet(
  overrides: Partial<RetrievalResultSet> = {},
): RetrievalResultSet {
  return {
    entries: [
      copilotWebSearchFixtureResultEntry(),
      copilotWebSearchFixtureResultEntry({ url: 'https://example.com/article2', title: '第二篇' }),
    ],
    isComplete: true,
    rejectedDomainCount: 0,
    queryCategory: 'technical',
    elapsedMs: 500,
    ...overrides,
  }
}

/** 构造部分失败结果集。 */
export function copilotWebSearchFixturePartialResultSet(): RetrievalResultSet {
  return copilotWebSearchFixtureResultSet({
    entries: [
      copilotWebSearchFixtureResultEntry(),
      copilotWebSearchFixtureFailedEntry('fetch_timeout'),
    ],
    isComplete: false,
    rejectedDomainCount: 1,
  })
}

/** 构造域名策略（含白名单和黑名单）。 */
export function copilotWebSearchFixtureDomainPolicy(
  overrides: Partial<DomainPolicy> = {},
): DomainPolicy {
  return {
    organizationId: 1,
    allowlist: [
      { pattern: 'example.com', type: 'exact' },
      { pattern: '*.gov.cn', type: 'suffix_wildcard' },
    ],
    denylist: [{ pattern: 'blocked.example.com', type: 'exact' }],
    createdAt: '2026-08-19T10:00:00Z',
    updatedAt: '2026-08-19T10:00:00Z',
    ...overrides,
  }
}

/** 构造配额策略。 */
export function copilotWebSearchFixtureQuotaPolicy(
  overrides: Partial<RetrievalQuotaPolicy> = {},
): RetrievalQuotaPolicy {
  return {
    organizationId: 1,
    maxRetrievalsPerWindow: 10,
    windowMs: 60_000,
    ...overrides,
  }
}

/** 构造配额结果（允许）。 */
export function copilotWebSearchFixtureQuotaAllowed(
  currentCount: number = 3,
): RetrievalQuotaResult {
  return {
    allowed: true,
    currentCount,
    limit: 10,
    retryAfterSeconds: null,
  }
}

/** 构造配额结果（超配额）。 */
export function copilotWebSearchFixtureQuotaExhausted(): RetrievalQuotaResult {
  return {
    allowed: false,
    currentCount: 10,
    limit: 10,
    retryAfterSeconds: 45,
  }
}

/** 构造决策记录。 */
export function copilotWebSearchFixtureDecisionRecord(
  overrides: Partial<RetrievalDecisionRecord> = {},
): RetrievalDecisionRecord {
  return {
    id: 'ret_001',
    organizationId: 1,
    userId: 10,
    turnId: 'turn_001',
    queryCategory: 'technical',
    matchedDomains: ['example.com'],
    rejectedDomainCount: 0,
    rejectionReasonCounts: {
      authorization_gated: 0,
      domain_not_in_allowlist: 0,
      domain_in_denylist: 0,
      quota_exhausted: 0,
      fetch_timeout: 0,
      fetch_failed: 0,
    },
    elapsedMs: 500,
    resultCount: 2,
    isComplete: true,
    createdAt: '2026-08-19T10:00:02Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 授权未开态
// ---------------------------------------------------------------------------

/** 授权未开态的决策记录。 */
export const COPILOT_WEB_SEARCH_FIXTURE_DECISION_UNAUTHORIZED =
  copilotWebSearchFixtureDecisionRecord({
    id: 'ret_unauthorized',
    queryCategory: 'general',
    matchedDomains: [],
    rejectedDomainCount: 0,
    rejectionReasonCounts: {
      authorization_gated: 1,
      domain_not_in_allowlist: 0,
      domain_in_denylist: 0,
      quota_exhausted: 0,
      fetch_timeout: 0,
      fetch_failed: 0,
    },
    resultCount: 0,
    isComplete: false,
  })

// ---------------------------------------------------------------------------
// 域名拒绝态
// ---------------------------------------------------------------------------

/** 域名拒绝态的决策记录。 */
export const COPILOT_WEB_SEARCH_FIXTURE_DECISION_DOMAIN_REJECTED =
  copilotWebSearchFixtureDecisionRecord({
    id: 'ret_domain_rejected',
    queryCategory: 'vendor',
    matchedDomains: [],
    rejectedDomainCount: 3,
    rejectionReasonCounts: {
      authorization_gated: 0,
      domain_not_in_allowlist: 2,
      domain_in_denylist: 1,
      quota_exhausted: 0,
      fetch_timeout: 0,
      fetch_failed: 0,
    },
    resultCount: 0,
    isComplete: false,
  })

// ---------------------------------------------------------------------------
// 超配额态
// ---------------------------------------------------------------------------

/** 超配额态的决策记录。 */
export const COPILOT_WEB_SEARCH_FIXTURE_DECISION_QUOTA_EXHAUSTED =
  copilotWebSearchFixtureDecisionRecord({
    id: 'ret_quota_exhausted',
    queryCategory: 'technical',
    matchedDomains: ['example.com'],
    rejectedDomainCount: 0,
    rejectionReasonCounts: {
      authorization_gated: 0,
      domain_not_in_allowlist: 0,
      domain_in_denylist: 0,
      quota_exhausted: 1,
      fetch_timeout: 0,
      fetch_failed: 0,
    },
    resultCount: 0,
    isComplete: false,
  })

// ---------------------------------------------------------------------------
// 部分失败态
// ---------------------------------------------------------------------------

/** 部分失败态的决策记录。 */
export const COPILOT_WEB_SEARCH_FIXTURE_DECISION_PARTIAL_FAILURE =
  copilotWebSearchFixtureDecisionRecord({
    id: 'ret_partial_failure',
    queryCategory: 'regulatory',
    matchedDomains: ['example.com', 'other.com'],
    rejectedDomainCount: 0,
    rejectionReasonCounts: {
      authorization_gated: 0,
      domain_not_in_allowlist: 0,
      domain_in_denylist: 0,
      quota_exhausted: 0,
      fetch_timeout: 1,
      fetch_failed: 0,
    },
    resultCount: 1,
    isComplete: false,
    elapsedMs: 1200,
  })

// ---------------------------------------------------------------------------
// 域名放行态
// ---------------------------------------------------------------------------

/** 域名放行态的决策记录。 */
export const COPILOT_WEB_SEARCH_FIXTURE_DECISION_DOMAIN_ALLOWED =
  copilotWebSearchFixtureDecisionRecord({
    id: 'ret_domain_allowed',
    queryCategory: 'technical',
    matchedDomains: ['example.com', 'docs.example.com'],
    rejectedDomainCount: 0,
    rejectionReasonCounts: {
      authorization_gated: 0,
      domain_not_in_allowlist: 0,
      domain_in_denylist: 0,
      quota_exhausted: 0,
      fetch_timeout: 0,
      fetch_failed: 0,
    },
    resultCount: 2,
    isComplete: true,
  })

// ---------------------------------------------------------------------------
// 禁存验证辅助
// ---------------------------------------------------------------------------

/** 所有拒绝原因的全集。 */
export const ALL_RETRIEVAL_REJECTION_REASONS: readonly RetrievalRejectionReason[] = [
  'authorization_gated',
  'domain_not_in_allowlist',
  'domain_in_denylist',
  'quota_exhausted',
  'fetch_timeout',
  'fetch_failed',
] as const

/** 所有搜索词类别的全集。 */
export const ALL_RETRIEVAL_QUERY_CATEGORIES: readonly RetrievalQueryCategory[] = [
  'technical',
  'regulatory',
  'vendor',
  'general',
] as const
