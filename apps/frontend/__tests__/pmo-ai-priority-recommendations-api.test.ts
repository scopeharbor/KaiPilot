import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetchEnvelope } from '@/lib/api-client'
import {
  pmoAiPriorityRecommendationsKeys,
  fetchPmoRecommendationList,
  fetchPmoRecommendationSummary,
  fetchPmoRecommendationDetail,
  refreshPmoRecommendations,
  generatePmoAiRationale,
  updatePmoRecommendationStatus,
} from '@/lib/api/pmo-ai-priority-recommendations'
import { asMock } from './_mock-types'

// Mock api-client
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: vi.fn(),
}))

describe('PMO AI 优先级推荐 API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── Query Keys ──────────────────────────────────────────────────────────

  describe('query keys', () => {
    it('all key 返回正确的根 key', () => {
      expect(pmoAiPriorityRecommendationsKeys.all).toEqual(['pmo', 'ai-priority-recommendations'])
    })

    it('list key 包含查询参数', () => {
      const keys = pmoAiPriorityRecommendationsKeys.list({ status: 'new', page: 1 })
      expect(keys[0]).toBe('pmo')
      expect(keys[1]).toBe('ai-priority-recommendations')
      expect(keys[2]).toBe('list')
      expect(keys[3]).toEqual({ status: 'new', page: 1 })
    })

    it('list key 无参数时使用空对象', () => {
      const keys = pmoAiPriorityRecommendationsKeys.list()
      expect(keys[3]).toEqual({})
    })

    it('summary key 包含查询参数', () => {
      const keys = pmoAiPriorityRecommendationsKeys.summary({ includeWarnings: true })
      expect(keys[2]).toBe('summary')
      expect(keys[3]).toEqual({ includeWarnings: true })
    })

    it('detail key 包含推薦 ID', () => {
      const keys = pmoAiPriorityRecommendationsKeys.detail(42)
      expect(keys[2]).toBe('detail')
      expect(keys[3]).toBe(42)
    })
  })

  // ─── fetchPmoRecommendationList ──────────────────────────────────────────

  describe('fetchPmoRecommendationList', () => {
    it('无查询参数时构造不带参数的 URL', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: [], meta: {}, summary: {} }))
      await fetchPmoRecommendationList()
      expect(apiFetchEnvelope).toHaveBeenCalledWith('/pmo/ai-priority-recommendations')
    })

    it('有 status 查询参数时 URL 包含 status', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: [], meta: {}, summary: {} }))
      await fetchPmoRecommendationList({ status: 'new' })
      expect(apiFetchEnvelope).toHaveBeenCalledWith(
        expect.stringContaining('/pmo/ai-priority-recommendations?status=new'),
      )
    })

    it('有多个查询参数时正确拼接', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: [], meta: {}, summary: {} }))
      await fetchPmoRecommendationList({ status: 'new', severity: 'critical', page: 1 })
      const url = vi.mocked(apiFetchEnvelope).mock.calls[0]![0]
      expect(url).toContain('status=new')
      expect(url).toContain('severity=critical')
      expect(url).toContain('page=1')
    })
  })

  // ─── fetchPmoRecommendationSummary ───────────────────────────────────────

  describe('fetchPmoRecommendationSummary', () => {
    it('返回 data 字段内的摘要', async () => {
      const mockSummary = { totalCount: 10, newCount: 3 }
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: mockSummary }))
      const result = await fetchPmoRecommendationSummary()
      expect(result).toEqual(mockSummary)
    })
  })

  // ─── fetchPmoRecommendationDetail ────────────────────────────────────────

  describe('fetchPmoRecommendationDetail', () => {
    it('构造正确的详情 URL', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: { record: {} } }))
      await fetchPmoRecommendationDetail(42)
      expect(apiFetchEnvelope).toHaveBeenCalledWith('/pmo/ai-priority-recommendations/42')
    })
  })

  // ─── refreshPmoRecommendations ───────────────────────────────────────────

  describe('refreshPmoRecommendations', () => {
    it('使用 POST 方法刷新', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(
        asMock({ data: [], warnings: [], created: 1, merged: 0 }),
      )
      await refreshPmoRecommendations()
      expect(apiFetchEnvelope).toHaveBeenCalledWith('/pmo/ai-priority-recommendations/refresh', {
        method: 'POST',
      })
    })
  })

  // ─── generatePmoAiRationale ──────────────────────────────────────────────

  describe('generatePmoAiRationale', () => {
    it('发送 POST 请求并传递 idempotencyKey', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: { aiMetadata: {} } }))
      await generatePmoAiRationale(1, { idempotencyKey: 'key-123' })
      expect(apiFetchEnvelope).toHaveBeenCalledWith(
        '/pmo/ai-priority-recommendations/1/ai-rationale',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
  })

  // ─── updatePmoRecommendationStatus ───────────────────────────────────────

  describe('updatePmoRecommendationStatus', () => {
    it('发送审查动作 accept', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: { record: {} } }))
      await updatePmoRecommendationStatus(1, { action: 'accept', reason: '确认需要关注' })
      expect(apiFetchEnvelope).toHaveBeenCalledWith(
        '/pmo/ai-priority-recommendations/1/status',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('发送 snooze 并携带时间', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(asMock({ data: { record: {} } }))
      await updatePmoRecommendationStatus(1, {
        action: 'snooze',
        snoozeUntil: '2026-07-29T00:00:00.000Z',
      })
      expect(apiFetchEnvelope).toHaveBeenCalled()
    })

    it('发送 convert 并携带目标和参数', async () => {
      vi.mocked(apiFetchEnvelope).mockResolvedValue(
        asMock({
          data: { record: {}, conversionIntent: {} },
        }),
      )
      await updatePmoRecommendationStatus(1, {
        action: 'convert',
        convertTarget: 'risk',
        convertParams: { projectId: 1 },
      })
      expect(apiFetchEnvelope).toHaveBeenCalled()
    })
  })
})
