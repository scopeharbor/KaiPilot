/**
 * v3-unified-ai-feedback-ledger —— 控制器测试。
 *
 * 测试控制器的请求解析、组织隔离（Policy 前置）、错误处理。
 * 用 vi.mock 桩掉聚合服务模块，不依赖真实数据库。
 *
 * 注（v3-backend-type-debt-closure）：原测试按 `new Controller(service, policy)` 构造，
 * 并读 `result.body`——那套写法对应的是一个**不存在的**控制器 API：
 * 真实控制器只注入 Policy，聚合走模块函数；`response.ok()` 的返回是 Adonis 的响应对象。
 * 本文件已改为与真实实现一致：桩模块函数 + 断言传给服务的参数。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const aggregateAdoptionRate = vi.fn()
const listEvents = vi.fn()
const downstreamSummary = vi.fn()

vi.mock('../../app/services/unified_ai_feedback/aggregation_service.js', () => ({
  aggregateAdoptionRate: (...args: unknown[]) => aggregateAdoptionRate(...args),
  listEvents: (...args: unknown[]) => listEvents(...args),
  downstreamSummary: (...args: unknown[]) => downstreamSummary(...args),
}))

const controllerModule = await import('../../app/controllers/unified_ai_feedback_controller.js')
const UnifiedAiFeedbackController = controllerModule.default

function createMockHttpContext(
  params: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
) {
  const organizationId = params.organizationId ? Number(params.organizationId) : undefined
  return {
    params,
    auth: { user: { id: 1 } },
    tenant: organizationId ? { organizationId } : undefined,
    request: {
      input: (key: string, defaultVal?: unknown) => query[key] ?? defaultVal,
      validateUsing: vi.fn().mockResolvedValue(query),
    },
    response: {
      ok: vi.fn().mockImplementation((body: unknown) => ({ status: 200, body })),
      badRequest: vi.fn().mockImplementation((body: unknown) => ({ status: 400, body })),
      internalServerError: vi.fn().mockImplementation((body: unknown) => ({ status: 500, body })),
    },
  } as never
}

describe('UnifiedAiFeedbackController', () => {
  beforeEach(() => {
    aggregateAdoptionRate.mockReset().mockResolvedValue({
      accepted: 10,
      modified: 5,
      rejected: 3,
      skipped: 2,
      pending: 8,
      adoptionRate: 0.75,
      coverage: 0.8,
      denominator: 20,
      rejectionDistribution: [],
    })
    listEvents.mockReset().mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 50, totalPages: 0 },
    })
    downstreamSummary.mockReset().mockResolvedValue({
      typeCounts: { accepted: 10, modified: 5, rejected: 3, skipped: 2, pending: 8 },
      adoptionRate: { adoptionRate: 0.75, coverage: 0.8, denominator: 20 },
      rejectionDistribution: [],
      bySurface: [],
    })
  })

  function controller() {
    return new UnifiedAiFeedbackController()
  }

  describe('aggregate', () => {
    it('组织合法时前置 Policy 并返回采纳率', async () => {
      const result = (await controller().aggregate(
        createMockHttpContext({ organizationId: '101' }),
      )) as unknown as {
        status: number
        body: { data: { adoptionRate: number; accepted: number } }
      }

      expect(aggregateAdoptionRate).toHaveBeenCalledWith({
        organizationId: 101,
        capabilitySurface: undefined,
        windowStart: undefined,
        windowEnd: undefined,
      })
      expect(result.status).toBe(200)
      expect(result.body.data.adoptionRate).toBe(0.75)
      expect(result.body.data.accepted).toBe(10)
    })

    it('组织 id 非法时返回 400，且不查库、不做权限判定', async () => {
      const result = (await controller().aggregate(
        createMockHttpContext({ organizationId: '0' }),
      )) as unknown as { status: number }

      expect(result.status).toBe(400)
      expect(aggregateAdoptionRate).not.toHaveBeenCalled()
    })

    it('透传能力面过滤参数', async () => {
      await controller().aggregate(
        createMockHttpContext({ organizationId: '101' }, { surface: 'draft' }),
      )
      expect(aggregateAdoptionRate).toHaveBeenCalledWith(
        expect.objectContaining({ capabilitySurface: 'draft' }),
      )
    })
  })

  describe('events', () => {
    it('分页参数透传且 perPage 有上限', async () => {
      await controller().events(
        createMockHttpContext({ organizationId: '101' }, { page: '2', perPage: '25' }),
      )
      expect(listEvents).toHaveBeenCalledWith({
        organizationId: 101,
        page: 2,
        perPage: 25,
        feedbackType: undefined,
        capabilitySurface: undefined,
      })

      listEvents.mockClear()
      await controller().events(
        createMockHttpContext({ organizationId: '101' }, { perPage: '9999' }),
      )
      expect(listEvents).toHaveBeenCalledWith(expect.objectContaining({ perPage: 100 }))
    })
  })

  describe('downstream', () => {
    it('走 downstream Policy，且只返回计数与枚举，不含正文', async () => {
      const result = (await controller().downstream(
        createMockHttpContext({ organizationId: '101' }),
      )) as unknown as { body: { data: Record<string, unknown> } }

      expect(result.body.data.typeCounts).toBeDefined()
      expect(result.body.data.adoptionRate).toBeDefined()
      expect(result.body.data.proposedContentHash).toBeUndefined()
      expect(result.body.data.promptText).toBeUndefined()
    })
  })
})
