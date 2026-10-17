/**
 * v3-enterprise-audit-enhancement — 企业审计增强测试夹具（前后端共享）。
 *
 * 提供 scoped 过滤、审计行摘要、预览、manifest、ledger 条目、校验结果、
 * 保留摘要与异常摘要的构造器。
 */

import type {
  EnterpriseAuditScopeFilter,
  EnterpriseAuditScope,
  EvidencePackagePreview,
  EvidencePackageLedgerEntry,
  EvidencePackageManifest,
  EvidencePackageStatus,
  VerificationResult,
  VerificationStatus,
  RetentionSummary,
  AnomalySummary,
  AnomalySummaryItem,
  AnomalyCategory,
  EvidenceWarningCode,
  VerificationWarningCode,
  RetentionWarningCode,
} from './enterprise-audit-enhancement.js'
import { computeStableSignature, fnv1aHash } from './enterprise-audit-enhancement.js'

// ─── 构造器 ─────────────────────────────────────────────────────────────────────

export function buildScopeFilter(
  overrides?: Partial<EnterpriseAuditScopeFilter>,
): EnterpriseAuditScopeFilter {
  return {
    organizationId: 1,
    projectId: null,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    event: null,
    action: null,
    severity: null,
    cursor: null,
    perPage: null,
    ...overrides,
  }
}

export function buildScope(overrides?: Partial<EnterpriseAuditScope>): EnterpriseAuditScope {
  const base: EnterpriseAuditScope = {
    organizationId: 1,
    projectId: null,
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    filterHash: 'a1b2c3d4',
    ...overrides,
  }
  if (!overrides?.filterHash) {
    base.filterHash = computeStableSignature({
      orgId: base.organizationId,
      dateFrom: base.dateFrom,
      dateTo: base.dateTo,
    })
  }
  return base
}

export function buildWarning(
  overrides?: Partial<{ code: EvidenceWarningCode; message: string; severity: string }>,
): { code: EvidenceWarningCode; message: string; severity: string } {
  return {
    code: 'LARGE_RESULT_SET',
    message: '结果集较大，请确认需要导出',
    severity: 'warning',
    ...overrides,
  }
}

export function buildRedactedDigest(index = 0): string {
  return fnv1aHash(`record:${index}:2026-07-${10 + index}T10:00:00`)
}

export function buildEvidencePackagePreview(
  overrides?: Partial<EvidencePackagePreview>,
): EvidencePackagePreview {
  const scope = overrides?.scope ?? buildScope()
  const estimatedRowCount = overrides?.estimatedRowCount ?? 42
  const baseSignature = computeStableSignature({
    orgId: scope.organizationId,
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    estimatedRowCount,
  })
  const redactedDigests = overrides?.redactedDigests ?? [
    buildRedactedDigest(0),
    buildRedactedDigest(1),
  ]
  const packageHash = overrides?.packageHash ?? fnv1aHash(baseSignature + redactedDigests.join(''))

  return {
    scope,
    estimatedRowCount,
    sourceSignature: baseSignature,
    packageHash,
    warnings: [buildWarning()],
    requiresConfirmation: true,
    redactedDigests,
  }
}

export function buildEvidencePackageLedgerEntry(
  overrides?: Partial<EvidencePackageLedgerEntry>,
): EvidencePackageLedgerEntry {
  const now = new Date().toISOString()
  const scope = overrides?.scope ?? buildScope()
  const filterSummaryJson = overrides?.filterSummaryJson ?? JSON.stringify(scope)
  const sourceSignature =
    overrides?.sourceSignature ??
    computeStableSignature({
      orgId: scope.organizationId,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
    })
  const packageHash = overrides?.packageHash ?? fnv1aHash(sourceSignature)

  return {
    id: 1,
    organizationId: scope.organizationId,
    actorId: 1,
    scope,
    filterSummaryJson,
    sourceSignature,
    packageHash,
    status: 'confirmed',
    rowCount: 42,
    warningSummaryJson: null,
    fileRef: null,
    expiresAt: new Date(Date.now() + 86400000 * 365).toISOString(),
    createdAt: now,
    confirmedAt: now,
    ...overrides,
  }
}

export function buildEvidencePackageLedgerEntryWithStatus(
  status: EvidencePackageStatus,
  overrides?: Partial<EvidencePackageLedgerEntry>,
): EvidencePackageLedgerEntry {
  return buildEvidencePackageLedgerEntry({ ...overrides, status })
}

