/**
 * v3-backend-type-debt-closure（任务 2.4 / 2.5）—— 组织上下文红线回归测试。
 *
 * 背景：v3-backend-type-debt-closure §2 把 `ai_trace_controller`（4 处）、
 * `copilot_session_controller`（9 处）、`copilot_routing_ledger_controller`（3 处）、
 * `budget_status_controller`（1 处）的 `user.organizationId`（`User` 模型无该字段，
 * 取值恒 undefined → 查询无组织过滤）改为 `ctx.tenant` 范式。
 *
 * 本文件证明两件事：
 * - 2.4 fail closed：缺租户上下文时抛 PermissionDeniedException（或显式 4xx），
 *   服务/模型层完全不被触达——不会「不带未定义组织继续查询」。
 * - 2.5 组织过滤：控制器传给服务/查询的组织号就是 `ctx.tenant.organizationId`，
 *   跨组织数据不可见（show 在他组织会话上返回 404；预算服务跨组织错误映射为 403）。
 */
import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import { PermissionDeniedException } from '#exceptions/api_exception'
import AiTraceController from '#controllers/ai_trace_controller'
import CopilotSessionController from '#controllers/copilot_session_controller'
import CopilotRoutingLedgerController from '#controllers/copilot_routing_ledger_controller'
import BudgetStatusController from '#controllers/budget_status_controller'
import { TraceQueryService } from '#services/ai_tracing/trace_query_service'
import { CopilotSessionService } from '#services/copilot_session/copilot_session_service'
import CopilotRoutingDecisionModel from '#models/copilot_routing_decision'

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  status: number | null
  payload: unknown
}

function mockResponse(record: MockResponse) {
  const make = (status: number) => (payload: unknown) => {
    record.status = status
    record.payload = payload
    return payload
  }
  return {
    ok: make(200),
    created: make(201),
    badRequest: make(400),
    unauthorized: make(401),
    forbidden: make(403),
    notFound: make(404),
    internalServerError: make(500),
    serviceUnavailable: make(503),
  }
}

interface MockCtxOptions {
  /** true = tenant 中间件根本没有建立租户上下文（tenant 为 undefined） */
  noTenant?: boolean
  tenantOrganizationId?: number | null
  userId?: number
  params?: Record<string, unknown>
  input?: Record<string, unknown>
  body?: Record<string, unknown>
}

function mockCtx(opts: MockCtxOptions = {}) {
  const {
    noTenant = false,
    tenantOrganizationId = 7,
    userId = 5,
    params = {},
    input = {},
    body = {},
  } = opts
  const responseRecord: MockResponse = { status: null, payload: null }
  const ctx = {
    auth: {
      user: { id: userId },
      getUserOrFail: () => ({ id: userId }),
    },
    tenant: noTenant ? undefined : { organizationId: tenantOrganizationId },
    params,
    request: {
      input: (key: string, defaultValue?: unknown) => (key in input ? input[key] : defaultValue),
      only: (keys: string[]) =>
        Object.fromEntries(keys.filter((k) => k in body).map((k) => [k, body[k]])),
    },
    response: mockResponse(responseRecord),
  } as unknown as HttpContext
  return { ctx, responseRecord }
}

