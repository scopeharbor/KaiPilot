/**
 * OCR Result Persistence And Retention — 测试夹具构建器
 *
 * 提供保留策略、job/candidate 记录、accepted extraction、cleanup preview/result、
 * hold 与 tombstone 的确定性夹具。默认测试不调用真实 OCR provider。
 */

import {
  buildSystemDefaultCategoryPolicies,
  computeCleanupPreviewHash,
  computeRetentionPolicyHash,
  computeTombstoneHash,
  type OcrCleanupPreviewItem,
  type OcrCleanupPreviewResponse,
  type OcrCleanupResultDTO,
  type OcrRetentionCategoryPolicy,
  type OcrRetentionHoldDTO,
  type OcrRetentionPolicy,
  type OcrRetentionRecordSummary,
  type OcrRetentionTombstoneDTO,
  type OcrAcceptedExtractionRetentionSummary,
} from './ocr-result-retention.js'

const FIXED_NOW = '2026-08-02T00:00:00.000Z'

// ─── 策略 ──────────────────────────────────────────────────────────────────

export function buildRetentionCategoryPolicies(
  overrides: Partial<OcrRetentionCategoryPolicy> = {},
): OcrRetentionCategoryPolicy[] {
  return buildSystemDefaultCategoryPolicies().map((c) => ({ ...c, ...overrides }))
}

export function buildRetentionPolicy(
  overrides: Partial<OcrRetentionPolicy> = {},
): OcrRetentionPolicy {
  const organizationId = overrides.organizationId ?? 1
  const projectId = overrides.projectId === undefined ? 10 : overrides.projectId
  const categories = overrides.categories ?? buildSystemDefaultCategoryPolicies()
  return {
    source: 'system',
    organizationId,
    projectId,
    categories,
    bounds: { minDays: 1, maxDays: 3650 },
    policyHash: computeRetentionPolicyHash({ organizationId, projectId, categories }),
    ...overrides,
  }
}

export function buildProjectOverridePolicy(
  overrides: Partial<OcrRetentionPolicy> = {},
): OcrRetentionPolicy {
  const base = buildRetentionPolicy(overrides)
  return {
    ...base,
    source: 'project',
    categories: base.categories.map((c) =>
      c.category === 'candidate_text' ? { ...c, retentionDays: 14 } : c,
    ),
    ...overrides,
    policyHash: computeRetentionPolicyHash({
      organizationId: overrides.organizationId ?? 1,
      projectId: overrides.projectId === undefined ? 10 : overrides.projectId,
      categories:
        overrides.categories ??
        base.categories.map((c) =>
          c.category === 'candidate_text' ? { ...c, retentionDays: 14 } : c,
        ),
    }),
  }
}

// ─── 记录摘要 ──────────────────────────────────────────────────────────────

export function buildRetentionRecordSummary(
  overrides: Partial<OcrRetentionRecordSummary> = {},
): OcrRetentionRecordSummary {
  return {
    recordKind: 'candidate',
    recordId: 101,
    lifecycleState: 'reviewable',
    sensitivityCategory: 'candidate_text',
    sourceKind: 'attachment',
    sourceHash: 'src_hash_001',
    contentHash: 'cand_hash_001',
    retentionDeadline: '2026-09-01T00:00:00.000Z',
    blockedReason: null,
    holdActive: false,
    textAvailable: true,
    ...overrides,
  }
}

export function buildHeldRecordSummary(
  overrides: Partial<OcrRetentionRecordSummary> = {},
): OcrRetentionRecordSummary {
  return buildRetentionRecordSummary({
    lifecycleState: 'hold_blocked',
    blockedReason: 'hold_active',
    holdActive: true,
    ...overrides,
  })
}

export function buildPurgedRecordSummary(
  overrides: Partial<OcrRetentionRecordSummary> = {},
): OcrRetentionRecordSummary {
  return buildRetentionRecordSummary({
    lifecycleState: 'purged',
    blockedReason: 'already_terminal',
    textAvailable: false,
    ...overrides,
  })
}

// ─── accepted extraction 保留摘要 ──────────────────────────────────────────

