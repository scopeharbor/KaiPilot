/**
 * OCR Privacy Classifier & Decision — 单元测试
 *
 * 覆盖：分类、决策 preflight、脱敏、权限拒绝
 */
import { describe, it, expect } from 'vitest'
import {
  classifyOcrContent,
  classifyOcrContentBatch,
} from '../../app/services/ai_ocr/ocr_content_sensitivity_classifier.js'
import { OcrPrivacyDecisionService } from '../../app/services/ai_ocr/ocr_privacy_decision_service.js'
import { resolveSystemDefaultPrivacyPolicy } from '@aiproj/types'

describe('OcrContentSensitivityClassifier', () => {
  it('classifyOcrContent returns correct category', () => {
    expect(classifyOcrContent('accepted_extraction_text')).toBe('accepted_extraction_text')
    expect(classifyOcrContent('source_metadata')).toBe('source_metadata')
    expect(classifyOcrContent('job_metadata')).toBe('job_metadata')
    expect(classifyOcrContent('provider_summaries')).toBe('provider_summaries')
    expect(classifyOcrContent('unknown_kind')).toBe('accepted_extraction_text') // 默认高敏感
  })

  it('classifyOcrContentBatch works', () => {
    const results = classifyOcrContentBatch([
      { kind: 'source_metadata' },
      { kind: 'accepted_extraction_text' },
      { kind: 'job_metadata' },
    ])
    expect(results).toEqual(['source_metadata', 'accepted_extraction_text', 'job_metadata'])
  })

  it('dangerous inputs are upgraded', () => {
    // Bearer token 会被升级为高敏感
    const result = classifyOcrContent('source_metadata', 'Bearer sk-test-token-123')
    expect(result).toBe('accepted_extraction_text')
  })
})

describe('OcrPrivacyDecisionService', () => {
  it('preflight returns allow for valid review', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'review',
        contentCategory: 'accepted_extraction_text',
        action: 'read',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'active',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:view', 'file:view'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('allow')
    expect(decision.outputMode).toBe('full')
    expect(decision.decisionHash.length).toBe(8)
  })

  it('preflight blocks expired lifecycle', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'review',
        contentCategory: 'accepted_extraction_text',
        action: 'read',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'purged',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:view'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('block')
    expect(decision.warnings).toContain('LIFECYCLE_WARNING')
  })

  it('preflight blocks hold-blocked lifecycle', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'export_metadata',
        contentCategory: 'accepted_extraction_text',
        action: 'export',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'hold_blocked',
        holdActive: true,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:export'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('block')
    expect(decision.reasons).toContain('hold_blocked')
  })

  it('preflight blocks AI handoff without ai:trigger', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'ai_handoff',
        contentCategory: 'accepted_extraction_text',
        action: 'ai_handoff',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'active',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:view'], // 无 ai:trigger
        },
      },
      policy,
    )

    expect(decision.result).toBe('block')
    expect(decision.reasons).toContain('ai_permission_missing')
  })

  it('preflight requires confirmation for export of high-sensitivity content', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'export_metadata',
        contentCategory: 'accepted_extraction_text',
        action: 'export',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'active',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:export'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('confirm_required')
    expect(decision.requiresExplicitConfirmation).toBe(true)
    expect(decision.warnings).toContain('CONFIRM_REQUIRED')
  })

  it('preflight redacts hidden source', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'review',
        contentCategory: 'accepted_extraction_text',
        action: 'read',
        sourceVisible: false,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'active',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:view'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('redact')
    expect(decision.reasons).toContain('source_hidden')
    expect(decision.warnings).toContain('SOURCE_HIDDEN')
  })

  it('preflight returns metadata_only for tombstoned records', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'review',
        contentCategory: 'accepted_extraction_text',
        action: 'read',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'tombstoned',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 1,
          projectId: 10,
          permissions: ['ocr_privacy:view'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('metadata_only')
    expect(decision.outputMode).toBe('metadata_only')
  })

  it('preflight blocks cross-organization access', () => {
    const service = new OcrPrivacyDecisionService()
    const policy = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

    const decision = service.preflight(
      {
        purpose: 'review',
        contentCategory: 'accepted_extraction_text',
        action: 'read',
        sourceVisible: true,
        sourceHash: 'sh1',
        contentHash: 'ch1',
        lifecycleState: 'active',
        holdActive: false,
        policyHash: policy.policyHash,
        authContext: {
          userId: 100,
          organizationId: 2, // 不同组织
          projectId: 10,
          permissions: ['ocr_privacy:view'],
        },
      },
      policy,
    )

    expect(decision.result).toBe('block')
    expect(decision.reasons).toContain('cross_organization')
  })
})