export function buildEvidencePackageManifest(
  overrides?: Partial<EvidencePackageManifest>,
): EvidencePackageManifest {
  const scope = overrides?.scope ?? buildScope()
  const recordDigests = overrides?.recordDigests ?? [buildRedactedDigest(0), buildRedactedDigest(1)]
  const digestOfDigests = overrides?.digestOfDigests ?? fnv1aHash(recordDigests.sort().join(''))

  return {
    packageId: 1,
    scope,
    rowCount: 42,
    actionDistribution: { create: 20, update: 15, delete: 7 },
    severityDistribution: { info: 30, warning: 8, error: 3, critical: 1 },
    recordDigests,
    digestOfDigests,
    warnings: [buildWarning()],
    generatedBy: { userId: 1 },
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildVerificationWarning(
  overrides?: Partial<{
    code: VerificationWarningCode
    message: string
    severity: string
    affectedRef?: string
  }>,
): { code: VerificationWarningCode; message: string; severity: string; affectedRef?: string } {
  return {
    code: 'MISSING_REQUEST_CONTEXT',
    message: '部分记录缺少请求上下文',
    severity: 'warning',
    ...overrides,
  }
}

export function buildVerificationResult(
  overrides?: Partial<VerificationResult>,
): VerificationResult {
  return {
    id: 1,
    organizationId: 1,
    scope: buildScope(),
    evidencePackageId: null,
    digest: 'abc123def456',
    status: 'passed',
    verifiedRowCount: 42,
    warnings: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildVerificationResultWithStatus(
  status: VerificationStatus,
  overrides?: Partial<VerificationResult>,
): VerificationResult {
  return buildVerificationResult({ ...overrides, status })
}

export function buildRetentionWarning(
  overrides?: Partial<{ code: RetentionWarningCode; message: string; severity: string }>,
): { code: RetentionWarningCode; message: string; severity: string } {
  return {
    code: 'NO_RETENTION_POLICY_CONFIGURED',
    message: '未配置保留策略',
    severity: 'warning',
    ...overrides,
  }
}

export function buildRetentionSummary(overrides?: Partial<RetentionSummary>): RetentionSummary {
  return {
    policy: {
      maxDays: 365,
      freezeUntil: null,
      description: '默认保留策略',
    },
    eligibleRange: { dateFrom: '2025-08-01', dateTo: '2026-08-01' },
    warnings: [buildRetentionWarning()],
    nextReviewDate: '2026-09-01',
    ...overrides,
  }
}

export function buildAnomalyItem(overrides?: Partial<AnomalySummaryItem>): AnomalySummaryItem {
  return {
    category: 'permission_denied_burst',
    count: 15,
    severity: 'critical',
    timeBucket: '2026-07-15T14:00:00',
    evidenceRefs: [
      { auditLogId: 101, event: 'PERMISSION_DENIED', occurredAt: '2026-07-15T14:01:00' },
    ],
    ...overrides,
  }
}

export function buildAnomalySummary(overrides?: Partial<AnomalySummary>): AnomalySummary {
  return {
    items: [buildAnomalyItem()],
    totalCount: 15,
    scopedDateFrom: '2026-07-01',
    scopedDateTo: '2026-07-31',
    ...overrides,
  }
}

// ─── 大范围 fixture ────────────────────────────────────────────────────────────

/**
 * 构建大范围审计行摘要列表（用于性能测试）。
 */
export function buildLargeRecordDigestSet(count: number): string[] {
  const digests: string[] = []
  for (let i = 0; i < count; i++) {
    digests.push(buildRedactedDigest(i))
  }
  return digests
}

/**
 * 构建大范围异常分桶 fixture（用于异常分桶测试）。
 */
export function buildLargeAnomalySet(category: AnomalyCategory, count: number): AnomalySummary {
  const items: AnomalySummaryItem[] = []
  for (let i = 0; i < count; i++) {
    items.push(
      buildAnomalyItem({
        category,
        count: 1,
        timeBucket: `2026-07-${String(15 + i).padStart(2, '0')}T00:00:00`,
        evidenceRefs: [
          {
            auditLogId: 100 + i,
            event: 'PERMISSION_DENIED',
            occurredAt: `2026-07-15T${String(10 + i).padStart(2, '0')}:00:00`,
          },
        ],
      }),
    )
  }
  return buildAnomalySummary({ items, totalCount: count })
}

/**
 * 构建有界证据包摘要集合（用于有界范围测试）。
 */
export function buildBoundedDigestSet(count: number): string[] {
  const digests: string[] = []
  for (let i = 0; i < Math.min(count, 100); i++) {
    digests.push(buildRedactedDigest(i))
  }
  return digests
}
