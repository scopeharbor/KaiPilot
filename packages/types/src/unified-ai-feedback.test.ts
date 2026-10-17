/**
 * v3-unified-ai-feedback-ledger —— 契约与 fixtures 测试。
 *
 * 覆盖 spec §2.1–§2.14 全部契约断言：
 * - 五态与既有 review_status 取值集合一致
 * - modified 与 accepted 在任何聚合路径下不被合并
 * - 拒绝原因枚举必须存在，备注不能顶替
 * - 修改指纹禁含正文
 * - 隐式反馈被拒绝
 * - 去重键确定性
 * - sanitizer 低敏
 */

import { describe, it, expect } from 'vitest'
import {
  FEEDBACK_TYPES,
  isFeedbackType,
  assertFeedbackType,
  EVALUATED_ARTIFACT_KINDS,
  FEEDBACK_CAPABILITY_SURFACES,
  REJECTION_REASONS,
  isRejectionReason,
  rejectionReasonLabel,
  MODIFICATION_MAGNITUDE_BANDS,
  isValidModificationFingerprint,
  FEEDBACK_NOTE_MAX_LENGTH,
  validateFeedbackNote,
  computeAdoptionRate,
  feedbackDetectForbiddenKeys,
  feedbackHasForbiddenKeys,
  computeFeedbackDeduplicationKey,
  isExplicitDecision,
  rejectImplicitFeedback,
  sanitizeFeedbackEvent,
} from './unified-ai-feedback.js'
import { DRAFT_LAYER_REVIEW_STATUSES, type DraftLayerReviewStatus } from './ai-draft-layer.js'

// ===========================================================================
// §2.2/§2.3 五态与既有 review_status 一致
// ===========================================================================

describe('FeedbackType matches DraftLayerReviewStatus', () => {
  it('has exactly the same members', () => {
    const feedbackSet = new Set(FEEDBACK_TYPES)
    const draftSet = new Set(DRAFT_LAYER_REVIEW_STATUSES)
    expect(feedbackSet).toEqual(draftSet)
  })

  it('has no additional state beyond the five', () => {
    expect(FEEDBACK_TYPES.length).toBe(5)
    expect(DRAFT_LAYER_REVIEW_STATUSES.length).toBe(5)
  })

  it('isFeedbackType validates correctly', () => {
    for (const status of DRAFT_LAYER_REVIEW_STATUSES) {
      expect(isFeedbackType(status)).toBe(true)
    }
    expect(isFeedbackType('unknown')).toBe(false)
    expect(isFeedbackType(null)).toBe(false)
    expect(isFeedbackType(42)).toBe(false)
  })

  it('assertFeedbackType throws on invalid', () => {
    expect(() => assertFeedbackType('bogus')).toThrow('Invalid FeedbackType')
    expect(assertFeedbackType('accepted')).toBe('accepted')
  })
})

// ===========================================================================
// §2.4 被反馈对象引用类型
// ===========================================================================

describe('EvaluatedArtifactKind', () => {
  it('covers all six artifact kinds', () => {
    expect(EVALUATED_ARTIFACT_KINDS).toHaveLength(6)
    expect(EVALUATED_ARTIFACT_KINDS).toContain('draft_layer_change')
    expect(EVALUATED_ARTIFACT_KINDS).toContain('copilot_action')
    expect(EVALUATED_ARTIFACT_KINDS).toContain('suggestion')
    expect(EVALUATED_ARTIFACT_KINDS).toContain('prediction_explanation')
    expect(EVALUATED_ARTIFACT_KINDS).toContain('triz_rationale')
    expect(EVALUATED_ARTIFACT_KINDS).toContain('report_draft')
  })
})

// ===========================================================================
// §2.5 拒绝原因枚举
// ===========================================================================

describe('RejectionReason', () => {
  it('has seven product-level reasons', () => {
    expect(REJECTION_REASONS).toHaveLength(7)
  })

  it('isRejectionReason validates correctly', () => {
    expect(isRejectionReason('factual_error')).toBe(true)
    expect(isRejectionReason('bogus')).toBe(false)
  })

  it('rejectionReasonLabel returns Chinese labels', () => {
    expect(rejectionReasonLabel('factual_error')).toBe('事实错误')
    expect(rejectionReasonLabel('not_applicable')).toBe('不适用本项目')
    expect(rejectionReasonLabel('wrong_granularity')).toBe('粒度不合适')
    expect(rejectionReasonLabel('better_option_exists')).toBe('已有更好方案')
    expect(rejectionReasonLabel('wrong_timing')).toBe('时机不对')
    expect(rejectionReasonLabel('did_not_understand')).toBe('不理解建议')
    expect(rejectionReasonLabel('other')).toBe('其他')
  })
})

