/**
 * v2-triz-recommendation-rationale-ui —— TRIZ 推荐理由 API 测试。
 *
 * 直接对 TrizRationaleController 做 unit 级注入（不走 HTTP 层），
 * 使用 Mock Policy / Mock Services 避免数据库依赖。
 *
 * 覆盖：
 * - Authorized reads return 200
 * - Cross-organization 返回 404
 * - 无权限返回 PERMISSION_DENIED
 * - Feedback 验证与提交
 * - Handoff 记录
 * - 只读无副作用断言
 */
import { test } from '@japa/runner'
import TrizRationaleController from '#controllers/triz_rationale_controller'
import {
  ResourceNotFoundException,
  PermissionDeniedException,
  ValidationException,
} from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import type { TrizRecommendationRationale, RationaleFeedbackResponse } from '@aiproj/types'

// ---------------------------------------------------------------------------
// Mock Policy：预设 view / feedback / handoff 返回值
// ---------------------------------------------------------------------------

function mockPolicy(overrides: { view?: boolean; feedback?: boolean; handoff?: boolean }) {
  const defaults = { view: true, feedback: true, handoff: true }
  const behavior = { ...defaults, ...overrides }
  return {
    view: async (_user: User, _orgId: number, _projectId: number) => behavior.view,
    feedback: async (_user: User, _orgId: number, _projectId: number) => behavior.feedback,
    handoff: async (_user: User, _orgId: number, _projectId: number) => behavior.handoff,
  }
}

// ---------------------------------------------------------------------------
// Mock Services
// ---------------------------------------------------------------------------

function mockRationaleService(overrides: {
  show?: (
    orgId: number,
    projectId: number,
    sourceType: string,
    targetId: string,
  ) => Promise<Partial<TrizRecommendationRationale>>
  throwOnShow?: boolean
}) {
  const showFn = overrides.throwOnShow
    ? async () => {
        throw new Error('unexpected service error')
      }
    : (overrides.show ??
      (async (_org: number, _proj: number, _type: string, _id: string) =>
        ({
          id: `${_type}_${_id}`,
          organizationId: _org,
          projectId: _proj,
          sourceType: _type,
          sourceRefs: [],
          sourceHashes: [],
          contradictionSummary: 'mock 矛盾摘要',
          parameterTensions: [],
          principleMappings: [],
          evidenceRefs: [],
          validationSummary: {
            status: 'passed',
            antiHallucinationPassed: true,
            sourceRefsValid: true,
            warnings: [],
          },
          warningSummary: null,
          aiMetadata: {
            isAiGenerated: false,
            validationStatus: 'skipped',
            provider: null,
            model: null,
            inputHash: null,
            outputRef: null,
          },
          costSummary: {
            provider: null,
            model: null,
            tokens: 0,
            estimatedCost: null,
            latencyMs: null,
            budgetDecision: 'not_applicable',
          },
          deterministicSummary: 'mock 确定性摘要',
          aiExplanationDraft: null,
          fallbackSummary: null,
          availableSections: ['feedback', 'handoff'],
          humanReviewRequirement: null,
          handoffState: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }) as TrizRecommendationRationale))

  return { show: showFn }
}

function mockFeedbackService() {
  return {
    submit: async (opts: any) =>
      ({
        id: Date.now(),
        rationaleTarget: `${opts.targetType}:${opts.targetId}`,
        reason: opts.reason,
        note: opts.note ?? null,
        createdBy: opts.userId,
        createdAt: new Date().toISOString(),
      }) as RationaleFeedbackResponse,
    recordHandoff: async (
      _orgId: number,
      _projectId: number,
      _userId: number,
      _targetType: string,
      _targetId: string,
      _selectedPrinciple: string | null,
    ) => {
      // no-op
    },
  }
}

// ---------------------------------------------------------------------------
// Mock HttpContext 工厂
// ---------------------------------------------------------------------------

interface MockContextOptions {
  orgId?: number
  projectId?: number
  targetType?: string
  targetId?: string
  userId?: number
  isSuperAdmin?: boolean
  /** 如果设 validRequest=false，validateUsing 抛出验证异常 */
  validRequest?: boolean
  validatePayload?: (validator: any, options?: { data?: Record<string, unknown> }) => any
}

