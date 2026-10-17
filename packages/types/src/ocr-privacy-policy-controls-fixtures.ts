/**
 * OCR Privacy Policy Controls — 测试夹具构建器
 *
 * 提供系统默认策略、组织/项目覆盖策略、决策输入/输出、
 * 复制/导出预览/运行与脱敏摘要的确定性夹具。默认测试不调用真实 OCR provider。
 */

import {
  computePrivacyDecisionHash,
  computePrivacyPolicyHash,
  computePrivacyPreviewHash,
  resolveSystemDefaultCategoryRules,
  type OcrPrivacyPolicy,
  type OcrPrivacyPolicyOverrideRequest,
  type OcrPrivacyDecisionInput,
  type OcrPrivacyDecision,
  type OcrPrivacyCopyExportPreviewInput,
  type OcrPrivacyCopyExportPreviewResponse,
  type OcrPrivacyCopyExportExecuteInput,
  type OcrPrivacyCopyExportRun,
  type OcrPrivacyStatusSummary,
  type OcrPrivacyRedactionContext,
} from './ocr-privacy-policy-controls.js'

const FIXED_NOW = '2026-08-03T00:00:00.000Z'
const FIXED_ORG = 1
const FIXED_PROJECT = 10

// ─── 策略 ────────────────────────────────────────────────────────────────────

export function buildSystemDefaultPrivacyPolicy(
  overrides: Partial<OcrPrivacyPolicy> = {},
): OcrPrivacyPolicy {
  const organizationId = overrides.organizationId ?? FIXED_ORG
  const projectId = overrides.projectId === undefined ? null : overrides.projectId
  const categoryRules = overrides.categoryRules ?? resolveSystemDefaultCategoryRules()
  return {
    source: 'system',
    organizationId,
    projectId,
    version: 1,
    status: 'active',
    categoryRules,
    allowedPurposes: [
      'review',
      'copy_single',
      'export_metadata',
      'search_index',
      'structured_extraction',
      'entity_linking',
    ],
    globalOutputMode: 'full',
    bounds: {
      maxExportRecords: 500,
      maxCopyCharacters: 50000,
      maxExportPages: 100,
      allowedOutputModes: ['full', 'snippet', 'masked', 'metadata_only', 'blocked'],
      requireConfirmationFor: ['copy', 'export', 'ai_handoff'],
      auditRequiredFor: [
        'copy',
        'export',
        'search_index',
        'structured_extraction',
        'entity_linking',
        'ai_handoff',
      ],
      disallowExternalDelivery: true,
      disallowAutoDownstream: true,
    },
    policyHash: computePrivacyPolicyHash({ organizationId, projectId, categoryRules }),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  }
}

export function buildOrganizationDefaultPrivacyPolicy(
  overrides: Partial<OcrPrivacyPolicy> = {},
): OcrPrivacyPolicy {
  const base = buildSystemDefaultPrivacyPolicy(overrides)
  const categoryRules =
    overrides.categoryRules ??
    base.categoryRules.map((r) =>
      r.category === 'candidate_text'
        ? {
            ...r,
            defaultOutputMode: 'snippet' as const,
            allowedPurposes: ['review', 'export_metadata'] as const,
          }
        : r,
    )
  return {
    ...base,
    source: 'organization',
    projectId: null,
    categoryRules,
    policyHash: computePrivacyPolicyHash({
      organizationId: overrides.organizationId ?? FIXED_ORG,
      projectId: null,
      categoryRules,
    }),
    ...overrides,
  }
}

export function buildProjectOverridePrivacyPolicy(
  overrides: Partial<OcrPrivacyPolicy> = {},
): OcrPrivacyPolicy {
  const base = buildSystemDefaultPrivacyPolicy(overrides)
  const categoryRules =
    overrides.categoryRules ??
    base.categoryRules.map((r) =>
      r.category === 'search_snippets'
        ? { ...r, allowedPurposes: ['review', 'search_index'] as const }
        : r,
    )
  return {
    ...base,
    source: 'project',
    projectId: FIXED_PROJECT,
    categoryRules,
    policyHash: computePrivacyPolicyHash({
      organizationId: overrides.organizationId ?? FIXED_ORG,
      projectId: FIXED_PROJECT,
      categoryRules,
    }),
    ...overrides,
  }
}

