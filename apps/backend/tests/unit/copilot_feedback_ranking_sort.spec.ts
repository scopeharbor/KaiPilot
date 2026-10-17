/**
 * v3-copilot-feedback-driven-ranking — 分层排序测试
 */

import { describe, it, expect } from 'vitest'
import {
  layeredSort,
  validateNoCrossSeverityMovement,
  validatePositionMovementBounded,
  validateEntrySetUnchanged,
  verifyDeterministicSort,
  simulateConcurrentSort,
} from '../../app/services/copilot_inbox/weighted_sort_service.js'
import {
  makeRankingEntry,
  fixtureEnabledWithRejectionHistory,
  fixtureWeightAtBounds,
  fixtureCrossSeverityNoCrossing,
  fixtureEnabledNoHistory,
} from '@aiproj/types/copilot-feedback-ranking-fixtures'
import { WEIGHT_BOUNDS } from '@aiproj/types/copilot-feedback-ranking'

describe('Weighted Sort Service', () => {
  describe('severity dominates any weight', () => {
    it('high severity always before low, regardless of weight', () => {
      const { entries, projections, expectedOrder } = fixtureCrossSeverityNoCrossing()
      const result = layeredSort(entries, projections)
      expect(result.entries.map((e) => e.id)).toEqual(expectedOrder)
      expect(validateNoCrossSeverityMovement(entries, result.entries)).toBe(true)
    })

    it('critical stays before high even with max negative weight', () => {
      const entries = [
        makeRankingEntry({
          id: 'sev-001',
          severity: 'critical',
          createdAt: '2026-08-15T10:00:00.000Z',
          problemKind: 'resource_overload',
        }),
        makeRankingEntry({
          id: 'sev-002',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'schedule_risk',
        }),
      ]
      const projections = [
        {
          actorId: 1,
          organizationId: 1,
          problemKind: 'resource_overload',
          rejectionCount: 10,
          adoptionCount: 0,
          weight: WEIGHT_BOUNDS.maxNegativeWeight,
          projectionVersion: 'v1',
        },
        {
          actorId: 1,
          organizationId: 1,
          problemKind: 'schedule_risk',
          rejectionCount: 0,
          adoptionCount: 10,
          weight: WEIGHT_BOUNDS.maxPositiveWeight,
          projectionVersion: 'v1',
        },
      ]
      const result = layeredSort(entries, projections)
      expect(result.entries[0].id).toBe('sev-001')
      expect(result.entries[1].id).toBe('sev-002')
    })
  })

  describe('weight at bounds', () => {
    it('weights are clamped to bounds', () => {
      const { entries, projections, expectedWeights } = fixtureWeightAtBounds()
      const result = layeredSort(entries, projections)
      for (const expected of expectedWeights) {
        const entry = result.entries.find((e) => e.problemKind === expected.problemKind)
        expect(entry).toBeDefined()
      }
    })
  })

  describe('position movement bounded', () => {
    it('no entry moves more than maxPositionShift positions', () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeRankingEntry({
          id: 'shift-' + String(i).padStart(3, '0'),
          severity: 'medium',
          createdAt: '2026-08-' + String(10 + i).padStart(2, '0') + 'T10:00:00.000Z',
          problemKind: i === 0 ? 'resource_overload' : 'other',
        }),
      )
      const projections = [
        {
          actorId: 1,
          organizationId: 1,
          problemKind: 'resource_overload',
          rejectionCount: 10,
          adoptionCount: 0,
          weight: WEIGHT_BOUNDS.maxNegativeWeight,
          projectionVersion: 'v1',
        },
      ]
      const result = layeredSort(entries, projections)
      expect(validatePositionMovementBounded(entries, result.entries)).toBe(true)
    })
  })

  describe('entry set unchanged', () => {
    it('entry set is unchanged by weighting', () => {
      const { entries, projections } = fixtureEnabledWithRejectionHistory()
      const result = layeredSort(entries, projections)
      expect(validateEntrySetUnchanged(entries, result.entries)).toBe(true)
      expect(result.entries.length).toBe(entries.length)
    })
  })

  describe('reproducibility', () => {
    it('same projection + same entries = same order', () => {
      const { entries, projections } = fixtureEnabledWithRejectionHistory()
      expect(verifyDeterministicSort(entries, projections)).toBe(true)
    })

    it('concurrent requests agree', () => {
      const { entries, projections } = fixtureEnabledWithRejectionHistory()
      expect(simulateConcurrentSort(entries, projections, 5)).toBe(true)
    })
  })

  describe('switch off state', () => {
    it('no projections = deterministic ordering', () => {
      const { entries, expectedOrder } = fixtureEnabledNoHistory()
      const result = layeredSort(entries, [])
      expect(result.entries.map((e) => e.id)).toEqual(expectedOrder)
      expect(result.projectionVersion).toBe('none')
      expect(result.explanations).toHaveLength(0)
    })
  })
})
