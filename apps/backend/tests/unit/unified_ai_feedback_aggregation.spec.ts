/**
 * v3-unified-ai-feedback-ledger §7 — 聚合服务测试。
 *
 * 测试：
 * - 采纳率口径正确（分母排除 pending）（§7.1）
 * - 组件分解输出（§7.2）
 * - 不存在只返回复合值的响应（§7.3）
 * - 拒绝原因分布聚合（§7.4）
 * - 覆盖率返回（§7.5）
 * - 组织隔离（§7.7）
 * - 跨组织不泄露（§7.8）
 * - 下游读接口形状稳定（§7.10）
 */

import { describe, it, expect, vi } from 'vitest'
import {
  FEEDBACK_FIXTURE_ORG_A,
  feedbackAcceptedFixture,
  feedbackRejectedFixture,
  feedbackModifiedFixture,
  feedbackSkippedFixture,
  feedbackPendingFixture,
  feedbackCrossOrgFixture,
} from '@aiproj/types'

// Mock the combined projection
vi.mock('../../app/services/unified_ai_feedback/projection_service.js', () => ({
  combinedProjection: vi.fn(),
  projectFromDraftLayerChanges: vi.fn().mockResolvedValue([]),
  queryFeedbackEvents: vi.fn().mockResolvedValue([]),
}))

vi.mock('#models/unified_ai_feedback_event', () => ({
  default: {
    query: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      paginate: vi.fn().mockResolvedValue({
        all: () => [],
        total: 0,
        currentPage: 1,
        perPage: 50,
        lastPage: 0,
      }),
    }),
  },
}))

describe('Aggregation service', () => {
  describe('§7.1 adoption rate computation', () => {
    it('excludes pending from denominator', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([
        feedbackAcceptedFixture({ id: 1 }),
        feedbackAcceptedFixture({ id: 2 }),
        feedbackModifiedFixture({ id: 3 }),
        feedbackRejectedFixture({ id: 4 }),
        feedbackSkippedFixture({ id: 5 }),
        feedbackPendingFixture({ id: 6 }),
        feedbackPendingFixture({ id: 7 }),
      ])

      const { aggregateAdoptionRate } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await aggregateAdoptionRate({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      // denominator = 2 accepted + 1 modified + 1 rejected + 1 skipped = 5
      expect(result.denominator).toBe(5)
      expect(result.pending).toBe(2)
      // adoptionRate = (2+1)/5 = 0.6
      expect(result.adoptionRate).toBe(0.6)
    })
  })

  describe('§7.2 components always accompany composite', () => {
    it('result contains all four components', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([
        feedbackAcceptedFixture({ id: 1 }),
        feedbackModifiedFixture({ id: 2 }),
        feedbackRejectedFixture({ id: 3 }),
        feedbackSkippedFixture({ id: 4 }),
      ])

      const { aggregateAdoptionRate } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await aggregateAdoptionRate({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      // Must have all components
      expect(result.accepted).toBeDefined()
      expect(result.modified).toBeDefined()
      expect(result.rejected).toBeDefined()
      expect(result.skipped).toBeDefined()
      expect(result.pending).toBeDefined()
    })
  })

  describe('§7.3 no composite-only response', () => {
    it('response shape always includes components', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([feedbackAcceptedFixture({ id: 1 })])

      const { aggregateAdoptionRate } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await aggregateAdoptionRate({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      // Verify no "rate" field exists without components
      const keys = Object.keys(result)
      expect(keys).toContain('accepted')
      expect(keys).toContain('modified')
      expect(keys).toContain('rejected')
      expect(keys).toContain('skipped')
      expect(keys).toContain('adoptionRate')
    })
  })

  describe('§7.4 rejection reason distribution', () => {
    it('returns distribution across enumerated reasons', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([
        feedbackRejectedFixture({ id: 1, rejectionReason: 'factual_error' }),
        feedbackRejectedFixture({ id: 2, rejectionReason: 'factual_error' }),
        feedbackRejectedFixture({ id: 3, rejectionReason: 'wrong_granularity' }),
      ])

      const { aggregateAdoptionRate } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await aggregateAdoptionRate({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      expect(result.rejectionDistribution.length).toBe(7) // 7 enumerated reasons
      const factualError = result.rejectionDistribution.find((d) => d.reason === 'factual_error')
      expect(factualError?.count).toBe(2)
      expect(factualError?.proportion).toBeCloseTo(2 / 3)
    })
  })

  describe('§7.5 coverage accompanies rate', () => {
    it('coverage is computed', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([feedbackAcceptedFixture({ id: 1 })])

      const { aggregateAdoptionRate } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await aggregateAdoptionRate({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      expect(result.coverage).toBeDefined()
      expect(typeof result.coverage).toBe('number')
    })
  })

  describe('§7.7 organization isolation', () => {
    it('filters by organization', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      const { orgA, orgB } = feedbackCrossOrgFixture()
      // Mock returns only orgA events when called with orgA's ID
      vi.mocked(combinedProjection).mockImplementation(async (orgId: number) => {
        return orgId === FEEDBACK_FIXTURE_ORG_A ? [orgA] : [orgB]
      })

      const { aggregateAdoptionRate } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await aggregateAdoptionRate({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      // Only orgA events counted (1 event)
      expect(
        result.accepted + result.modified + result.rejected + result.skipped + result.pending,
      ).toBe(1)
    })
  })

  describe('§7.9 downstream summary', () => {
    it('exposes type counts and adoption rate', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([
        feedbackAcceptedFixture({ id: 1 }),
        feedbackModifiedFixture({ id: 2 }),
        feedbackRejectedFixture({ id: 3 }),
      ])

      const { downstreamSummary } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await downstreamSummary({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      expect(result.typeCounts.accepted).toBe(1)
      expect(result.typeCounts.modified).toBe(1)
      expect(result.typeCounts.rejected).toBe(1)
      expect(result.adoptionRate).toBeDefined()
    })

    it('does not expose stored content', async () => {
      const { combinedProjection } =
        await import('../../app/services/unified_ai_feedback/projection_service.js')
      vi.mocked(combinedProjection).mockResolvedValue([feedbackAcceptedFixture({ id: 1 })])

      const { downstreamSummary } =
        await import('../../app/services/unified_ai_feedback/aggregation_service.js')
      const result = await downstreamSummary({ organizationId: FEEDBACK_FIXTURE_ORG_A })

      // Must not expose content
      expect((result as any).promptText).toBeUndefined()
      expect((result as any).proposedContentHash).toBeUndefined()
    })
  })
})