export function buildStrictPrivacyPolicy(
  overrides: Partial<OcrPrivacyPolicy> = {},
): OcrPrivacyPolicy {
  const base = buildSystemDefaultPrivacyPolicy(overrides)
  return {
    ...base,
    source: 'project',
    projectId: FIXED_PROJECT,
    globalOutputMode: 'metadata_only',
    allowedPurposes: ['review', 'export_metadata'],
    categoryRules: base.categoryRules.map((r) =>
      r.isHighSensitivity
        ? { ...r, allowedPurposes: [] as const, defaultOutputMode: 'blocked' as const }
        : { ...r, defaultOutputMode: 'metadata_only' as const },
    ),
    policyHash: computePrivacyPolicyHash({
      organizationId: overrides.organizationId ?? FIXED_ORG,
      projectId: FIXED_PROJECT,
      categoryRules: base.categoryRules.map((r) =>
        r.isHighSensitivity
          ? { ...r, allowedPurposes: [], defaultOutputMode: 'blocked' as const }
          : { ...r, defaultOutputMode: 'metadata_only' as const },
      ),
    }),
    ...overrides,
  }
}

// ─── 策略覆盖请求 ──────────────────────────────────────────────────────────

export function buildPrivacyPolicyOverrideRequest(
  overrides: Partial<OcrPrivacyPolicyOverrideRequest> = {},
): OcrPrivacyPolicyOverrideRequest {
  return {
    categoryRules: resolveSystemDefaultCategoryRules().map((r) => ({
      category: r.category,
      allowedPurposes: r.allowedPurposes,
      defaultOutputMode: r.defaultOutputMode,
    })),
    allowedPurposes: [
      'review',
      'copy_single',
      'export_metadata',
      'search_index',
      'structured_extraction',
      'entity_linking',
    ],
    globalOutputMode: 'full',
    ...overrides,
  }
}

export function buildUnsafePolicyOverrideRequest(): OcrPrivacyPolicyOverrideRequest {
  return buildPrivacyPolicyOverrideRequest({
    globalOutputMode: 'full',
    allowedPurposes: [
      'review',
      'copy_single',
      'copy_bulk',
      'export_metadata',
      'export_full',
      'search_index',
      'structured_extraction',
      'entity_linking',
      'ai_handoff',
    ],
    categoryRules: resolveSystemDefaultCategoryRules().map((r) => ({
      category: r.category,
      allowedPurposes: [
        'review',
        'copy_single',
        'copy_bulk',
        'export_metadata',
        'export_full',
        'search_index',
        'structured_extraction',
        'entity_linking',
        'ai_handoff',
      ],
      defaultOutputMode: 'full' as const,
    })),
  })
}

// ─── 决策输入/输出 ──────────────────────────────────────────────────────────

export function buildPrivacyDecisionInput(
  overrides: Partial<OcrPrivacyDecisionInput> = {},
): OcrPrivacyDecisionInput {
  const base = buildSystemDefaultPrivacyPolicy()
  return {
    purpose: 'review',
    contentCategory: 'accepted_extraction_text',
    action: 'read',
    sourceVisible: true,
    sourceHash: 'src_hash_001',
    contentHash: 'cnt_hash_001',
    lifecycleState: 'active',
    holdActive: false,
    policyHash: base.policyHash,
    authContext: {
      userId: 100,
      organizationId: FIXED_ORG,
      projectId: FIXED_PROJECT,
      permissions: ['file:view', 'file:manage', 'ocr_privacy:view'],
    },
    ...overrides,
  }
}

export function buildAllowDecision(
  overrides: Partial<OcrPrivacyDecision> = {},
): OcrPrivacyDecision {
  const input = buildPrivacyDecisionInput()
  const result = 'allow' as const
  return {
    result,
    outputMode: 'full',
    reasons: [],
    warnings: [],
    requiresExplicitConfirmation: false,
    decisionHash: computePrivacyDecisionHash({
      purpose: input.purpose,
      contentCategory: input.contentCategory,
      action: input.action,
      sourceHash: input.sourceHash,
      contentHash: input.contentHash,
      policyHash: input.policyHash,
      result,
    }),
    policyHash: input.policyHash,
    sourceHash: input.sourceHash,
    allowedFields: ['*'],
    ...overrides,
  }
}

