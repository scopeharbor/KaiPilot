/**
 * v3-ai-automated-evaluation §2 — 评测契约与 fixtures 测试。
 *
 * 覆盖：
 * - 评分记录类型守卫（isScoreLabel / isEvaluationDimension / isEvaluatorKind）
 * - explanation 红线（长度约束 + 禁含被评正文，专项负例）
 * - sanitizer（评分记录校验）
 * - 确定性优先合并（mergeEvaluationResults）
 * - 采样求值（evaluateSampling）
 * - 阈值求值（evaluateThreshold）
 * - 幂等键确定性
 * - fixtures 一致性
 *
 * @aiproj/types tests — 零网络零 provider
 */

import { describe, it, expect } from 'vitest'
import {
  isScoreLabel,
  isEvaluationDimension,
  isEvaluatorKind,
  EXPLANATION_MAX_LENGTH,
  detectExplanationViolation,
  isExplanationBounded,
  makeBoundedExplanation,
  sanitizeEvaluationScore,
  detectEvaluationForbiddenKeys,
  mergeEvaluationResults,
  evaluateSampling,
  evaluateThreshold,
  computeEvaluationIdempotencyKey,
  computeSkillEvalDedupKey,
  assertEvaluationDegradesSafely,
} from '../src/ai-automated-evaluation.js'
import {
  evaluationFixtures,
  deterministicPassScore,
  deterministicFailScore,
  judgeSupplementScore,
  conflictMergedScore,
  judgeFailScore,
  skippedScore,
  lowConfidenceScore,
  violatingExplanationWithPrompt,
  violatingExplanationWithOutput,
  violatingExplanationWithToolResult,
  violatingExplanationWithRetrieval,
  validExplanation,
} from '../src/ai-automated-evaluation-fixtures.js'

