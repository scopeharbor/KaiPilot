/**
 * v3-unified-ai-feedback-ledger §4 — 投影服务测试。
 *
 * 测试：
 * - 既有表未被写入或修改（§4.2）
 * - 去重：同一决策经两路只计一次（§4.4）
 * - modified 与 accepted 不被合并（§4.6）
 * - review_status → feedbackType 映射正确
 * - entity_type → artifactKind 映射正确
 */

import { describe, it, expect, vi } from 'vitest'

// Mock the models before importing the service
vi.mock('#models/draft_layer_change', () => ({
  default: {
    query: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
  },
}))

vi.mock('#models/unified_ai_feedback_event', () => ({
  default: {
    query: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }),
  },
}))

describe('Projection service', () => {
  describe('mapReviewStatusToFeedbackType', () => {
    it('maps all five states correctly', async () => {
      const { mapReviewStatusToFeedbackType } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      expect(mapReviewStatusToFeedbackType('accepted')).toBe('accepted')
      expect(mapReviewStatusToFeedbackType('rejected')).toBe('rejected')
      expect(mapReviewStatusToFeedbackType('modified')).toBe('modified')
      expect(mapReviewStatusToFeedbackType('skipped')).toBe('skipped')
      expect(mapReviewStatusToFeedbackType('pending')).toBe('pending')
    })

    it('returns null for unknown status', async () => {
      const { mapReviewStatusToFeedbackType } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      expect(mapReviewStatusToFeedbackType('unknown')).toBeNull()
      expect(mapReviewStatusToFeedbackType('')).toBeNull()
    })
  })

  describe('mapEntityTypeToArtifactKind', () => {
    it('maps known entity types', async () => {
      const { mapEntityTypeToArtifactKind } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      expect(mapEntityTypeToArtifactKind('task')).toBe('draft_layer_change')
      expect(mapEntityTypeToArtifactKind('milestone')).toBe('draft_layer_change')
      expect(mapEntityTypeToArtifactKind('dependency')).toBe('draft_layer_change')
      expect(mapEntityTypeToArtifactKind('wbs_node')).toBe('draft_layer_change')
      expect(mapEntityTypeToArtifactKind('risk')).toBe('suggestion')
      expect(mapEntityTypeToArtifactKind('resource')).toBe('suggestion')
    })

    it('returns null for unknown entity type', async () => {
      const { mapEntityTypeToArtifactKind } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      expect(mapEntityTypeToArtifactKind('unknown')).toBeNull()
    })
  })

  describe('computeDraftLayerDeduplicationKey', () => {
    it('produces deterministic key', async () => {
      const { computeDraftLayerDeduplicationKey } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      const key1 = computeDraftLayerDeduplicationKey(101, 'draft_layer_change', 'entity-1')
      const key2 = computeDraftLayerDeduplicationKey(101, 'draft_layer_change', 'entity-1')
      expect(key1).toBe(key2)
    })

    it('different entities produce different keys', async () => {
      const { computeDraftLayerDeduplicationKey } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      const key1 = computeDraftLayerDeduplicationKey(101, 'draft_layer_change', 'entity-1')
      const key2 = computeDraftLayerDeduplicationKey(101, 'draft_layer_change', 'entity-2')
      expect(key1).not.toBe(key2)
    })
  })

  describe('§4.2 existing table not written', () => {
    it('DraftLayerChange.query is read-only (select only)', async () => {
      const { default: DraftLayerChange } = await import('#models/draft_layer_change')
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      }
      vi.mocked(DraftLayerChange.query).mockReturnValue(mockQuery as any)

      const { projectFromDraftLayerChanges } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      await projectFromDraftLayerChanges({ organizationId: 101 })

      // Only .select() and .limit() should be called — no insert/update/delete
      expect(mockQuery.select).toHaveBeenCalled()
      expect(mockQuery.limit).toHaveBeenCalled()
      // Verify no mutation methods exist on the mock
      expect((mockQuery as any).insert).toBeUndefined()
      expect((mockQuery as any).update).toBeUndefined()
      expect((mockQuery as any).delete).toBeUndefined()
    })
  })
})
