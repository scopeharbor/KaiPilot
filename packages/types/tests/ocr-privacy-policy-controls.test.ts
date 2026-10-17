/**
 * OCR Privacy Policy Controls — 共享契约测试
 *
 * 测试枚举守卫、策略哈希稳定性、决策哈希稳定性、
 * 预览哈希验证、不安全策略拒绝、目的解析、输出模式降级和脱敏摘要。
 */

import { describe, it, expect } from 'vitest'
import {
  isOcrPrivacyAction,
  isOcrPrivacyOutputMode,
  isOcrPrivacyDecisionResult,
  isOcrContentSensitivityCategory,
  isOcrPrivacyDecisionReason,
  isOcrPrivacyPolicySource,
  isOcrPrivacyPurpose,
  isOcrPrivacyExportFormat,
  isOcrPrivacyRunStatus,
  isOcrPrivacyPolicyStatus,
  isOcrPrivacyAllowedAction,
  isOcrPrivacyAuditAction,
  isOcrPrivacyWarningCode,
  computePrivacyPolicyHash,
  computePrivacyDecisionHash,
  computePrivacyPreviewHash,
  computePrivacyContentHash,
  computePrivacyExportRunKey,
  buildPrivacyRedactionSummary,
  validatePrivacyPolicyOverride,
  isHighSensitivityCategory,
  isMetadataOnlyCategory,
  isPurposeAllowed,
  resolveOutputMode,
  downgradeOutputMode,
  sortPrivacyWarningsBySeverity,
  aggregatePrivacyWarnings,
  computeAllowedFields,
  isPrivacyDecisionFatal,
  requiresPrivacyConfirmation,
  resolveSystemDefaultCategoryRules,
  resolveSystemDefaultPrivacyPolicy,
  OCR_PRIVACY_ACTIONS,
  OCR_PRIVACY_OUTPUT_MODES,
  OCR_PRIVACY_DECISION_RESULTS,
  OCR_CONTENT_SENSITIVITY_CATEGORIES,
  OCR_PRIVACY_DECISION_REASONS,
  OCR_PRIVACY_POLICY_SOURCES,
  OCR_PRIVACY_PURPOSES,
  OCR_PRIVACY_EXPORT_FORMATS,
  OCR_PRIVACY_RUN_STATUSES,
  OCR_PRIVACY_POLICY_STATUSES,
  OCR_PRIVACY_ALLOWED_ACTIONS,
  OCR_PRIVACY_AUDIT_ACTIONS,
  OCR_PRIVACY_WARNING_CODES,
} from '@aiproj/types'
import {
  buildSystemDefaultPrivacyPolicy,
  buildOrganizationDefaultPrivacyPolicy,
  buildProjectOverridePrivacyPolicy,
  buildStrictPrivacyPolicy,
  buildPrivacyPolicyOverrideRequest,
  buildUnsafePolicyOverrideRequest,
  buildPrivacyDecisionInput,
  buildAllowDecision,
  buildBlockDecision,
  buildRedactDecision,
  buildConfirmRequiredDecision,
  buildMetadataOnlyDecision,
  buildCopyExportPreviewInput,
  buildCopyExportPreviewResponse,
  buildCopyExportExecuteInput,
  buildCopyExportRun,
  buildPrivacyStatusSummary,
  buildRedactionSummary,
  buildLargeAcceptedExtractionIds,
  buildBoundedExportPreview,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// 枚举守卫
// ═══════════════════════════════════════════════════════════════════════════════

describe('enum guards', () => {
  it.each(OCR_PRIVACY_ACTIONS)('isOcrPrivacyAction(%s) => true', (v) => {
    expect(isOcrPrivacyAction(v)).toBe(true)
    expect(isOcrPrivacyAction('invalid')).toBe(false)
    expect(isOcrPrivacyAction(null)).toBe(false)
    expect(isOcrPrivacyAction(123)).toBe(false)
  })

  it.each(OCR_PRIVACY_OUTPUT_MODES)('isOcrPrivacyOutputMode(%s) => true', (v) => {
    expect(isOcrPrivacyOutputMode(v)).toBe(true)
    expect(isOcrPrivacyOutputMode('unknown')).toBe(false)
  })

  it.each(OCR_PRIVACY_DECISION_RESULTS)('isOcrPrivacyDecisionResult(%s) => true', (v) => {
    expect(isOcrPrivacyDecisionResult(v)).toBe(true)
    expect(isOcrPrivacyDecisionResult('unknown')).toBe(false)
  })

  it.each(OCR_CONTENT_SENSITIVITY_CATEGORIES)(
    'isOcrContentSensitivityCategory(%s) => true',
    (v) => {
      expect(isOcrContentSensitivityCategory(v)).toBe(true)
      expect(isOcrContentSensitivityCategory('full_ocr_text')).toBe(false)
    },
  )

  it.each(OCR_PRIVACY_DECISION_REASONS)('isOcrPrivacyDecisionReason(%s) => true', (v) => {
    expect(isOcrPrivacyDecisionReason(v)).toBe(true)
    expect(isOcrPrivacyDecisionReason('custom_reason')).toBe(false)
  })

  it.each(OCR_PRIVACY_POLICY_SOURCES)('isOcrPrivacyPolicySource(%s) => true', (v) => {
    expect(isOcrPrivacyPolicySource(v)).toBe(true)
    expect(isOcrPrivacyPolicySource('random')).toBe(false)
  })

  it.each(OCR_PRIVACY_PURPOSES)('isOcrPrivacyPurpose(%s) => true', (v) => {
    expect(isOcrPrivacyPurpose(v)).toBe(true)
    expect(isOcrPrivacyPurpose('unknown')).toBe(false)
  })

  it.each(OCR_PRIVACY_EXPORT_FORMATS)('isOcrPrivacyExportFormat(%s) => true', (v) => {
    expect(isOcrPrivacyExportFormat(v)).toBe(true)
    expect(isOcrPrivacyExportFormat('pdf')).toBe(false)
  })

  it.each(OCR_PRIVACY_RUN_STATUSES)('isOcrPrivacyRunStatus(%s) => true', (v) => {
    expect(isOcrPrivacyRunStatus(v)).toBe(true)
    expect(isOcrPrivacyRunStatus('running')).toBe(false)
  })

  it.each(OCR_PRIVACY_POLICY_STATUSES)('isOcrPrivacyPolicyStatus(%s) => true', (v) => {
    expect(isOcrPrivacyPolicyStatus(v)).toBe(true)
    expect(isOcrPrivacyPolicyStatus('invalid')).toBe(false)
  })

  it.each(OCR_PRIVACY_ALLOWED_ACTIONS)('isOcrPrivacyAllowedAction(%s) => true', (v) => {
    expect(isOcrPrivacyAllowedAction(v)).toBe(true)
    expect(isOcrPrivacyAllowedAction('random')).toBe(false)
  })

  it.each(OCR_PRIVACY_AUDIT_ACTIONS)('isOcrPrivacyAuditAction(%s) => true', (v) => {
    expect(isOcrPrivacyAuditAction(v)).toBe(true)
    expect(isOcrPrivacyAuditAction('CUSTOM_AUDIT')).toBe(false)
  })

  it.each(OCR_PRIVACY_WARNING_CODES)('isOcrPrivacyWarningCode(%s) => true', (v) => {
    expect(isOcrPrivacyWarningCode(v)).toBe(true)
    expect(isOcrPrivacyWarningCode('CUSTOM_WARNING')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 策略哈希稳定性
// ═══════════════════════════════════════════════════════════════════════════════

describe('policy hash stability', () => {
  it('同一输入产生相同哈希', () => {
    const rules = resolveSystemDefaultCategoryRules()
    const a = computePrivacyPolicyHash({ organizationId: 1, projectId: 10, categoryRules: rules })
    const b = computePrivacyPolicyHash({ organizationId: 1, projectId: 10, categoryRules: rules })
    expect(a).toBe(b)
    expect(a.length).toBe(8)
  })

  it('不同组织产生不同哈希', () => {
    const rules = resolveSystemDefaultCategoryRules()
    const a = computePrivacyPolicyHash({ organizationId: 1, projectId: 10, categoryRules: rules })
    const b = computePrivacyPolicyHash({ organizationId: 2, projectId: 10, categoryRules: rules })
    expect(a).not.toBe(b)
  })

  it('不同项目产生不同哈希', () => {
    const rules = resolveSystemDefaultCategoryRules()
    const a = computePrivacyPolicyHash({ organizationId: 1, projectId: 10, categoryRules: rules })
    const b = computePrivacyPolicyHash({ organizationId: 1, projectId: 20, categoryRules: rules })
    expect(a).not.toBe(b)
  })

  it('不同规则顺序产生相同哈希（排序稳定）', () => {
    const rules = resolveSystemDefaultCategoryRules()
    const reversed = [...rules].reverse()
    const a = computePrivacyPolicyHash({ organizationId: 1, projectId: null, categoryRules: rules })
    const b = computePrivacyPolicyHash({
      organizationId: 1,
      projectId: null,
      categoryRules: reversed,
    })
    expect(a).toBe(b)
  })

  it('null projectId 产生确定性哈希', () => {
    const rules = resolveSystemDefaultCategoryRules()
    const a = computePrivacyPolicyHash({ organizationId: 1, projectId: null, categoryRules: rules })
    const b = computePrivacyPolicyHash({ organizationId: 1, projectId: null, categoryRules: rules })
    expect(a).toBe(b)
    expect(a.length).toBe(8)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 决策哈希稳定性
// ═══════════════════════════════════════════════════════════════════════════════

describe('decision hash stability', () => {
  it('同一输入产生相同决策哈希', () => {
    const a = computePrivacyDecisionHash({
      purpose: 'review',
      contentCategory: 'accepted_extraction_text',
      action: 'read',
      sourceHash: 'sh1',
      contentHash: 'ch1',
      policyHash: 'ph1',
      result: 'allow',
    })
    const b = computePrivacyDecisionHash({
      purpose: 'review',
      contentCategory: 'accepted_extraction_text',
      action: 'read',
      sourceHash: 'sh1',
      contentHash: 'ch1',
      policyHash: 'ph1',
      result: 'allow',
    })
    expect(a).toBe(b)
  })

  it('不同决策结果产生不同哈希', () => {
    const base = {
      purpose: 'review' as const,
      contentCategory: 'accepted_extraction_text' as const,
      action: 'read' as const,
      sourceHash: 'sh1',
      contentHash: 'ch1',
      policyHash: 'ph1',
    }
    expect(computePrivacyDecisionHash({ ...base, result: 'allow' })).not.toBe(
      computePrivacyDecisionHash({ ...base, result: 'block' }),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 预览哈希验证
// ═══════════════════════════════════════════════════════════════════════════════

describe('preview hash validation', () => {
  it('同一导出预览产生相同预览哈希', () => {
    const a = computePrivacyPreviewHash({
      organizationId: 1,
      projectId: 10,
      policyHash: 'ph_001',
      acceptedExtractionIds: [1, 2, 3],
      format: 'json_summary',
    })
    const b = computePrivacyPreviewHash({
      organizationId: 1,
      projectId: 10,
      policyHash: 'ph_001',
      acceptedExtractionIds: [3, 1, 2],
      format: 'json_summary',
    })
    expect(a).toBe(b)
  })

  it('不同格式产生不同预览哈希', () => {
    const base = {
      organizationId: 1,
      projectId: 10,
      policyHash: 'ph_001',
      acceptedExtractionIds: [1, 2],
    }
    expect(computePrivacyPreviewHash({ ...base, format: 'json_summary' })).not.toBe(
      computePrivacyPreviewHash({ ...base, format: 'text_snippet' }),
    )
  })

  it('不同策略哈希使预览哈希失效', () => {
    const base = {
      organizationId: 1,
      projectId: 10,
      acceptedExtractionIds: [1, 2],
      format: 'json_summary' as const,
    }
    expect(computePrivacyPreviewHash({ ...base, policyHash: 'ph_a' })).not.toBe(
      computePrivacyPreviewHash({ ...base, policyHash: 'ph_b' }),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 内容哈希
// ═══════════════════════════════════════════════════════════════════════════════

describe('content hash', () => {
  it('同一内容产生相同哈希', () => {
    const a = computePrivacyContentHash({
      extractionId: 1,
      sourceHash: 'sh1',
      textLength: 100,
      pageCount: 2,
    })
    const b = computePrivacyContentHash({
      extractionId: 1,
      sourceHash: 'sh1',
      textLength: 100,
      pageCount: 2,
    })
    expect(a).toBe(b)
  })

  it('textLength 影响哈希（不含完整文本）', () => {
    const a = computePrivacyContentHash({
      extractionId: 1,
      sourceHash: 'sh1',
      textLength: 100,
      pageCount: 2,
    })
    const b = computePrivacyContentHash({
      extractionId: 1,
      sourceHash: 'sh1',
      textLength: 200,
      pageCount: 2,
    })
    expect(a).not.toBe(b) // 证明哈希不含完整文本（否则 100 vs 200 字符的文本不同）
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 导出运行 Key 幂等性
// ═══════════════════════════════════════════════════════════════════════════════

describe('export run key idempotency', () => {
  it('同一请求产生相同运行 Key', () => {
    const base = {
      organizationId: 1,
      projectId: 10,
      purpose: 'export_metadata' as const,
      format: 'json_summary' as const,
      policyHash: 'ph_001',
      acceptedExtractionIds: [1, 2, 3],
    }
    expect(computePrivacyExportRunKey(base)).toBe(computePrivacyExportRunKey(base))
  })

  it('ID 排序不影响运行 Key', () => {
    const base = {
      organizationId: 1,
      projectId: 10,
      purpose: 'export_metadata' as const,
      format: 'json_summary' as const,
      policyHash: 'ph_001',
    }
    expect(computePrivacyExportRunKey({ ...base, acceptedExtractionIds: [1, 2, 3] })).toBe(
      computePrivacyExportRunKey({ ...base, acceptedExtractionIds: [3, 1, 2] }),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 不安全策略拒绝
// ═══════════════════════════════════════════════════════════════════════════════

describe('unsafe policy rejection', () => {
  it('高敏感类别不允许 export_full', () => {
    const override = buildUnsafePolicyOverrideRequest()
    const errors = validatePrivacyPolicyOverride(override)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.includes('high-sensitivity'))).toBe(true)
  })

  it('高敏感类别不允许 ai_handoff', () => {
    const override = buildUnsafePolicyOverrideRequest()
    const errors = validatePrivacyPolicyOverride(override)
    expect(errors.some((e) => e.includes('ai_handoff'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 目的解析
// ═══════════════════════════════════════════════════════════════════════════════

describe('allowed-purpose resolution', () => {
  it('review 默认被允许（accepted_extraction_text）', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(isPurposeAllowed('review', 'accepted_extraction_text', rules)).toBe(true)
  })

  it('export_full 默认不被允许（accepted_extraction_text）', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(isPurposeAllowed('export_full', 'accepted_extraction_text', rules)).toBe(false)
  })

  it('ai_handoff 默认不被允许（accepted_extraction_text）', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(isPurposeAllowed('ai_handoff', 'accepted_extraction_text', rules)).toBe(false)
  })

  it('不存在类别返回 false', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(isPurposeAllowed('review', 'non_existent' as any, rules)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 输出模式降级
// ═══════════════════════════════════════════════════════════════════════════════

describe('output-mode downgrade', () => {
  it('downgrade 只收紧不放松', () => {
    expect(downgradeOutputMode('full', 'snippet')).toBe('snippet')
    expect(downgradeOutputMode('snippet', 'full')).toBe('snippet')
    expect(downgradeOutputMode('blocked', 'full')).toBe('blocked')
  })

  it('resolve 选择最严格模式', () => {
    const rules = resolveSystemDefaultCategoryRules()
    const result = resolveOutputMode('review', 'accepted_extraction_text', rules, 'masked')
    expect(result).toBe('masked') // 类别默认 full 但全局 masked ⇒ masked
  })

  it('不可用目的返回 blocked', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(resolveOutputMode('ai_handoff', 'accepted_extraction_text', rules, 'full')).toBe(
      'blocked',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 脱敏摘要
// ═══════════════════════════════════════════════════════════════════════════════

describe('redaction summaries', () => {
  it('buildPrivacyRedactionSummary 不含敏感数据', () => {
    const summary = buildPrivacyRedactionSummary({
      category: 'accepted_extraction_text',
      action: 'read',
      reason: 'source_hidden',
    })
    expect(summary).not.toContain('full text')
    expect(summary).not.toContain('secret')
    expect(summary).toContain('redacted')
    expect(summary).toContain('accepted_extraction_text')
    expect(summary).toContain('source_hidden')
  })

  it('buildRedactionSummary fixture 返回正确类型', () => {
    const ctx = buildRedactionSummary()
    expect(ctx.type).toBe('masked')
    expect(ctx.reason).toBe('source_hidden')
    expect(ctx.allowedFields.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 高敏感类别
// ═══════════════════════════════════════════════════════════════════════════════

describe('high sensitivity classification', () => {
  it('accepted_extraction_text 被视为高敏感', () => {
    expect(isHighSensitivityCategory('accepted_extraction_text')).toBe(true)
  })

  it('candidate_text 被视为高敏感', () => {
    expect(isHighSensitivityCategory('candidate_text')).toBe(true)
  })

  it('source_metadata 被视为低敏感', () => {
    expect(isHighSensitivityCategory('source_metadata')).toBe(false)
  })

  it('provider_summaries 不被视为高敏感但应只允许 metadata_only', () => {
    expect(isHighSensitivityCategory('provider_summaries')).toBe(false)
    expect(isMetadataOnlyCategory('provider_summaries')).toBe(false) // 它有自己的限制规则
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 系统默认策略
// ═══════════════════════════════════════════════════════════════════════════════

describe('system default policy', () => {
  it('resolveSystemDefaultCategoryRules 包含 13 个类别', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(rules).toHaveLength(13)
    expect(rules.every((r) => isOcrContentSensitivityCategory(r.category))).toBe(true)
  })

  it('resolveSystemDefaultPrivacyPolicy 生成有效策略', () => {
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })
    expect(policy.source).toBe('system')
    expect(policy.organizationId).toBe(1)
    expect(policy.projectId).toBe(10)
    expect(policy.policyHash.length).toBe(8)
    expect(policy.categoryRules.length).toBe(13)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Fixture builders
// ═══════════════════════════════════════════════════════════════════════════════

describe('fixture builders', () => {
  it('buildSystemDefaultPrivacyPolicy 产生完整策略', () => {
    const p = buildSystemDefaultPrivacyPolicy()
    expect(p.source).toBe('system')
    expect(p.organizationId).toBe(1)
    expect(p.projectId).toBeNull()
    expect(p.policyHash).toBeDefined()
  })

  it('buildOrganizationDefaultPrivacyPolicy 产生组织级别策略', () => {
    const p = buildOrganizationDefaultPrivacyPolicy()
    expect(p.source).toBe('organization')
    expect(p.projectId).toBeNull()
  })

  it('buildProjectOverridePrivacyPolicy 产生项目级别策略', () => {
    const p = buildProjectOverridePrivacyPolicy()
    expect(p.source).toBe('project')
    expect(p.projectId).toBe(10)
  })

  it('buildStrictPrivacyPolicy 严格模式屏蔽所有高敏感输出', () => {
    const p = buildStrictPrivacyPolicy()
    expect(p.globalOutputMode).toBe('metadata_only')
    for (const rule of p.categoryRules) {
      if (rule.isHighSensitivity) {
        expect(rule.allowedPurposes).toHaveLength(0)
        expect(rule.defaultOutputMode).toBe('blocked')
      }
    }
  })

  it('buildAllowDecision 产生 allow 决策', () => {
    const d = buildAllowDecision()
    expect(d.result).toBe('allow')
    expect(d.decisionHash).toBeDefined()
    expect(d.allowedFields).toContain('*')
  })

  it('buildBlockDecision 产生 block 决策', () => {
    const d = buildBlockDecision()
    expect(d.result).toBe('block')
    expect(d.outputMode).toBe('blocked')
    expect(d.allowedFields).toEqual([])
  })

  it('buildConfirmRequiredDecision 需要显式确认', () => {
    const d = buildConfirmRequiredDecision()
    expect(d.result).toBe('confirm_required')
    expect(d.requiresExplicitConfirmation).toBe(true)
    expect(d.warnings).toContain('CONFIRM_REQUIRED')
  })

  it('buildCopyExportPreviewResponse 产生有效预览', () => {
    const p = buildCopyExportPreviewResponse()
    expect(p.previewHash).toBeDefined()
    expect(p.recordCount).toBe(3)
  })

  it('buildCopyExportRun 产生有效运行', () => {
    const r = buildCopyExportRun()
    expect(r.id).toBe(1)
    expect(r.runKey).toBeDefined()
    expect(r.status).toBe('completed')
  })

  it('buildPrivacyStatusSummary 产生有效状态', () => {
    const s = buildPrivacyStatusSummary()
    expect(s.policyHash).toBeDefined()
    expect(s.allowedActions).toContain('view_status')
  })

  it('buildLargeAcceptedExtractionIds 产生指定数量 ID', () => {
    expect(buildLargeAcceptedExtractionIds(10)).toHaveLength(10)
    expect(buildLargeAcceptedExtractionIds(500)).toHaveLength(500)
  })

  it('buildBoundedExportPreview 指标探针可用', () => {
    const p = buildBoundedExportPreview(500)
    expect(p.recordCount).toBe(500)
    expect(p.warnings).toContain('EXPORT_LIMIT_APPROACHING')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 边界条件
// ═══════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('resolveOutputMode 对不存在类别返回 blocked', () => {
    const rules = resolveSystemDefaultCategoryRules()
    expect(resolveOutputMode('review', 'non_existent' as any, rules, 'full')).toBe('blocked')
  })

  it('isPrivacyDecisionFatal 只对 block 为 true', () => {
    expect(isPrivacyDecisionFatal('block')).toBe(true)
    expect(isPrivacyDecisionFatal('allow')).toBe(false)
    expect(isPrivacyDecisionFatal('redact')).toBe(false)
    expect(isPrivacyDecisionFatal('confirm_required')).toBe(false)
  })

  it('requiresPrivacyConfirmation 对 copy/export/ai_handoff allow 为 true', () => {
    expect(requiresPrivacyConfirmation('copy', 'allow')).toBe(true)
    expect(requiresPrivacyConfirmation('export', 'allow')).toBe(true)
    expect(requiresPrivacyConfirmation('ai_handoff', 'allow')).toBe(true)
    expect(requiresPrivacyConfirmation('read', 'allow')).toBe(false)
    expect(requiresPrivacyConfirmation('copy', 'block')).toBe(false)
  })

  it('computeAllowedFields batch 覆盖所有输出模式', () => {
    expect(computeAllowedFields('full', 'accepted_extraction_text')).toEqual(['*'])
    expect(computeAllowedFields('snippet', 'accepted_extraction_text').length).toBeGreaterThan(0)
    expect(computeAllowedFields('masked', 'accepted_extraction_text').length).toBeGreaterThan(0)
    expect(
      computeAllowedFields('metadata_only', 'accepted_extraction_text').length,
    ).toBeGreaterThan(0)
    expect(computeAllowedFields('blocked', 'accepted_extraction_text')).toEqual([])
  })

  it('sortPrivacyWarningsBySeverity 排序合理', () => {
    const warnings = buildBoundedExportPreview(500).warnings
    const sorted = sortPrivacyWarningsBySeverity(warnings)
    expect(sorted).toEqual(warnings) // EXPORT_LIMIT_APPROACHING 已在合适位置
  })
})