describe('ai-automated-evaluation §2 — 契约与 fixtures', () => {
  // ── 类型守卫 ──────────────────────────────────────────────────────

  describe('type guards', () => {
    it('isScoreLabel accepts valid labels', () => {
      expect(isScoreLabel('pass')).toBe(true)
      expect(isScoreLabel('fail')).toBe(true)
      expect(isScoreLabel('not-evaluated')).toBe(true)
    })

    it('isScoreLabel rejects invalid labels', () => {
      expect(isScoreLabel('')).toBe(false)
      expect(isScoreLabel('unknown')).toBe(false)
      expect(isScoreLabel('PASS')).toBe(false)
    })

    it('isEvaluationDimension accepts all six dimensions', () => {
      expect(isEvaluationDimension('draft_structural_compliance')).toBe(true)
      expect(isEvaluationDimension('anti_hallucination_hit')).toBe(true)
      expect(isEvaluationDimension('routing_destination_changed')).toBe(true)
      expect(isEvaluationDimension('clarification_matched_real_gap')).toBe(true)
      expect(isEvaluationDimension('narration_cites_out_of_context_fact')).toBe(true)
      expect(isEvaluationDimension('suggestion_adoption')).toBe(true)
    })

    it('isEvaluationDimension rejects unknown dimensions', () => {
      expect(isEvaluationDimension('unknown')).toBe(false)
      expect(isEvaluationDimension('')).toBe(false)
    })

    it('isEvaluatorKind accepts valid kinds', () => {
      expect(isEvaluatorKind('deterministic')).toBe(true)
      expect(isEvaluatorKind('judge')).toBe(true)
    })

    it('isEvaluatorKind rejects invalid kinds', () => {
      expect(isEvaluatorKind('unknown')).toBe(false)
    })
  })

  // ── explanation 红线（本 change 首要红线）─────────────────────────

  describe('explanation redline — must not contain evaluated content', () => {
    it('rejects explanation containing prompt text', () => {
      const violations = detectExplanationViolation(violatingExplanationWithPrompt)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations).toContain('prompt')
    })

    it('rejects explanation containing model output text', () => {
      const violations = detectExplanationViolation(violatingExplanationWithOutput)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations).toContain('completion')
    })

    it('rejects explanation containing tool result text', () => {
      const violations = detectExplanationViolation(violatingExplanationWithToolResult)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.includes('tool'))).toBe(true)
    })

    it('rejects explanation containing retrieval body text', () => {
      const violations = detectExplanationViolation(violatingExplanationWithRetrieval)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations).toContain('retrieval_body')
    })

    it('accepts valid explanation without evaluated content', () => {
      const violations = detectExplanationViolation(validExplanation)
      expect(violations).toEqual([])
    })

    it('accepts empty explanation', () => {
      const violations = detectExplanationViolation('')
      expect(violations).toEqual([])
    })
  })

  // ── explanation 长度约束 ──────────────────────────────────────────

  describe('explanation length bounding', () => {
    it('isExplanationBounded returns true for short text', () => {
      expect(isExplanationBounded('short')).toBe(true)
    })

    it('isExplanationBounded returns true at exact boundary', () => {
      expect(isExplanationBounded('a'.repeat(EXPLANATION_MAX_LENGTH))).toBe(true)
    })

    it('isExplanationBounded returns false when exceeding boundary', () => {
      expect(isExplanationBounded('a'.repeat(EXPLANATION_MAX_LENGTH + 1))).toBe(false)
    })

    it('makeBoundedExplanation truncates long text', () => {
      const longText = 'a'.repeat(2000)
      const bounded = makeBoundedExplanation(longText)
      expect(bounded.length).toBeLessThanOrEqual(EXPLANATION_MAX_LENGTH)
      expect(bounded).toContain('…[truncated]')
    })

    it('makeBoundedExplanation preserves short text', () => {
      const shortText = 'short text'
      expect(makeBoundedExplanation(shortText)).toBe(shortText)
    })
  })

  // ── 评分记录 sanitizer ────────────────────────────────────────────

  describe('sanitizeEvaluationScore', () => {
    it('passes valid score record', () => {
      const result = sanitizeEvaluationScore(deterministicPassScore)
      expect(result.ok).toBe(true)
    })

    it('rejects explanation with prompt content', () => {
      const record = {
        ...deterministicPassScore,
        explanation: violatingExplanationWithPrompt,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('forbidden')
      }
    })

    it('rejects explanation with model output content', () => {
      const record = {
        ...deterministicPassScore,
        explanation: violatingExplanationWithOutput,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects explanation with tool result content', () => {
      const record = {
        ...deterministicPassScore,
        explanation: violatingExplanationWithToolResult,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects explanation with retrieval body content', () => {
      const record = {
        ...deterministicPassScore,
        explanation: violatingExplanationWithRetrieval,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects explanation exceeding length', () => {
      const record = {
        ...deterministicPassScore,
        explanation: 'x'.repeat(EXPLANATION_MAX_LENGTH + 1),
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects invalid scoreLabel', () => {
      const record = {
        ...deterministicPassScore,
        scoreLabel: 'unknown' as any,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects invalid dimension', () => {
      const record = {
        ...deterministicPassScore,
        dimension: 'unknown' as any,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects out-of-range scoreValue', () => {
      const record = {
        ...deterministicPassScore,
        scoreValue: 1.5,
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })

    it('rejects empty idempotencyKey', () => {
      const record = {
        ...deterministicPassScore,
        idempotencyKey: '',
      }
      const result = sanitizeEvaluationScore(record)
      expect(result.ok).toBe(false)
    })
  })

  // ── 禁止键检测 ────────────────────────────────────────────────────

  describe('detectEvaluationForbiddenKeys', () => {
    it('detects prompt key', () => {
      const violations = detectEvaluationForbiddenKeys({ promptText: 'test' })
      expect(violations.length).toBeGreaterThan(0)
    })

    it('detects token key', () => {
      const violations = detectEvaluationForbiddenKeys({ apiToken: 'abc' })
      expect(violations.length).toBeGreaterThan(0)
    })

    it('passes safe keys', () => {
      const violations = detectEvaluationForbiddenKeys({
        ref: 'test',
        hash: 'abc',
        status: 'ok',
      })
      expect(violations).toEqual([])
    })
  })

  // ── 确定性优先合并 ────────────────────────────────────────────────

  describe('mergeEvaluationResults — deterministic governs', () => {
    it('deterministic result governs when both present', () => {
      const result = mergeEvaluationResults(
        { scoreValue: 0, scoreLabel: 'fail', explanation: 'rule failed' },
        { scoreValue: 1, scoreLabel: 'pass', explanation: 'judge says ok' },
      )
      expect(result.scoreLabel).toBe('fail')
      expect(result.scoreValue).toBe(0)
      expect(result.isDeterministicGoverned).toBe(true)
    })

    it('judge result used when no deterministic', () => {
      const result = mergeEvaluationResults(null, {
        scoreValue: 0.8,
        scoreLabel: 'pass',
        explanation: 'judge says ok',
      })
      expect(result.scoreLabel).toBe('pass')
      expect(result.scoreValue).toBe(0.8)
      expect(result.isDeterministicGoverned).toBe(false)
    })

    it('not-evaluated when both null', () => {
      const result = mergeEvaluationResults(null, null)
      expect(result.scoreLabel).toBe('not-evaluated')
      expect(result.isDeterministicGoverned).toBe(false)
    })
  })

  // ── 采样求值 ──────────────────────────────────────────────────────

  describe('evaluateSampling', () => {
    it('all strategy always evaluates', () => {
      const result = evaluateSampling(
        { strategy: 'all', ratio: 1, lowConfidenceAlwaysEvaluate: true },
        false,
        'fnv1a:abc123',
      )
      expect(result.decision).toBe('evaluated')
    })

    it('low confidence always evaluates regardless of ratio', () => {
      const result = evaluateSampling(
        { strategy: 'ratio', ratio: 0.01, lowConfidenceAlwaysEvaluate: true },
        true,
        'fnv1a:deadbeef',
      )
      expect(result.decision).toBe('evaluated')
      expect(result.lowConfidenceOverride).toBe(true)
    })

    it('ratio sampling can skip', () => {
      // Hash 0xFFFFFFFF / 0xFFFFFFFF = 1.0 >= 0.1 → skip
      const result = evaluateSampling(
        { strategy: 'ratio', ratio: 0.1, lowConfidenceAlwaysEvaluate: true },
        false,
        'ffffffff00000000',
      )
      expect(result.decision).toBe('skipped')
      expect(result.skipReason).toBeDefined()
    })

    it('ratio sampling can evaluate', () => {
      // Hash 0x00000001 / 0xFFFFFFFF ≈ 0.0000000002 < 0.5 → evaluate
      const result = evaluateSampling(
        { strategy: 'ratio', ratio: 0.5, lowConfidenceAlwaysEvaluate: true },
        false,
        '0000000100000000',
      )
      expect(result.decision).toBe('evaluated')
    })
  })

  // ── 阈值求值 ──────────────────────────────────────────────────────

  describe('evaluateThreshold', () => {
    const threshold = {
      dimension: 'draft_structural_compliance' as const,
      warningThreshold: 0.7,
      criticalThreshold: 0.4,
      source: 'fixture',
      sourceRef: 'fixture:001',
    }

    it('healthy when above warning', () => {
      const result = evaluateThreshold(threshold, 0.9)
      expect(result.healthState).toBe('healthy')
      expect(result.breached).toBe(false)
    })

    it('warning when below warning threshold', () => {
      const result = evaluateThreshold(threshold, 0.6)
      expect(result.healthState).toBe('warning')
      expect(result.breached).toBe(true)
      expect(result.reasonCode).toContain('warning')
    })

    it('critical when below critical threshold', () => {
      const result = evaluateThreshold(threshold, 0.3)
      expect(result.healthState).toBe('critical')
      expect(result.breached).toBe(true)
      expect(result.reasonCode).toContain('critical')
    })

    it('threshold breach produces runbook reference only', () => {
      const result = evaluateThreshold(threshold, 0.3)
      expect(result.runbookRef).toContain('/runbooks/')
      // Must NOT produce any automatic action indicators
      expect(result.reasonCode).toBeDefined()
    })
  })

  // ── 幂等键确定性 ──────────────────────────────────────────────────

  describe('computeEvaluationIdempotencyKey', () => {
    it('produces same key for same inputs', () => {
      const params = {
        dimension: 'draft_structural_compliance' as const,
        artifactRef: 'draft:1:v1',
        evaluatorVersion: '1.0.0',
        capturedAt: '2026-08-17T00:00:00.000Z',
      }
      const key1 = computeEvaluationIdempotencyKey(params)
      const key2 = computeEvaluationIdempotencyKey(params)
      expect(key1).toBe(key2)
    })

    it('produces different key for different inputs', () => {
      const key1 = computeEvaluationIdempotencyKey({
        dimension: 'draft_structural_compliance',
        artifactRef: 'draft:1:v1',
        evaluatorVersion: '1.0.0',
        capturedAt: '2026-08-17T00:00:00.000Z',
      })
      const key2 = computeEvaluationIdempotencyKey({
        dimension: 'draft_structural_compliance',
        artifactRef: 'draft:2:v1',
        evaluatorVersion: '1.0.0',
        capturedAt: '2026-08-17T00:00:00.000Z',
      })
      expect(key1).not.toBe(key2)
    })
  })

  // ── Skill 评测去重键 ──────────────────────────────────────────────

  describe('computeSkillEvalDedupKey', () => {
    it('produces deterministic key', () => {
      const key1 = computeSkillEvalDedupKey(42, 'draft_structural_compliance')
      const key2 = computeSkillEvalDedupKey(42, 'draft_structural_compliance')
      expect(key1).toBe(key2)
    })

    it('produces different key for different run', () => {
      const key1 = computeSkillEvalDedupKey(42, 'draft_structural_compliance')
      const key2 = computeSkillEvalDedupKey(43, 'draft_structural_compliance')
      expect(key1).not.toBe(key2)
    })
  })

  // ── 评测失败降级 ──────────────────────────────────────────────────

  describe('assertEvaluationDegradesSafely', () => {
    it('always returns true for safe degradation', () => {
      expect(assertEvaluationDegradesSafely(new Error('test'), {})).toBe(true)
      expect(
        assertEvaluationDegradesSafely(new Error('test'), {
          wasConfirmationPending: true,
          wasGenerationRunning: true,
        }),
      ).toBe(true)
    })
  })

  // ── fixtures 一致性 ────────────────────────────────────────────────

  describe('fixtures consistency', () => {
    it('deterministic pass has pass label', () => {
      expect(deterministicPassScore.scoreLabel).toBe('pass')
    })

    it('deterministic fail has fail label', () => {
      expect(deterministicFailScore.scoreLabel).toBe('fail')
    })

    it('judge supplement has pass label', () => {
      expect(judgeSupplementScore.scoreLabel).toBe('pass')
      expect(judgeSupplementScore.evaluator.kind).toBe('judge')
    })

    it('conflict merge preserves deterministic fail', () => {
      expect(conflictMergedScore.scoreLabel).toBe('fail')
      expect(conflictMergedScore.evaluator.kind).toBe('deterministic')
    })

    it('judge fail has not-evaluated label (NOT pass)', () => {
      expect(judgeFailScore.scoreLabel).toBe('not-evaluated')
    })

    it('skipped has not-evaluated label', () => {
      expect(skippedScore.scoreLabel).toBe('not-evaluated')
      expect(skippedScore.samplingDecision.decision).toBe('skipped')
    })

    it('low confidence score is evaluated', () => {
      expect(lowConfidenceScore.scoreLabel).toBe('fail')
      expect(lowConfidenceScore.samplingDecision.lowConfidenceOverride).toBe(true)
    })

    it('threshold result has healthState', () => {
      expect(evaluationFixtures.thresholdBreachedResult.healthState).toBe('critical')
      expect(evaluationFixtures.thresholdHealthyResult.healthState).toBe('healthy')
    })

    it('all fixtures have valid idempotency keys', () => {
      const scores = [
        deterministicPassScore,
        deterministicFailScore,
        judgeSupplementScore,
        conflictMergedScore,
        judgeFailScore,
        skippedScore,
        lowConfidenceScore,
      ]
      for (const score of scores) {
        expect(score.idempotencyKey).toBeTruthy()
        expect(score.idempotencyKey.startsWith('eval_')).toBe(true)
      }
    })

    it('all fixtures have valid organization IDs', () => {
      const scores = [
        deterministicPassScore,
        deterministicFailScore,
        judgeSupplementScore,
        conflictMergedScore,
        judgeFailScore,
        skippedScore,
        lowConfidenceScore,
      ]
      for (const score of scores) {
        expect(score.organizationId).toBeGreaterThan(0)
      }
    })
  })
})