export function buildBlockDecision(
  overrides: Partial<OcrPrivacyDecision> = {},
): OcrPrivacyDecision {
  const input = buildPrivacyDecisionInput({ lifecycleState: 'expired' })
  const result = 'block' as const
  return {
    result,
    outputMode: 'blocked',
    reasons: ['lifecycle_expired'],
    warnings: ['LIFECYCLE_WARNING'],
    requiresExplicitConfirmation: false,
    decisionHash: computePrivacyDecisionHash({
      purpose: input.purpose,
      contentCategory: input.contentCategory,
      action: input.action,
      sourceHash: input.sourceHash,
      contentHash: input.contentHash,
      policyHash: input.policyHash,
      result,
    }),
    policyHash: input.policyHash,
    sourceHash: input.sourceHash,
    allowedFields: [],
    ...overrides,
  }
}

export function buildRedactDecision(
  overrides: Partial<OcrPrivacyDecision> = {},
): OcrPrivacyDecision {
  const input = buildPrivacyDecisionInput({ sourceVisible: false })
  const result = 'redact' as const
  return {
    result,
    outputMode: 'masked',
    reasons: ['source_hidden'],
    warnings: ['SOURCE_HIDDEN'],
    requiresExplicitConfirmation: false,
    decisionHash: computePrivacyDecisionHash({
      purpose: input.purpose,
      contentCategory: input.contentCategory,
      action: input.action,
      sourceHash: input.sourceHash,
      contentHash: input.contentHash,
      policyHash: input.policyHash,
      result,
    }),
    policyHash: input.policyHash,
    sourceHash: input.sourceHash,
    allowedFields: ['sourceKind', 'sourceHash', 'extractionId', 'lifecycleState'],
    ...overrides,
  }
}

export function buildConfirmRequiredDecision(
  overrides: Partial<OcrPrivacyDecision> = {},
): OcrPrivacyDecision {
  const input = buildPrivacyDecisionInput({ action: 'export' })
  const result = 'confirm_required' as const
  return {
    result,
    outputMode: 'full',
    reasons: ['confirm_required'],
    warnings: ['CONFIRM_REQUIRED'],
    requiresExplicitConfirmation: true,
    decisionHash: computePrivacyDecisionHash({
      purpose: input.purpose,
      contentCategory: input.contentCategory,
      action: input.action,
      sourceHash: input.sourceHash,
      contentHash: input.contentHash,
      policyHash: input.policyHash,
      result,
    }),
    policyHash: input.policyHash,
    sourceHash: input.sourceHash,
    allowedFields: ['*'],
    ...overrides,
  }
}

export function buildMetadataOnlyDecision(
  overrides: Partial<OcrPrivacyDecision> = {},
): OcrPrivacyDecision {
  const input = buildPrivacyDecisionInput({ contentCategory: 'provider_summaries' })
  const result = 'metadata_only' as const
  return {
    result,
    outputMode: 'metadata_only',
    reasons: ['category_blocked'],
    warnings: [],
    requiresExplicitConfirmation: false,
    decisionHash: computePrivacyDecisionHash({
      purpose: input.purpose,
      contentCategory: input.contentCategory,
      action: input.action,
      sourceHash: input.sourceHash,
      contentHash: input.contentHash,
      policyHash: input.policyHash,
      result,
    }),
    policyHash: input.policyHash,
    sourceHash: input.sourceHash,
    allowedFields: [
      'sourceKind',
      'sourceHash',
      'extractionId',
      'lifecycleState',
      'createdAt',
      'contentHash',
    ],
    ...overrides,
  }
}

// ─── 复制/导出预览 ──────────────────────────────────────────────────────────

export function buildCopyExportPreviewInput(
  overrides: Partial<OcrPrivacyCopyExportPreviewInput> = {},
): OcrPrivacyCopyExportPreviewInput {
  const policy = buildSystemDefaultPrivacyPolicy()
  return {
    purpose: 'export_metadata',
    scope: {
      organizationId: FIXED_ORG,
      projectId: FIXED_PROJECT,
      acceptedExtractionIds: [1, 2, 3],
      sourceKind: 'attachment',
    },
    format: 'json_summary',
    policyHash: policy.policyHash,
    ...overrides,
  }
}