function mockContext(opts: MockContextOptions = {}) {
  const {
    orgId = 1,
    projectId = 10,
    targetType = 'contradiction',
    targetId = '42',
    userId = 5,
    isSuperAdmin = false,
    validRequest = true,
  } = opts

  let okPayload: any = null
  let createdPayload: any = null
  let responseStatus = 0

  const ctx = {
    auth: {
      getUserOrFail: () => ({ id: userId, isSuperAdmin }) as User,
    },
    tenant: {
      organizationId: orgId,
    },
    params: {
      projectId,
      targetType,
      targetId,
    },
    request: {
      validateUsing: async (_validator: any, options?: { data?: Record<string, unknown> }) => {
        if (!validRequest) {
          throw new ValidationException('参数验证失败')
        }
        // 返回已验证数据（从 options?.data 或 params 推导）
        return {
          projectId: options?.data?.projectId ?? projectId,
          targetType: options?.data?.targetType ?? targetType,
          targetId: options?.data?.targetId ?? targetId,
          reason: options?.data?.reason ?? 'helpful',
          note: options?.data?.note ?? null,
          selectedPrinciple: options?.data?.selectedPrinciple ?? null,
        }
      },
    },
    response: {
      ok(data: any) {
        okPayload = data
        responseStatus = 200
        return data
      },
      created(data: any) {
        createdPayload = data
        responseStatus = 201
        return data
      },
    },
  } as unknown as HttpContext

  return {
    ctx,
    okPayload: () => okPayload,
    createdPayload: () => createdPayload,
    status: () => responseStatus,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.group('TrizRationaleController · Authorized Reads', () => {
  // ── 1. show: 正常返回 200 ──────────────────────────────────────────────

  test('show 有权限时返回 200 且 data 包含正确字段', async ({ assert }) => {
    const policy = mockPolicy({ view: true })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx, okPayload } = mockContext()

    await controller.show(ctx)

    const payload = okPayload()
    assert.isNotNull(payload)
    assert.property(payload, 'data')
    assert.equal(payload.data.organizationId, 1)
    assert.equal(payload.data.projectId, 10)
    assert.equal(payload.data.sourceType, 'contradiction')
    assert.equal(payload.data.id, 'contradiction_42')
  })

  // ── 2. show: 无权限时抛出 PERMISSION_DENIED ────────────────────────────

  test('show 无权限时抛出 PermissionDeniedException', async ({ assert }) => {
    const policy = mockPolicy({ view: false })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext()

    await assert.rejects(() => controller.show(ctx), PermissionDeniedException)
  })

  // ── 3. show: Service 抛 ResourceNotFoundException（如跨组织）→ 向上传播 ─

  test('show 跨组织不可见时 Service 抛 ResourceNotFoundException', async ({ assert }) => {
    const policy = mockPolicy({ view: true })
    const service = {
      show: async (_orgId: number, _projId: number, _type: string, _id: string) => {
        throw new ResourceNotFoundException('TRIZ 矛盾未找到')
      },
    }
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext({ orgId: 2 }) // 另一个组织

    await assert.rejects(() => controller.show(ctx), ResourceNotFoundException)
  })

  // ── 4. show: 参数验证失败抛出 VALIDATION_ERROR ─────────────────────────

  test('show 无效参数时抛出 ValidationException', async ({ assert }) => {
    const policy = mockPolicy({ view: true })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext({ validRequest: false })

    await assert.rejects(() => controller.show(ctx), ValidationException)
  })

  // ── 5. show: Service 非预期错误 → fallback 404 ─────────────────────────

  test('show Service 内部错误时 fallback 为 ResourceNotFoundException', async ({ assert }) => {
    const policy = mockPolicy({ view: true })
    const service = mockRationaleService({ throwOnShow: true })
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext()

    await assert.rejects(() => controller.show(ctx), ResourceNotFoundException)
  })
})

test.group('TrizRationaleController · Feedback', () => {
  // ── 6. feedback: 正常返回 201 ──────────────────────────────────────────

  test('feedback 有权限时返回 201 且 data 包含反馈字段', async ({ assert }) => {
    const policy = mockPolicy({ feedback: true })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx, createdPayload } = mockContext()

    await controller.feedback(ctx)

    const payload = createdPayload()
    assert.isNotNull(payload)
    assert.property(payload, 'data')
    assert.equal(payload.data.rationaleTarget, 'contradiction:42')
    assert.equal(payload.data.reason, 'helpful')
    assert.equal(payload.data.createdBy, 5)
  })

  // ── 7. feedback: 无权限抛出 PERMISSION_DENIED ──────────────────────────

  test('feedback 无权限时抛出 PermissionDeniedException', async ({ assert }) => {
    const policy = mockPolicy({ feedback: false })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext()

    await assert.rejects(() => controller.feedback(ctx), PermissionDeniedException)
  })

  // ── 8. feedback: 参数验证失败 → ValidationException ────────────────────

  test('feedback 无效参数时抛出 ValidationException', async ({ assert }) => {
    const policy = mockPolicy({ feedback: true })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext({ validRequest: false })

    await assert.rejects(() => controller.feedback(ctx), ValidationException)
  })

  // ── 9. feedback: Service submit 抛出 → fallback ValidationException ───

  test('feedback Service 错误时 fallback 为 ValidationException', async ({ assert }) => {
    const policy = mockPolicy({ feedback: true })
    const service = mockRationaleService({})
    const feedbackService = {
      submit: async () => {
        throw new Error('unexpected')
      },
    }
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext()

    await assert.rejects(() => controller.feedback(ctx), ValidationException)
  })
})