// ===========================================================================
// §2.6 修改指纹 —— 禁含正文
// ===========================================================================

describe('ModificationFingerprint', () => {
  it('isValidModificationFingerprint accepts valid fingerprint', () => {
    expect(
      isValidModificationFingerprint({
        changedField: 'duration',
        magnitudeBand: 'medium',
        proposedValueHash: 'abc123',
        finalValueHash: 'def456',
      }),
    ).toBe(true)
  })

  it('rejects missing fields', () => {
    expect(isValidModificationFingerprint({ changedField: 'x' })).toBe(false)
    expect(isValidModificationFingerprint(null)).toBe(false)
  })

  it('rejects invalid magnitude band', () => {
    expect(
      isValidModificationFingerprint({
        changedField: 'duration',
        magnitudeBand: 'huge',
        proposedValueHash: 'abc',
        finalValueHash: 'def',
      }),
    ).toBe(false)
  })

  it('magnitude bands are exhaustive', () => {
    expect(MODIFICATION_MAGNITUDE_BANDS).toHaveLength(5)
    expect(MODIFICATION_MAGNITUDE_BANDS).toContain('trivial')
    expect(MODIFICATION_MAGNITUDE_BANDS).toContain('minor')
    expect(MODIFICATION_MAGNITUDE_BANDS).toContain('medium')
    expect(MODIFICATION_MAGNITUDE_BANDS).toContain('major')
    expect(MODIFICATION_MAGNITUDE_BANDS).toContain('structural')
  })
})

// ===========================================================================
// §2.8 备注不得替代拒绝原因
// ===========================================================================

describe('validateFeedbackNote', () => {
  it('accepts null note', () => {
    expect(validateFeedbackNote(null, 'accepted', null)).toEqual({ valid: true })
  })

  it('accepts note within length', () => {
    expect(validateFeedbackNote('short note', 'rejected', 'factual_error')).toEqual({
      valid: true,
    })
  })

  it('rejects note exceeding max length', () => {
    const longNote = 'x'.repeat(FEEDBACK_NOTE_MAX_LENGTH + 1)
    expect(validateFeedbackNote(longNote, 'accepted', null)).toEqual({
      valid: false,
      error: expect.stringContaining('exceeds max length'),
    })
  })

  it('rejects note substituting for rejection reason (§2.9)', () => {
    expect(validateFeedbackNote('some note', 'rejected', undefined)).toEqual({
      valid: false,
      error: expect.stringContaining('must carry an enumerated reason'),
    })
  })

  it('allows note with rejection reason present', () => {
    expect(validateFeedbackNote('some note', 'rejected', 'factual_error')).toEqual({ valid: true })
  })

  it('allows note on non-rejected types without reason', () => {
    expect(validateFeedbackNote('note', 'accepted', undefined)).toEqual({ valid: true })
    expect(validateFeedbackNote('note', 'skipped', undefined)).toEqual({ valid: true })
  })
})

// ===========================================================================
// §2.10 采纳率口径写死
// ===========================================================================

describe('computeAdoptionRate', () => {
  it('excludes pending from denominator', () => {
    const result = computeAdoptionRate(10, 5, 3, 2, 100)
    // denominator = 10 + 5 + 3 + 2 = 20 (pending excluded)
    expect(result.denominator).toBe(20)
    expect(result.pending).toBe(100)
  })

  it('includes skipped in denominator but reports separately', () => {
    const result = computeAdoptionRate(10, 5, 3, 2, 0)
    expect(result.skipped).toBe(2)
    expect(result.denominator).toBe(20)
  })

  it('computes adoption rate as (accepted + modified) / denominator', () => {
    const result = computeAdoptionRate(10, 5, 3, 2, 0)
    // (10 + 5) / 20 = 0.75
    expect(result.adoptionRate).toBe(0.75)
  })

  it('returns null adoption rate when denominator is zero', () => {
    const result = computeAdoptionRate(0, 0, 0, 0, 5)
    expect(result.adoptionRate).toBeNull()
    expect(result.denominator).toBe(0)
  })

  it('computes coverage as denominator / (denominator + pending)', () => {
    const result = computeAdoptionRate(10, 5, 3, 2, 80)
    // coverage = 20 / 100 = 0.2
    expect(result.coverage).toBe(0.2)
  })

  it('coverage is 1 when no pending', () => {
    const result = computeAdoptionRate(10, 5, 3, 2, 0)
    expect(result.coverage).toBe(1)
  })

  it('coverage is 0 when all pending', () => {
    const result = computeAdoptionRate(0, 0, 0, 0, 10)
    expect(result.coverage).toBe(0)
  })

  it('modified and accepted remain separate in result', () => {
    const result = computeAdoptionRate(10, 5, 3, 2, 0)
    expect(result.accepted).toBe(10)
    expect(result.modified).toBe(5)
    // They are not merged
    expect(result.accepted + result.modified).toBe(15)
  })
})