export function buildAcceptedExtractionRetentionSummary(
  overrides: Partial<OcrAcceptedExtractionRetentionSummary> = {},
): OcrAcceptedExtractionRetentionSummary {
  return {
    extractionId: 501,
    lifecycleState: 'accepted',
    status: 'current',
    sourceHash: 'src_hash_001',
    candidateHash: 'cand_hash_001',
    selectedTextHash: 'sel_hash_001',
    reviewerId: 7,
    pageRefs: [1, 2],
    retentionDeadline: '2027-08-02T00:00:00.000Z',
    holdActive: false,
    textAvailable: true,
    tombstoneId: null,
    confirmedAt: FIXED_NOW,
    supersededAt: null,
    ...overrides,
  }
}

// ─── cleanup preview / result ──────────────────────────────────────────────

export function buildCleanupPreviewItem(
  overrides: Partial<OcrCleanupPreviewItem> = {},
): OcrCleanupPreviewItem {
  return {
    recordKind: 'candidate',
    recordId: 101,
    lifecycleState: 'expired',
    plannedAction: 'purge',
    blockedReason: null,
    contentHash: 'cand_hash_001',
    sourceHash: 'src_hash_001',
    ...overrides,
  }
}

export function buildCleanupPreviewResponse(
  overrides: Partial<OcrCleanupPreviewResponse> = {},
): OcrCleanupPreviewResponse {
  const eligible = overrides.eligible ?? [buildCleanupPreviewItem()]
  const policyHash = overrides.policyHash ?? buildRetentionPolicy().policyHash
  return {
    previewHash: computeCleanupPreviewHash({
      organizationId: 1,
      projectId: 10,
      policyHash,
      recordFingerprints: eligible.map((e) => `${e.recordKind}:${e.recordId}`),
      nowIso: FIXED_NOW,
    }),
    policyHash,
    generatedAt: FIXED_NOW,
    eligible,
    blocked: overrides.blocked ?? [],
    plannedTombstones: eligible.filter((e) => e.plannedAction === 'purge').length,
    policyEvidence: { source: 'system', bounds: { minDays: 1, maxDays: 3650 } },
    truncated: false,
    requiresExplicitConfirmation: true,
    ...overrides,
  }
}

export function buildCleanupResult(
  overrides: Partial<OcrCleanupResultDTO> = {},
): OcrCleanupResultDTO {
  return {
    runId: 9001,
    runKey: 'run-key-0001',
    status: 'completed',
    previewHash: buildCleanupPreviewResponse().previewHash,
    policyHash: buildRetentionPolicy().policyHash,
    expiredCount: 1,
    redactedCount: 0,
    purgedCount: 1,
    tombstoneCount: 1,
    blockedCount: 0,
    replayed: false,
    startedAt: FIXED_NOW,
    completedAt: FIXED_NOW,
    failureReason: null,
    ...overrides,
  }
}

// ─── hold ──────────────────────────────────────────────────────────────────

export function buildRetentionHold(
  overrides: Partial<OcrRetentionHoldDTO> = {},
): OcrRetentionHoldDTO {
  return {
    holdId: 3001,
    organizationId: 1,
    projectId: 10,
    scopeKind: 'job',
    scopeHash: 'scope_hash_001',
    reasonCode: 'review_in_progress',
    note: '人工审查进行中',
    status: 'active',
    setBy: 7,
    setAt: FIXED_NOW,
    releasedBy: null,
    releasedAt: null,
    ...overrides,
  }
}

export function buildReleasedHold(
  overrides: Partial<OcrRetentionHoldDTO> = {},
): OcrRetentionHoldDTO {
  return buildRetentionHold({
    status: 'released',
    releasedBy: 7,
    releasedAt: FIXED_NOW,
    ...overrides,
  })
}

// ─── tombstone ─────────────────────────────────────────────────────────────

export function buildRetentionTombstone(
  overrides: Partial<OcrRetentionTombstoneDTO> = {},
): OcrRetentionTombstoneDTO {
  const base = {
    tombstoneId: 7001,
    organizationId: 1,
    projectId: 10,
    recordKind: 'candidate' as const,
    recordId: 101,
    sourceKind: 'attachment',
    sourceHash: 'src_hash_001',
    contentHash: 'cand_hash_001',
    lifecycleAction: 'purge' as const,
    cleanupReason: 'retention_expired',
    policyHash: buildRetentionPolicy().policyHash,
    cleanupRunId: 9001,
    createdAt: FIXED_NOW,
  }
  return {
    ...base,
    tombstoneHash: computeTombstoneHash({
      recordKind: base.recordKind,
      recordId: base.recordId,
      cleanupReason: base.cleanupReason,
      policyHash: base.policyHash,
      purgedAtIso: base.createdAt,
    }),
    ...overrides,
  }
}