test.group('TrizRationaleController · Handoff', () => {
  // ── 10. handoff: 正常返回 200 ─────────────────────────────────────────

  test('handoff 有权限时返回 200 且 data 包含 handoff 状态', async ({ assert }) => {
    const policy = mockPolicy({ handoff: true })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx, okPayload } = mockContext()

    await controller.handoff(ctx)

    const payload = okPayload()
    assert.isNotNull(payload)
    assert.property(payload, 'data')
    assert.property(payload.data, 'draftSessionId')
    assert.property(payload.data, 'handoffStatus')
    assert.isArray(payload.data.warnings)
  })

  // ── 11. handoff: 无权限抛出 PERMISSION_DENIED ─────────────────────────

  test('handoff 无权限时抛出 PermissionDeniedException', async ({ assert }) => {
    const policy = mockPolicy({ handoff: false })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext()

    await assert.rejects(() => controller.handoff(ctx), PermissionDeniedException)
  })

  // ── 12. handoff: 参数验证失败 → ValidationException ───────────────────

  test('handoff 无效参数时抛出 ValidationException', async ({ assert }) => {
    const policy = mockPolicy({ handoff: true })
    const service = mockRationaleService({})
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx } = mockContext({ validRequest: false })

    await assert.rejects(() => controller.handoff(ctx), ValidationException)
  })
})

test.group('TrizRationaleController · Read No-Side-Effect', () => {
  // ── 13. 两次相同 show 调用产生相同响应 ──────────────────────────────────

  test('两次相同 show 调用返回相同的 id/org/project/sourceType', async ({ assert }) => {
    const policy = mockPolicy({ view: true })
    const service = mockRationaleService({
      show: async () =>
        ({
          id: 'contradiction_42',
          organizationId: 1,
          projectId: 10,
          sourceType: 'contradiction',
          deterministicSummary: 'mock 确定性摘要',
          createdAt: '2026-07-16T00:00:00.000Z',
          updatedAt: '2026-07-16T00:00:00.000Z',
        }) as TrizRecommendationRationale,
    })
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )
    const { ctx: ctx1, okPayload: p1 } = mockContext()
    const { ctx: ctx2, okPayload: p2 } = mockContext()

    await controller.show(ctx1)
    await controller.show(ctx2)

    assert.equal(p1().data.id, 'contradiction_42')
    assert.equal(p2().data.id, 'contradiction_42')
    assert.equal(p1().data.organizationId, p2().data.organizationId)
  })
})

test.group('TrizRationaleController · 多来源类型', () => {
  // ── 14. show 各来源类型正常响应 ────────────────────────────────────────

  test('show 支持 contradiction/recommendation 来源', async ({ assert }) => {
    const service = mockRationaleService({})
    const policy = mockPolicy({ view: true })
    const feedbackService = mockFeedbackService()
    const controller = new TrizRationaleController(
      policy as any,
      service as any,
      feedbackService as any,
    )

    // contradiction
    const { ctx: ctxC, okPayload: pC } = mockContext({ targetType: 'contradiction', targetId: '1' })
    await controller.show(ctxC)
    assert.equal(pC().data.id, 'contradiction_1')

    // recommendation
    const { ctx: ctxR, okPayload: pR } = mockContext({
      targetType: 'recommendation',
      targetId: 'rec-1',
    })
    await controller.show(ctxR)
    assert.equal(pR().data.id, 'recommendation_rec-1')
  })
})
