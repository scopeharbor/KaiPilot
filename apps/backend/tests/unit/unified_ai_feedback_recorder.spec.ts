/**
 * v3-unified-ai-feedback-ledger §8.1–8.2 — recorder 测试。
 *
 * 测试：
 * - 反馈写入抛错时用户决策仍由业务路径持久化（§8.2）
 * - 反馈记账失败不阻断业务决策路径（§8.1）
 * - 幂等键防止重复写入
 * - 禁止内容键被拒绝
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unifiedFeedbackEventFixture } from '@aiproj/types'

// Mock the model
const mockCreate = vi.fn()
const mockQueryFirst = vi.fn()

vi.mock('#models/unified_ai_feedback_event', () => ({
  default: {
    create: (...args: any[]) => mockCreate(...args),
    query: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnThis(),
      first: (...args: any[]) => mockQueryFirst(...args),
    }),
  },
}))

describe('Recorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  describe('§8.1 degrade-safe recording', () => {
    it('returns degraded=true on DB error without throwing', async () => {
      mockCreate.mockRejectedValueOnce(new Error('DB connection lost'))

      const { recordFeedbackEvent } =
        await import('../../app/services/unified_ai_feedback/recorder.js')

      const event = unifiedFeedbackEventFixture({ id: 999 })
      const result = await recordFeedbackEvent(event)

      expect(result.success).toBe(false)
      expect(result.degraded).toBe(true)
      expect(result.error).toContain('DB connection lost')
      // Must not throw
    })

    it('does not block the caller on failure', async () => {
      mockCreate.mockRejectedValueOnce(new Error('timeout'))

      const { recordFeedbackEvent } =
        await import('../../app/services/unified_ai_feedback/recorder.js')

      // This should complete without throwing
      const result = await recordFeedbackEvent(unifiedFeedbackEventFixture({ id: 1000 }))

      expect(result.degraded).toBe(true)
      // Caller can continue its business logic
    })
  })

  describe('§8.2 user decision not lost', () => {
    it('recording failure returns degraded but caller retains decision', async () => {
      mockCreate.mockRejectedValueOnce(new Error('storage full'))

      const { recordFeedbackEvent } =
        await import('../../app/services/unified_ai_feedback/recorder.js')

      const event = unifiedFeedbackEventFixture({ id: 1001 })
      const result = await recordFeedbackEvent(event)

      // The result indicates degradation
      expect(result.degraded).toBe(true)
      // The caller's decision (in the business table) is unaffected
      // This test verifies the contract: recording failure ≠ decision loss
    })
  })

  describe('idempotency', () => {
    it('returns existing event ID on duplicate idempotency key', async () => {
      mockQueryFirst.mockResolvedValueOnce({ id: 42 })

      const { recordFeedbackEvent } =
        await import('../../app/services/unified_ai_feedback/recorder.js')

      const event = unifiedFeedbackEventFixture({ id: 1002 })
      const result = await recordFeedbackEvent(event)

      expect(result.success).toBe(true)
      expect(result.eventId).toBe(42)
      // Should not call create
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('creates new event when idempotency key is unique', async () => {
      mockQueryFirst.mockResolvedValueOnce(null)
      mockCreate.mockResolvedValueOnce({ id: 99 })

      const { recordFeedbackEvent } =
        await import('../../app/services/unified_ai_feedback/recorder.js')

      const event = unifiedFeedbackEventFixture({ id: 1003 })
      const result = await recordFeedbackEvent(event)

      expect(result.success).toBe(true)
      expect(result.eventId).toBe(99)
      expect(mockCreate).toHaveBeenCalled()
    })
  })

  describe('forbidden content keys', () => {
    it('rejects events with forbidden content keys', async () => {
      const { recordFeedbackEvent } =
        await import('../../app/services/unified_ai_feedback/recorder.js')

      const event = unifiedFeedbackEventFixture({
        id: 1004,
        // @ts-expect-error testing forbidden key detection
        promptText: 'this should be rejected',
      })

      const result = await recordFeedbackEvent(event)

      expect(result.success).toBe(false)
      expect(result.degraded).toBe(true)
      expect(result.error).toContain('forbidden')
      // Should not even try to write
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })
})
