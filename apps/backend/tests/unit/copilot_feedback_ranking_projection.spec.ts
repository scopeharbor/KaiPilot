/**
 * v3-copilot-feedback-driven-ranking — 冻结投影测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateFrozenProjection,
  generateProjectionVersion,
  getFrozenProjection,
  updateFrozenProjection,
  clearProjectionCache,
} from '../../app/services/copilot_inbox/frozen_projection_service.js'
import type { UnifiedFeedbackEvent } from '@aiproj/types'

function makeEvent(overrides: Partial<UnifiedFeedbackEvent> = {}): UnifiedFeedbackEvent {
  return {
    id: 1,
    organizationId: 1,
    projectId: null,
    artifactKind: 'draft_layer_change',
    artifactId: 'artifact-001',
    capabilitySurface: 'draft',
    feedbackType: 'rejected',
    rejectionReason: null,
    modificationFingerprint: null,
    note: null,
    proposedContentHash: null,
    finalContentHash: null,
    actorId: 100,
    idempotencyKey: 'idem-001',
    sourceEndpoint: 'draft_layer_projection',
    sourceRef: null,
    deduplicationKey: null,
    occurredAt: '2026-08-18T10:00:00.000Z',
    createdAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  }
}

describe('Frozen Projection Service', () => {
  beforeEach(() => {
    clearProjectionCache()
  })

  describe('same projection version + same entries = same order', () => {
    it('generates deterministic projections', () => {
      const events = [
        makeEvent({
          id: 1,
          actorId: 100,
          artifactKind: 'copilot_action',
          feedbackType: 'rejected',
        }),
        makeEvent({
          id: 2,
          actorId: 100,
          artifactKind: 'copilot_action',
          feedbackType: 'rejected',
        }),
        makeEvent({
          id: 3,
          actorId: 100,
          artifactKind: 'draft_layer_change',
          feedbackType: 'accepted',
        }),
      ]
      const proj1 = generateFrozenProjection(events, { organizationId: 1, projectionVersion: 'v1' })
      const proj2 = generateFrozenProjection(events, { organizationId: 1, projectionVersion: 'v1' })
      expect(proj1).toEqual(proj2)
    })
  })

  describe('concurrent consistency', () => {
    it('multiple calls with same input produce same output', () => {
      const events = [
        makeEvent({
          id: 1,
          actorId: 100,
          artifactKind: 'copilot_action',
          feedbackType: 'rejected',
        }),
      ]
      const results = Array.from({ length: 5 }, () =>
        generateFrozenProjection(events, { organizationId: 1, projectionVersion: 'v1' }),
      )
      expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true)
    })
  })

  describe('recomputation does not expose partial state', () => {
    it('old version remains readable during update', () => {
      const oldSnapshot = { version: 'old', generatedAt: '2026-08-18T10:00:00.000Z', entries: [] }
      const newSnapshot = { version: 'new', generatedAt: '2026-08-18T11:00:00.000Z', entries: [] }
      updateFrozenProjection(oldSnapshot)
      expect(getFrozenProjection()?.version).toBe('old')
      updateFrozenProjection(newSnapshot)
      expect(getFrozenProjection()?.version).toBe('new')
    })
  })

  describe('projection version', () => {
    it('same events produce same version (deterministic)', () => {
      const events = [makeEvent({ id: 1 })]
      const v1 = generateProjectionVersion(events)
      const v2 = generateProjectionVersion(events)
      expect(v1).toBe(v2)
    })

    it('different events produce different versions', () => {
      const v1 = generateProjectionVersion([makeEvent({ id: 1 })])
      const v2 = generateProjectionVersion([makeEvent({ id: 2 })])
      expect(v1).not.toBe(v2)
    })
  })

  describe('organization isolation', () => {
    it('events from other organizations are excluded', () => {
      const events = [
        makeEvent({
          id: 1,
          organizationId: 1,
          actorId: 100,
          artifactKind: 'copilot_action',
          feedbackType: 'rejected',
        }),
        makeEvent({
          id: 2,
          organizationId: 2,
          actorId: 100,
          artifactKind: 'copilot_action',
          feedbackType: 'rejected',
        }),
      ]
      const proj = generateFrozenProjection(events, { organizationId: 1, projectionVersion: 'v1' })
      expect(proj.length).toBe(1)
      expect(proj[0].organizationId).toBe(1)
    })
  })
})
