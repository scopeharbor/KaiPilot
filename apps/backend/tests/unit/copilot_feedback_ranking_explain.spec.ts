/**
 * v3-copilot-feedback-driven-ranking — 可解释性测试
 */

import { describe, it, expect } from 'vitest'
import { layeredSort } from '../../app/services/copilot_inbox/weighted_sort_service.js'
import { makeRankingEntry } from '@aiproj/types/copilot-feedback-ranking-fixtures'

describe('Explainability', () => {
  describe('moved entry explains itself', () => {
    it('down-weighted entry carries explanation with dismissal count', () => {
      const entries = [
        makeRankingEntry({
          id: 'exp-001',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'resource_overload',
        }),
        makeRankingEntry({
          id: 'exp-002',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'schedule_risk',
        }),
        makeRankingEntry({
          id: 'exp-003',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'dependency_block',
        }),
      ]
      const projections = [
        {
          actorId: 1,
          organizationId: 1,
          problemKind: 'resource_overload',
          rejectionCount: 3,
          adoptionCount: 0,
          weight: -3,
          projectionVersion: 'v1',
        },
      ]
      const result = layeredSort(entries, projections)
      // exp-001 (resource_overload, weight -3) moves from pos 0 DOWN
      // With bounded reorder: target = 0 - (-3) = 3, clamped to 2 (max index)
      // exp-002 (schedule_risk, weight 0): target = 1 - 0 = 1
      // exp-003 (dependency_block, weight 0): target = 2 - 0 = 2
      // Sorted by target: [exp-002(target1), exp-001(target2), exp-003(target2)]
      // Tie-break: exp-001 (orig 0) < exp-003 (orig 2) → [exp-002, exp-001, exp-003]
      // exp-001 moved from pos 0 to pos 1 → explanation should exist
      const explanation = result.explanations.find((e) => e.entryId === 'exp-001')
      expect(explanation).toBeDefined()
      expect(explanation?.rejectionCount).toBe(3)
      expect(explanation?.reason).toContain('3')
    })
  })

  describe('unmoved entries carry no explanation', () => {
    it('no movement = empty explanation set', () => {
      const entries = [
        makeRankingEntry({
          id: 'exp-004',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'resource_overload',
        }),
        makeRankingEntry({
          id: 'exp-005',
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
          rejectionCount: 0,
          adoptionCount: 1,
          weight: 0,
          projectionVersion: 'v1',
        },
      ]
      const result = layeredSort(entries, projections)
      expect(result.explanations).toHaveLength(0)
    })

    it('explanation set is empty when no entry moves', () => {
      const entries = [
        makeRankingEntry({
          id: 'exp-006',
          severity: 'critical',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'resource_overload',
        }),
        makeRankingEntry({
          id: 'exp-007',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'schedule_risk',
        }),
      ]
      const result = layeredSort(entries, [])
      expect(result.explanations).toHaveLength(0)
    })
  })
})