/** 伪 Lucid 查询构造器：记录 where 调用，await 时解析为空数组。 */
function fakeQueryBuilder(record: { whereCalls: unknown[][] }) {
  const builder = {
    where(...args: unknown[]) {
      record.whereCalls.push(args)
      return builder
    },
    then(onFulfilled: (rows: unknown[]) => unknown) {
      return Promise.resolve(onFulfilled([]))
    },
  }
  return builder
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sessionId: 'sess-org-7',
    scope: 'project',
    attribution: {},
    status: 'active',
    title: '会话',
    archived: false,
    actorId: 5,
    createdAt: { toISO: () => '2026-08-22T00:00:00.000Z' },
    updatedAt: { toISO: () => '2026-08-22T00:00:00.000Z' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 2.4 缺租户上下文时 fail closed
// ---------------------------------------------------------------------------

test.group('组织上下文红线 — fail closed（任务 2.4）', () => {
  test('AiTraceController.show：无租户上下文抛 PermissionDeniedException，服务零触达', async ({
    assert,
  }) => {
    let serviceCalls = 0
    const original = TraceQueryService.prototype.queryTraceTree
    TraceQueryService.prototype.queryTraceTree = async function () {
      serviceCalls++
      return null
    }
    try {
      const controller = new AiTraceController()
      const { ctx } = mockCtx({ noTenant: true, params: { traceId: 't-1' } })
      await assert.rejects(() => controller.show(ctx), PermissionDeniedException)
      assert.equal(serviceCalls, 0, '缺租户上下文时不得触达服务层')
    } finally {
      TraceQueryService.prototype.queryTraceTree = original
    }
  })

  test('CopilotSessionController.index：无租户上下文抛 PermissionDeniedException，服务零触达', async ({
    assert,
  }) => {
    let serviceCalls = 0
    const original = CopilotSessionService.prototype.listSessions
    CopilotSessionService.prototype.listSessions = async function () {
      serviceCalls++
      return { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    }
    try {
      const controller = new CopilotSessionController()
      const { ctx } = mockCtx({ noTenant: true })
      await assert.rejects(() => controller.index(ctx), PermissionDeniedException)
      assert.equal(serviceCalls, 0, '缺租户上下文时不得触达服务层')
    } finally {
      CopilotSessionService.prototype.listSessions = original
    }
  })

  test('CopilotRoutingLedgerController.index：无租户上下文抛 PermissionDeniedException，模型零触达', async ({
    assert,
  }) => {
    const queryRecord = { whereCalls: [] as unknown[][] }
    const modelStub = CopilotRoutingDecisionModel as unknown as { query: () => unknown }
    const originalQuery = modelStub.query
    modelStub.query = () => fakeQueryBuilder(queryRecord)
    try {
      const controller = new CopilotRoutingLedgerController()
      const { ctx } = mockCtx({ noTenant: true })
      await assert.rejects(() => controller.index(ctx), PermissionDeniedException)
      assert.equal(queryRecord.whereCalls.length, 0, '缺租户上下文时不得发起任何查询')
    } finally {
      modelStub.query = originalQuery
    }
  })

  test('BudgetStatusController.getBudgetStatus：未登录返回 401；缺租户上下文返回 400 且服务零触达', async ({
    assert,
  }) => {
    let serviceCalls = 0
    const holder = globalThis as unknown as Record<string, unknown>
    const previous = holder.__budgetStatusService
    holder.__budgetStatusService = {
      getStatus: async () => {
        serviceCalls++
        return {}
      },
    }
    try {
      const controller = new BudgetStatusController()

      // 未登录
      const anon = mockCtx({})
      ;(anon.ctx as { auth: { user: unknown } }).auth.user = null
      await controller.getBudgetStatus(anon.ctx)
      assert.equal(anon.responseRecord.status, 401)

      // 已登录但无租户上下文
      const noTenant = mockCtx({ noTenant: true })
      await controller.getBudgetStatus(noTenant.ctx)
      assert.equal(noTenant.responseRecord.status, 400)
      assert.equal(
        (noTenant.responseRecord.payload as { error: { code: string } }).error.code,
        'VALIDATION_ERROR',
      )
      assert.equal(serviceCalls, 0, '缺租户上下文时不得触达预算服务')
    } finally {
      holder.__budgetStatusService = previous
    }
  })
})

// ---------------------------------------------------------------------------
// 2.5 查询确实带组织过滤（跨组织不可见）
// ---------------------------------------------------------------------------

test.group('组织上下文红线 — 组织过滤贯通（任务 2.5）', () => {
  test('AiTraceController.show：传给服务的组织号来自 ctx.tenant（=7）', async ({ assert }) => {
    const captured: number[] = []
    const original = TraceQueryService.prototype.queryTraceTree
    TraceQueryService.prototype.queryTraceTree = async function (organizationId: number) {
      captured.push(organizationId)
      return null
    }
    try {
      const controller = new AiTraceController()
      const { ctx, responseRecord } = mockCtx({
        tenantOrganizationId: 7,
        params: { traceId: 't-x' },
      })
      await controller.show(ctx)
      assert.deepEqual(captured, [7])
      assert.equal(responseRecord.status, 404, '服务返回 null 时应 404')
    } finally {
      TraceQueryService.prototype.queryTraceTree = original
    }
  })

  test('AiTraceController.sessionAggregation：组织过滤参数贯通', async ({ assert }) => {
    const captured: number[] = []
    const original = TraceQueryService.prototype.aggregateBySession
    TraceQueryService.prototype.aggregateBySession = async function (organizationId: number) {
      captured.push(organizationId)
      return { total_spans: 0 } as unknown as Awaited<
        ReturnType<TraceQueryService['aggregateBySession']>
      >
    }
    try {
      const controller = new AiTraceController()
      const { ctx } = mockCtx({
        tenantOrganizationId: 42,
        params: { conversationId: 'c-1' },
      })
      await controller.sessionAggregation(ctx)
      assert.deepEqual(captured, [42])
    } finally {
      TraceQueryService.prototype.aggregateBySession = original
    }
  })

  test('CopilotSessionController.index：listSessions 收到租户组织号与当前 actor', async ({
    assert,
  }) => {
    const captured: { organizationId?: number; actorId?: number }[] = []
    const original = CopilotSessionService.prototype.listSessions
    CopilotSessionService.prototype.listSessions = async function (input) {
      captured.push({ organizationId: input.organizationId, actorId: input.actorId })
      return { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    }
    try {
      const controller = new CopilotSessionController()
      const { ctx } = mockCtx({ tenantOrganizationId: 7, userId: 5 })
      await controller.index(ctx)
      assert.lengthOf(captured, 1)
      assert.equal(captured[0].organizationId, 7)
      assert.equal(captured[0].actorId, 5)
    } finally {
      CopilotSessionService.prototype.listSessions = original
    }
  })

  test('CopilotSessionController.show：会话不在本组织过滤结果内 → 404（跨组织不可见）', async ({
    assert,
  }) => {
    const original = CopilotSessionService.prototype.listSessions
    CopilotSessionService.prototype.listSessions = async function (input) {
      assert.equal(input.organizationId, 7)
      // 服务层已按组织 7 过滤——他组织的会话不在结果里
      return {
        data: [makeSession({ sessionId: 'sess-org-7' })],
        meta: { total: 1, page: 1, perPage: 20, totalPages: 1 },
      } as Awaited<ReturnType<CopilotSessionService['listSessions']>>
    }
    try {
      const controller = new CopilotSessionController()
      const { ctx, responseRecord } = mockCtx({
        tenantOrganizationId: 7,
        params: { sessionId: 'sess-other-org' },
      })
      await controller.show(ctx)
      assert.equal(responseRecord.status, 404)
      assert.equal(
        (responseRecord.payload as { error: { code: string } }).error.code,
        'RESOURCE_NOT_FOUND',
      )
    } finally {
      CopilotSessionService.prototype.listSessions = original
    }
  })

  test('CopilotRoutingLedgerController.violations：模型查询基线带 organization_id 过滤', async ({
    assert,
  }) => {
    const queryRecord = { whereCalls: [] as unknown[][] }
    const modelStub = CopilotRoutingDecisionModel as unknown as { query: () => unknown }
    const originalQuery = modelStub.query
    modelStub.query = () => fakeQueryBuilder(queryRecord)
    try {
      const controller = new CopilotRoutingLedgerController()
      const { ctx, responseRecord } = mockCtx({ tenantOrganizationId: 9 })
      await controller.violations(ctx)
      assert.equal(responseRecord.status, 200)
      const orgFilters = queryRecord.whereCalls.filter(
        (args) => args[0] === 'organization_id' && args[1] === 9,
      )
      assert.lengthOf(orgFilters, 1, '查询必须带 organization_id = 当前租户组织 的 where 过滤')
    } finally {
      modelStub.query = originalQuery
    }
  })

  test('BudgetStatusController.getBudgetStatus：服务收到的组织号来自 ctx.tenant；跨组织错误映射 403', async ({
    assert,
  }) => {
    const captured: number[] = []
    const holder = globalThis as unknown as Record<string, unknown>
    const previous = holder.__budgetStatusService
    holder.__budgetStatusService = {
      getStatus: async (input: { organizationId: number }) => {
        captured.push(input.organizationId)
        return { costLabel: 'estimate' }
      },
    }
    try {
      const controller = new BudgetStatusController()
      const { ctx, responseRecord } = mockCtx({ tenantOrganizationId: 7 })
      await controller.getBudgetStatus(ctx)
      assert.deepEqual(captured, [7])
      assert.equal(responseRecord.status, 200)

      // 跨组织访问错误 → 不泄露细节的 403
      holder.__budgetStatusService = {
        getStatus: async () => {
          const err = new Error('cross org') as Error & { code: string }
          err.code = 'CROSS_ORGANIZATION_ACCESS'
          throw err
        },
      }
      const cross = mockCtx({ tenantOrganizationId: 7 })
      await controller.getBudgetStatus(cross.ctx)
      assert.equal(cross.responseRecord.status, 403)
      assert.equal(
        (cross.responseRecord.payload as { error: { code: string } }).error.code,
        'PERMISSION_DENIED',
      )
    } finally {
      holder.__budgetStatusService = previous
    }
  })
})