// ===========================================================================
// §2.12 禁止键 sanitizer
// ===========================================================================

describe('feedbackDetectForbiddenKeys', () => {
  it('detects prompt category', () => {
    const keys = feedbackDetectForbiddenKeys({ promptText: 'hello' })
    expect(keys).toContain('prompt')
  })

  it('detects token category', () => {
    const keys = feedbackDetectForbiddenKeys({ apiToken: 'xxx' })
    expect(keys).toContain('token')
  })

  it('detects secret category', () => {
    const keys = feedbackDetectForbiddenKeys({ mySecret: 'xxx' })
    expect(keys).toContain('secret')
  })

  it('returns empty for clean input', () => {
    const keys = feedbackDetectForbiddenKeys({
      feedbackType: 'accepted',
      note: 'looks good',
    })
    expect(keys).toHaveLength(0)
  })

  it('returns empty for null/undefined', () => {
    expect(feedbackDetectForbiddenKeys(null)).toHaveLength(0)
    expect(feedbackDetectForbiddenKeys(undefined)).toHaveLength(0)
  })

  it('feedbackHasForbiddenKeys returns boolean', () => {
    expect(feedbackHasForbiddenKeys({ promptText: 'x' })).toBe(true)
    expect(feedbackHasForbiddenKeys({ note: 'x' })).toBe(false)
  })
})

// ===========================================================================
// §4.5 去重键确定性
// ===========================================================================

describe('computeFeedbackDeduplicationKey', () => {
  it('produces deterministic key', () => {
    const key1 = computeFeedbackDeduplicationKey('draft_layer_change', 'abc', 101)
    const key2 = computeFeedbackDeduplicationKey('draft_layer_change', 'abc', 101)
    expect(key1).toBe(key2)
  })

  it('different artifact IDs produce different keys', () => {
    const key1 = computeFeedbackDeduplicationKey('draft_layer_change', 'abc', 101)
    const key2 = computeFeedbackDeduplicationKey('draft_layer_change', 'xyz', 101)
    expect(key1).not.toBe(key2)
  })

  it('different organizations produce different keys', () => {
    const key1 = computeFeedbackDeduplicationKey('draft_layer_change', 'abc', 101)
    const key2 = computeFeedbackDeduplicationKey('draft_layer_change', 'abc', 202)
    expect(key1).not.toBe(key2)
  })
})

// ===========================================================================
// §6.1–§6.3 禁止隐式反馈
// ===========================================================================

describe('Implicit feedback prevention', () => {
  it('all five states are explicit decisions', () => {
    for (const type of FEEDBACK_TYPES) {
      expect(isExplicitDecision(type)).toBe(true)
    }
  })

  it('rejects implicit inaction source', () => {
    expect(
      rejectImplicitFeedback({
        feedbackType: 'rejected',
        sourceEndpoint: 'implicit_inaction',
      }),
    ).toEqual({
      allowed: false,
      reason: expect.stringContaining('Implicit feedback'),
    })
  })

  it('rejects implicit timeout source', () => {
    expect(
      rejectImplicitFeedback({
        feedbackType: 'rejected',
        sourceEndpoint: 'implicit_timeout',
      }),
    ).toEqual({
      allowed: false,
      reason: expect.stringContaining('Implicit feedback'),
    })
  })

  it('allows explicit sources', () => {
    expect(
      rejectImplicitFeedback({
        feedbackType: 'rejected',
        sourceEndpoint: 'copilot_action',
      }),
    ).toEqual({ allowed: true })
  })
})

// ===========================================================================
// §2.13 sanitizer
// ===========================================================================

describe('sanitizeFeedbackEvent', () => {
  it('preserves allowed keys', () => {
    const event = {
      id: 1,
      feedbackType: 'accepted',
      note: 'looks good',
    }
    const sanitized = sanitizeFeedbackEvent(event)
    expect(sanitized.id).toBe(1)
    expect(sanitized.feedbackType).toBe('accepted')
    expect(sanitized.note).toBe('looks good')
  })

  it('strips disallowed keys', () => {
    const event = {
      id: 1,
      feedbackType: 'accepted',
      promptText: 'should be removed',
      apiKey: 'secret-key',
    }
    const sanitized = sanitizeFeedbackEvent(event)
    expect(sanitized.id).toBe(1)
    expect((sanitized as any).promptText).toBeUndefined()
    expect((sanitized as any).apiKey).toBeUndefined()
  })

  it('does not mutate input', () => {
    const event = { id: 1, promptText: 'test' }
    sanitizeFeedbackEvent(event)
    expect(event.promptText).toBe('test')
  })
})
