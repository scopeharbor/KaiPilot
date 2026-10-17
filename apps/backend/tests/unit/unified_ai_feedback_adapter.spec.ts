/**
 * v3-unified-ai-feedback-ledger §5 — 端点适配器测试。
 *
 * 测试：
 * - 两端点契约与行为无变化（§5.3）
 * - 映射缺口被显式记录（§5.5）
 * - rating 字段成为声明式缺口
 * - sourceRefs 字段成为声明式缺口
 */

import { describe, it, expect } from 'vitest'
import {
  mapRationaleFeedback,
  mapAssistantFeedback,
} from '../../app/services/unified_ai_feedback/endpoint_adapter.js'

describe('Endpoint adapter', () => {
  describe('mapRationaleFeedback', () => {
    it('maps useful reason to accepted', () => {
      const { event } = mapRationaleFeedback({
        targetType: 'recommendation',
        targetId: 'rec-001',
        reason: 'useful',
        organizationId: 101,
        actorId: 42,
      })
      expect(event.feedbackType).toBe('accepted')
      expect(event.rejectionReason).toBeNull()
      expect(event.sourceEndpoint).toBe('triz_rationale')
      expect(event.artifactKind).toBe('triz_rationale')
    })

    it('maps incorrect reason to rejected with factual_error', () => {
      const { event } = mapRationaleFeedback({
        targetType: 'contradiction',
        targetId: 'con-001',
        reason: 'incorrect',
        organizationId: 101,
        actorId: 42,
      })
      expect(event.feedbackType).toBe('rejected')
      expect(event.rejectionReason).toBe('factual_error')
    })

    it('records rating as gap (§5.5)', () => {
      const { gaps } = mapRationaleFeedback({
        targetType: 'recommendation',
        targetId: 'rec-001',
        reason: 'useful',
        rating: 4,
        organizationId: 101,
        actorId: 42,
      })
      expect(gaps).toContainEqual(expect.stringContaining('rating'))
    })

    it('records sourceRefs as gap (§5.5)', () => {
      const { gaps } = mapRationaleFeedback({
        targetType: 'recommendation',
        targetId: 'rec-001',
        reason: 'useful',
        sourceRefs: [{ type: 'source', id: 's1' }],
        organizationId: 101,
        actorId: 42,
      })
      expect(gaps).toContainEqual(expect.stringContaining('sourceRefs'))
    })

    it('no gaps when optional fields absent', () => {
      const { gaps } = mapRationaleFeedback({
        targetType: 'recommendation',
        targetId: 'rec-001',
        reason: 'useful',
        organizationId: 101,
        actorId: 42,
      })
      expect(gaps).toHaveLength(0)
    })

    it('endpoint behavior unchanged — does not write to DB', () => {
      // The adapter only returns an event object, it doesn't persist
      const { event } = mapRationaleFeedback({
        targetType: 'recommendation',
        targetId: 'rec-001',
        reason: 'useful',
        organizationId: 101,
        actorId: 42,
      })
      expect(event.id).toBe(0) // Not yet persisted
      expect(typeof event.idempotencyKey).toBe('string')
    })
  })

  describe('mapAssistantFeedback', () => {
    it('maps helpful reason to accepted', () => {
      const { event } = mapAssistantFeedback({
        runId: 'run-001',
        reason: 'helpful',
        organizationId: 101,
        actorId: 42,
      })
      expect(event.feedbackType).toBe('accepted')
      expect(event.sourceEndpoint).toBe('triz_assistant')
      expect(event.artifactKind).toBe('triz_rationale')
    })

    it('maps not_helpful to rejected', () => {
      const { event } = mapAssistantFeedback({
        runId: 'run-001',
        reason: 'not_helpful',
        organizationId: 101,
        actorId: 42,
      })
      expect(event.feedbackType).toBe('rejected')
      expect(event.rejectionReason).toBe('other')
    })

    it('records rating as gap', () => {
      const { gaps } = mapAssistantFeedback({
        runId: 'run-001',
        reason: 'helpful',
        rating: 3,
        organizationId: 101,
        actorId: 42,
      })
      expect(gaps.some((g) => g.includes('rating'))).toBe(true)
    })

    it('endpoint behavior unchanged — does not write to DB', () => {
      const { event } = mapAssistantFeedback({
        runId: 'run-001',
        reason: 'helpful',
        organizationId: 101,
        actorId: 42,
      })
      expect(event.id).toBe(0)
    })
  })
})
