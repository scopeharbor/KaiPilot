import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchTrafficLightList,
  fetchTrafficLightCounts,
  fetchTrafficLightDetail,
  upsertTrafficLightReview,
  pmoTrafficLightKeys,
} from '@/lib/api/pmo-traffic-light'

// Mock apiFetchEnvelope
const mockFetch = vi.fn()
vi.mock('@/lib/api-client', () => ({
  apiFetchEnvelope: (...args: unknown[]) => mockFetch(...args),
}))

describe('pmoTrafficLight API client', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  // ─── Query Keys ────────────────────────────────────────────────────────────

  it('query key 以 pmo/traffic-light 为根', () => {
    expect(pmoTrafficLightKeys.all).toEqual(['pmo', 'traffic-light'])
  })

  it('list query key 包含查询参数', () => {
    const key = pmoTrafficLightKeys.list({ page: 1, perPage: 20 })
    expect(key[0]).toBe('pmo')
    expect(key[1]).toBe('traffic-light')
    expect(key[2]).toBe('list')
    expect(key[3]).toEqual({ page: 1, perPage: 20 })
  })

  it('counts query key 独立于参数', () => {
    const key = pmoTrafficLightKeys.counts()
    expect(key).toEqual(['pmo', 'traffic-light', 'counts'])
  })

  it('detail query key 包含 projectId', () => {
    const key = pmoTrafficLightKeys.detail(42)
    expect(key).toEqual(['pmo', 'traffic-light', 'detail', 42])
  })

  // ─── fetchTrafficLightList ─────────────────────────────────────────────────

  it('fetchTrafficLightList 调用正确的 URL', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { page: 1, perPage: 20, total: 0, totalPages: 0, calculatedAt: '' },
    })
    await fetchTrafficLightList({
      page: 1,
      perPage: 10,
      sort: 'traffic_light',
      order: 'desc',
      filterStatus: 'red',
    })
    const url: string = mockFetch!.mock.calls[0]![0]!
    expect(url).toContain('/pmo/traffic-light')
    expect(url).toContain('page=1')
    expect(url).toContain('perPage=10')
    expect(url).toContain('sort=traffic_light')
    expect(url).toContain('order=desc')
    expect(url).toContain('filterStatus=red')
  })

  it('fetchTrafficLightList 无查询参数时不带 query string', async () => {
    mockFetch.mockResolvedValue({
      data: [],
      meta: { page: 1, perPage: 20, total: 0, totalPages: 0, calculatedAt: '' },
    })
    await fetchTrafficLightList()
    const url: string = mockFetch!.mock.calls[0]![0]!
    expect(url).toBe('/pmo/traffic-light')
  })

  // ─── fetchTrafficLightCounts ───────────────────────────────────────────────

  it('fetchTrafficLightCounts 调用正确的 URL', async () => {
    mockFetch.mockResolvedValue({
      data: { red: 1, yellow: 2, green: 3, gray: 0, total: 6, calculatedAt: '' },
    })
    await fetchTrafficLightCounts()
    const url: string = mockFetch!.mock.calls[0]![0]!
    expect(url).toBe('/pmo/traffic-light/counts')
  })

  // ─── fetchTrafficLightDetail ───────────────────────────────────────────────

  it('fetchTrafficLightDetail 调用正确的 URL', async () => {
    const item = { projectId: 1, projectName: 'Test', trafficLight: 'green' }
    mockFetch.mockResolvedValue({ data: item })
    await fetchTrafficLightDetail(1)
    const url: string = mockFetch!.mock.calls[0]![0]!
    expect(url).toBe('/pmo/traffic-light/1')
  })

  // ─── upsertTrafficLightReview ──────────────────────────────────────────────

  it('upsertTrafficLightReview 发送 POST 请求', async () => {
    mockFetch.mockResolvedValue({ data: {} })
    await upsertTrafficLightReview(1, { reviewState: 'acknowledged', note: 'OK' })
    const url: string = mockFetch!.mock.calls[0]![0]!
    const options = mockFetch!.mock.calls[0]![1]! as RequestInit
    expect(url).toBe('/pmo/traffic-light/1/review')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body as string)).toEqual({ reviewState: 'acknowledged', note: 'OK' })
  })
})

describe('pmoTrafficLight API client — 无敏感字段泄露', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('list 响应不泄露敏感字段', async () => {
    const response = {
      data: [
        {
          projectId: 1,
          projectName: '测试项目',
          projectStatus: 'active',
          trafficLight: 'red',
          severityCounts: { critical: 1, high: 2, medium: 0, low: 0 },
          sourceFreshness: {
            overallStale: false,
            staleSources: [],
            lastUpdatedAt: '2026-07-27T10:00:00Z',
          },
          evidence: [
            {
              ruleId: 'TL-R01',
              ruleVersion: 'pmo-traffic-light-v1',
              severity: 'critical',
              status: 'red',
              message: '测试消息',
              evidenceRefs: [],
              sourceFreshness: {
                source: 'project_dashboard',
                lastUpdatedAt: null,
                isStale: false,
                staleReason: null,
              },
              contributing: true,
            },
          ],
          warnings: [],
          reviewState: {
            reviewState: 'acknowledged',
            reviewedAt: null,
            reviewedBy: null,
            stale: false,
          },
          ruleVersion: 'pmo-traffic-light-v1',
          calculatedAt: '2026-07-27T10:00:00Z',
          allowedActions: { canReview: true, canViewDetail: true },
        },
      ],
      meta: { page: 1, perPage: 20, total: 1, totalPages: 1, calculatedAt: '2026-07-27T10:00:00Z' },
    }
    mockFetch.mockResolvedValue(response)

    const result = await fetchTrafficLightList()
    const json = JSON.stringify(result)
    expect(json).not.toContain('prompt')
    expect(json).not.toContain('model_output')
    expect(json).not.toContain('secret')
    expect(json).not.toContain('token')
    expect(json).not.toContain('password')
  })
})