export function buildCopyExportPreviewResponse(
  overrides: Partial<OcrPrivacyCopyExportPreviewResponse> = {},
): OcrPrivacyCopyExportPreviewResponse {
  const input = buildCopyExportPreviewInput()
  return {
    previewHash: computePrivacyPreviewHash({
      organizationId: input.scope.organizationId,
      projectId: input.scope.projectId,
      policyHash: input.policyHash,
      acceptedExtractionIds: input.scope.acceptedExtractionIds,
      format: input.format,
    }),
    policyHash: input.policyHash,
    outputMode: 'metadata_only',
    recordCount: 3,
    estimatedCharacters: 4500,
    pageCount: 5,
    requiresExplicitConfirmation: false,
    warnings: [],
    scopeSummary: {
      sourceKind: 'attachment',
      acceptedExtractionCount: 3,
      textLengthSummary: '3 个已接收提取，共约 4500 字符',
    },
    ...overrides,
  }
}

export function buildCopyExportExecuteInput(
  overrides: Partial<OcrPrivacyCopyExportExecuteInput> = {},
): OcrPrivacyCopyExportExecuteInput {
  const preview = buildCopyExportPreviewResponse()
  return {
    previewHash: preview.previewHash,
    policyHash: preview.policyHash,
    idempotencyKey: 'idem_key_001',
    ...overrides,
  }
}

// ─── 运行记录 ────────────────────────────────────────────────────────────────

export function buildCopyExportRun(
  overrides: Partial<OcrPrivacyCopyExportRun> = {},
): OcrPrivacyCopyExportRun {
  const preview = buildCopyExportPreviewResponse()
  return {
    id: 1,
    runKey: 'run_key_001',
    organizationId: FIXED_ORG,
    projectId: FIXED_PROJECT,
    status: 'completed',
    outputMode: 'metadata_only',
    previewHash: preview.previewHash,
    policyHash: preview.policyHash,
    counts: {
      recordCount: 3,
      characterCount: 4500,
      pageCount: 5,
    },
    contentHashes: ['hash_a', 'hash_b', 'hash_c'],
    warningCodes: [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  }
}

// ─── 状态摘要 ────────────────────────────────────────────────────────────────

export function buildPrivacyStatusSummary(
  overrides: Partial<OcrPrivacyStatusSummary> = {},
): OcrPrivacyStatusSummary {
  const policy = buildSystemDefaultPrivacyPolicy()
  return {
    policyHash: policy.policyHash,
    policySource: 'system',
    allowedActions: ['view_status', 'view_policy', 'view_audit'],
    globalOutputMode: 'full',
    warnings: [],
    policyVersion: 1,
    ...overrides,
  }
}

// ─── 脱敏 ────────────────────────────────────────────────────────────────────

export function buildRedactionSummary(
  overrides: Partial<OcrPrivacyRedactionContext> = {},
): OcrPrivacyRedactionContext {
  return {
    type: 'masked',
    reason: 'source_hidden',
    allowedFields: ['sourceKind', 'sourceHash', 'extractionId', 'lifecycleState'],
    ...overrides,
  }
}

// ─── 大容量测试夹具 ──────────────────────────────────────────────────────────

export function buildLargeAcceptedExtractionIds(count: number = 500): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}

export function buildBoundedExportPreview(
  maxRecords: number = 500,
): OcrPrivacyCopyExportPreviewResponse {
  const ids = buildLargeAcceptedExtractionIds(maxRecords)
  const policy = buildSystemDefaultPrivacyPolicy()
  return buildCopyExportPreviewResponse({
    policyHash: policy.policyHash,
    recordCount: ids.length,
    estimatedCharacters: ids.length * 1500,
    pageCount: Math.ceil(ids.length / 5),
    warnings: maxRecords >= 500 ? ['EXPORT_LIMIT_APPROACHING'] : [],
    previewHash: computePrivacyPreviewHash({
      organizationId: FIXED_ORG,
      projectId: FIXED_PROJECT,
      policyHash: policy.policyHash,
      acceptedExtractionIds: ids,
      format: 'json_summary',
    }),
  })
}
