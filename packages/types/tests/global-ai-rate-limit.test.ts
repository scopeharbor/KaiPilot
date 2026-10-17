/**
 * v3-global-ai-rate-limiting —— 全局限流契约测试。
 *
 * 验证：
 * - 确定性重试建议计算
 * - 多层叠加取最严格者
 * - 决策记录 sanitizer
 * - 类型守卫
 * - 决策 ID 派生确定性
 */

import { describe, expect, it } from 'vitest'
import {
  computeRetryAfterSeconds,
  resolveStrictestLimit,
  rateLimitDecisionFindDisallowedKeys,
  rateLimitDecisionHasForbiddenKeys,
  computeRateLimitDecisionId,
  isRateLimitDimension,
  isRateLimitLayer,
  isRateLimitDecision,
  isRateLimitFailurePosture,
  RATE_LIMIT_DIMENSIONS,
  RATE_LIMIT_LAYERS,
  RATE_LIMIT_DECISIONS,
  RATE_LIMIT_FAILURE_POSTURES,
  DEFAULT_ACTOR_FAIRNESS_SHARE,
} from '../src/global-ai-rate-limit.js'

describe('global-ai-rate-limit', () => {
  // ---------------------------------------------------------------------------
  // §2.10 确定性重试建议计算
  // ---------------------------------------------------------------------------

  describe('computeRetryAfterSeconds', () => {
    it('should return deterministic retry suggestion for same window state', () => {
      const windowStart = '2026-08-17T15:00:00.000Z'
      const windowEnd = '2026-08-17T15:01:00.000Z'
      const now = '2026-08-17T15:00:30.000Z'

      const result1 = computeRetryAfterSeconds(windowStart, windowEnd, now)
      const result2 = computeRetryAfterSeconds(windowStart, windowEnd, now)

      expect(result1).toBe(result2)
      expect(result1).toBe(30) // 30 seconds remaining
    })

    it('should return 0 when window has expired', () => {
      const windowStart = '2026-08-17T15:00:00.000Z'
      const windowEnd = '2026-08-17T15:01:00.000Z'
      const now = '2026-08-17T15:02:00.000Z'

      const result = computeRetryAfterSeconds(windowStart, windowEnd, now)
      expect(result).toBe(0)
    })

    it('should return full window duration when now is at window start', () => {
      const windowStart = '2026-08-17T15:00:00.000Z'
      const windowEnd = '2026-08-17T15:01:00.000Z'
      const now = '2026-08-17T15:00:00.000Z'

      const result = computeRetryAfterSeconds(windowStart, windowEnd, now)
      expect(result).toBe(60)
    })
  })

  // ---------------------------------------------------------------------------
  // §2.11 多层叠加取最严格者
  // ---------------------------------------------------------------------------

  describe('resolveStrictestLimit', () => {
    it('should return strictest limit and triggering layer', () => {
      const limits = [
        { layer: 'connection' as const, limit: 100 },
        { layer: 'model' as const, limit: 50 },
        { layer: 'organization' as const, limit: 200 },
      ]

      const result = resolveStrictestLimit(limits)
      expect(result.limit).toBe(50)
      expect(result.triggeringLayer).toBe('model')
    })

    it('should ignore null limits (unconstrained)', () => {
      const limits = [
        { layer: 'connection' as const, limit: null },
        { layer: 'model' as const, limit: 50 },
        { layer: 'organization' as const, limit: null },
      ]

      const result = resolveStrictestLimit(limits)
      expect(result.limit).toBe(50)
      expect(result.triggeringLayer).toBe('model')
    })

    it('should return null when all limits are unconstrained', () => {
      const limits = [
        { layer: 'connection' as const, limit: null },
        { layer: 'model' as const, limit: null },
        { layer: 'organization' as const, limit: null },
      ]

      const result = resolveStrictestLimit(limits)
      expect(result.limit).toBeNull()
      expect(result.triggeringLayer).toBeNull()
    })

    it('should not take most permissive', () => {
      const limits = [
        { layer: 'connection' as const, limit: 10 },
        { layer: 'model' as const, limit: 100 },
        { layer: 'organization' as const, limit: 1000 },
      ]

      const result = resolveStrictestLimit(limits)
      expect(result.limit).toBe(10)
      expect(result.triggeringLayer).toBe('connection')
    })
  })

  // ---------------------------------------------------------------------------
  // §2.12 决策记录 sanitizer
  // ---------------------------------------------------------------------------

  describe('rateLimitDecision sanitizer', () => {
    it('should find disallowed keys', () => {
      const record = {
        decisionId: 'abc',
        organizationId: 1,
        prompt: 'test', // forbidden
        completion: 'result', // forbidden
      }

      const disallowed = rateLimitDecisionFindDisallowedKeys(record)
      expect(disallowed).toContain('prompt')
      expect(disallowed).toContain('completion')
      expect(disallowed).not.toContain('decisionId')
      expect(disallowed).not.toContain('organizationId')
    })

    it('should detect forbidden keys', () => {
      const record = {
        decisionId: 'abc',
        apiKey: 'secret', // forbidden
      }

      expect(rateLimitDecisionHasForbiddenKeys(record)).toBe(true)
    })

    it('should allow clean records', () => {
      const record = {
        decisionId: 'abc',
        organizationId: 1,
        dimension: 'rpm',
        limit: 100,
        currentCount: 50,
        decision: 'allow',
      }

      expect(rateLimitDecisionHasForbiddenKeys(record)).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // §2.13 确定性决策 ID 派生
  // ---------------------------------------------------------------------------

  describe('computeRateLimitDecisionId', () => {
    it('should produce deterministic ID for same input', () => {
      const input = {
        organizationId: 1,
        connectionId: 10,
        modelId: 20,
        actorId: 30,
        dimension: 'rpm' as const,
        windowStart: '2026-08-17T15:00:00.000Z',
        attemptId: 'attempt-123',
      }

      const id1 = computeRateLimitDecisionId(input)
      const id2 = computeRateLimitDecisionId(input)

      expect(id1).toBe(id2)
      expect(id1).toHaveLength(32)
    })

    it('should produce different IDs for different inputs', () => {
      const input1 = {
        organizationId: 1,
        connectionId: 10,
        modelId: 20,
        actorId: 30,
        dimension: 'rpm' as const,
        windowStart: '2026-08-17T15:00:00.000Z',
        attemptId: 'attempt-123',
      }

      const input2 = {
        ...input1,
        organizationId: 2,
      }

      const id1 = computeRateLimitDecisionId(input1)
      const id2 = computeRateLimitDecisionId(input2)

      expect(id1).not.toBe(id2)
    })
  })

  // ---------------------------------------------------------------------------
  // §2.14 类型守卫
  // ---------------------------------------------------------------------------

  describe('type guards', () => {
    it('should validate RateLimitDimension', () => {
      expect(isRateLimitDimension('rpm')).toBe(true)
      expect(isRateLimitDimension('tpm')).toBe(true)
      expect(isRateLimitDimension('cost')).toBe(false)
      expect(isRateLimitDimension(null)).toBe(false)
    })

    it('should validate RateLimitLayer', () => {
      expect(isRateLimitLayer('connection')).toBe(true)
      expect(isRateLimitLayer('model')).toBe(true)
      expect(isRateLimitLayer('organization')).toBe(true)
      expect(isRateLimitLayer('actor')).toBe(true)
      expect(isRateLimitLayer('global')).toBe(false)
    })

    it('should validate RateLimitDecision', () => {
      expect(isRateLimitDecision('allow')).toBe(true)
      expect(isRateLimitDecision('throttle')).toBe(true)
      expect(isRateLimitDecision('reject')).toBe(true)
      expect(isRateLimitDecision('pending')).toBe(false)
    })

    it('should validate RateLimitFailurePosture', () => {
      expect(isRateLimitFailurePosture('conservative_reject')).toBe(true)
      expect(isRateLimitFailurePosture('last_known_with_warning')).toBe(true)
      expect(isRateLimitFailurePosture('allow')).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // §2.15 常量验证
  // ---------------------------------------------------------------------------

  describe('constants', () => {
    it('should have correct dimensions', () => {
      expect(RATE_LIMIT_DIMENSIONS).toEqual(['rpm', 'tpm'])
    })

    it('should have correct layers', () => {
      expect(RATE_LIMIT_LAYERS).toEqual(['connection', 'model', 'organization', 'actor'])
    })

    it('should have correct decisions', () => {
      expect(RATE_LIMIT_DECISIONS).toEqual(['allow', 'throttle', 'reject'])
    })

    it('should have correct failure postures', () => {
      expect(RATE_LIMIT_FAILURE_POSTURES).toEqual([
        'conservative_reject',
        'last_known_with_warning',
      ])
    })

    it('should have correct default actor fairness share', () => {
      expect(DEFAULT_ACTOR_FAIRNESS_SHARE).toBe(0.5)
    })
  })
})
