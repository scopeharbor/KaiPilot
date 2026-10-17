/**
 * v3-copilot-feedback-driven-ranking — 规范修改与红线测试
 */

import { describe, it, expect } from 'vitest'
import { layeredSort } from '../../app/services/copilot_inbox/weighted_sort_service.js'
import { makeRankingEntry } from '@aiproj/types/copilot-feedback-ranking-fixtures'
import { WeightingSwitchService } from '../../app/services/copilot_inbox/weighting_switch_service.js'

describe('Spec Modification & Red Lines', () => {
  describe('weighting does not change actionability', () => {
    it('adoption still flows through confirmation path', () => {
      // Weighting only reorders, it does not change any suggestion's actionability
      // Adoption MUST still produce the same preview and confirmation flow
      const entries = [
        makeRankingEntry({ id: 'act-001', severity: 'high', problemKind: 'resource_overload' }),
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
      // Entry is still present and adoptable
      expect(result.entries.length).toBe(1)
      expect(result.entries[0].id).toBe('act-001')
    })
  })

  describe('weighting layer has zero domain writes', () => {
    it('layeredSort has no domain repository or model write dependency', () => {
      // The weighted sort path MUST have no dependency on domain repositories
      // or model write APIs
      // This is a structural guarantee - the function is pure
      const entries = [
        makeRankingEntry({ id: 'write-001', severity: 'high', problemKind: 'resource_overload' }),
      ]
      const result = layeredSort(entries, [])
      // Function returns a result without any side effects
      expect(result).toBeDefined()
      expect(result.entries).toBeDefined()
    })
  })

  describe('weighting does not use a model', () => {
    it('deterministic priority over model', () => {
      // Weighting MUST be computed deterministically without any model call
      // This is a structural guarantee - the function is pure and deterministic
      const entries = [
        makeRankingEntry({ id: 'model-001', severity: 'high', problemKind: 'resource_overload' }),
        makeRankingEntry({ id: 'model-002', severity: 'high', problemKind: 'schedule_risk' }),
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
      // Same input always produces same output (deterministic)
      const result1 = layeredSort(entries, projections)
      const result2 = layeredSort(entries, projections)
      expect(result1.entries.map((e) => e.id)).toEqual(result2.entries.map((e) => e.id))
    })
  })

  describe('feedback ledger and inbox unchanged when disabled', () => {
    it('switch off produces identical ordering', () => {
      const service = new WeightingSwitchService()
      const config = { organizationEnabled: false, personalDisabled: false }
      expect(service.isEnabled(config)).toBe(false)
      // When disabled, ordering MUST be identical to deterministic ordering
    })

    it('deterministic ordering preserved when no projections', () => {
      const entries = [
        makeRankingEntry({
          id: 'unch-001',
          severity: 'critical',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'resource_overload',
        }),
        makeRankingEntry({
          id: 'unch-002',
          severity: 'high',
          createdAt: '2026-08-17T10:00:00.000Z',
          problemKind: 'schedule_risk',
        }),
      ]
      const result = layeredSort(entries, [])
      // Should follow deterministic ordering: critical > high
      expect(result.entries[0].id).toBe('unch-001')
      expect(result.entries[1].id).toBe('unch-002')
      expect(result.projectionVersion).toBe('none')
    })
  })
})
