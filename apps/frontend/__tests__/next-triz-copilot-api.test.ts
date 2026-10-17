/**
 * 矛盾求解前端数据层测试（v3-triz-contradiction-copilot W5 · tasks 5.2）。
 *
 * 链路：`global.fetch` 伪后端（按 `triz_copilot_analyses_controller.ts` 的真实响应形状应答）
 * → `apiFetchEnvelope` → `lib/api/triz-copilot.ts` → `lib/api/use-triz-copilot.ts` hooks。
 * **禁止 `vi.mock('@/lib/api/*')` 式自证**（那正是「契约漂移」长期存活的原因）。
 *
 * 覆盖：受理 / 列表 / 详情 / 改判四条路径的信封解包与请求载荷；
 * 列表空态为空数组（不是 undefined）；4xx/5xx 保持可辨识错误态（status + code），
 * 绝不被吞成空态；hook 三态（成功 / 空态 / 错误）与改判后的详情缓存刷新。
 */
import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  isTrizInterventionToolName,
  parseTrizInterventionDiff,
  parseTrizInterventionReceipt,
  resolveTrizMappingView,
  trizCopilotApi,
  trizExcludedPrincipleNumbers,
  trizTargetForToolName,
  TRIZ_TARGET_TOOL_NAMES,
  type TrizMappingPath,
} from '@/lib/api/triz-copilot'
import {
  trizCopilotKeys,
  useOverrideTrizContradiction,
  useSolveTrizContradiction,
  useTrizCopilotAnalyses,
  useTrizCopilotAnalysis,
} from '@/lib/api/use-triz-copilot'
import type { ApiError } from '@/lib/api-client'
import {
  apiErrorResponse,
  installTrizFakeBackend,
  jsonResponse,
  makeAnalysisDto,
  makeCandidate,
  makeCommitEnvelope,
  makeInterventionDiff,
  makeMappingView,
  makeSolveResponse,
  TRIZ_PROJECT_ID,
  type TrizFakeBackend,
} from './_next-triz-copilot-fixtures'

let backend: TrizFakeBackend

beforeEach(() => {
  backend = installTrizFakeBackend()
})

afterEach(() => {
  backend.restore()
})

/** 单点覆盖伪后端响应（用于 GET 类只读路径）。 */
function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(status, body)),
  )
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const ANALYSES_PATH = `/projects/${TRIZ_PROJECT_ID}/triz-copilot/analyses`

describe('trizCopilotApi.solve — 受理并求解（信封解包）', () => {
  test('POST 到项目域端点，载荷只带陈述（不带参数表），响应信封原样解包', async () => {
    backend.enqueueSolve(makeSolveResponse())

    const envelope = await trizCopilotApi.solve(TRIZ_PROJECT_ID, {
      statement: '客户催进度，但再加人测试就跟不上了',
    })

    expect(backend.calls).toHaveLength(1)
    const call = backend.calls[0]!
    expect(call.method).toBe('POST')
    expect(call.url).toContain(ANALYSES_PATH)
    expect(call.body).toEqual({ statement: '客户催进度，但再加人测试就跟不上了' })
    // 数据落地：映射依据 + Top 3 全部可读
    expect(envelope.data.id).toBe(501)
    expect(envelope.data.mapping.improvingParameter?.number).toBe(25)
    expect(envelope.data.solutions).toHaveLength(3)
    expect(envelope.data.clarification.asked).toBe(false)
  })

  test('澄清续轮：携带 parentAnalysisId 与新的回答文本', async () => {
    backend.enqueueSolve(
      makeSolveResponse({
        id: 502,
        parentAnalysisId: 501,
        clarification: { needed: true, asked: true, round: 1, prompt: '请补充…' },
      }),
    )

    const envelope = await trizCopilotApi.solve(TRIZ_PROJECT_ID, {
      statement: '我想改善进度，但质量会跟着变差',
      parentAnalysisId: 501,
    })

    expect(backend.calls[0]?.body).toEqual({
      statement: '我想改善进度，但质量会跟着变差',
      parentAnalysisId: 501,
    })
    expect(envelope.data.clarification.asked).toBe(true)
    expect(envelope.data.parentAnalysisId).toBe(501)
  })

  test('4xx 保持可辨识错误态：403 抛出 status + code，不被吞成空结果', async () => {
    backend.enqueueSolve(
      { error: { code: 'PERMISSION_DENIED', message: '缺少 ai:trigger 权限' } },
      403,
    )

    const error = await trizCopilotApi
      .solve(TRIZ_PROJECT_ID, { statement: '进度与质量矛盾' })
      .then(() => null)
      .catch((caught: unknown) => caught as ApiError)

    expect(error).not.toBeNull()
    expect(error?.status).toBe(403)
    expect(error?.code).toBe('PERMISSION_DENIED')
  })

  test('5xx 同样透传（服务端异常不伪装成「没有数据」）', async () => {
    backend.enqueueSolve({ error: { code: 'AI_SERVICE_ERROR', message: '求解失败' } }, 500)

    const error = await trizCopilotApi
      .solve(TRIZ_PROJECT_ID, { statement: '进度与质量矛盾' })
      .then(() => null)
      .catch((caught: unknown) => caught as ApiError)

    expect(error?.status).toBe(500)
    expect(error?.code).toBe('AI_SERVICE_ERROR')
  })
})

describe('trizCopilotApi.list / detail / override', () => {
  test('列表：空态是空数组 + meta 全零（不是 undefined）', async () => {
    const envelope = await trizCopilotApi.list(TRIZ_PROJECT_ID)

    expect(envelope.data).toEqual([])
    expect(envelope.meta.total).toBe(0)
    expect(envelope.meta.page).toBe(1)
    expect(backend.calls[0]?.method).toBe('GET')
  })

  test('列表：数据落地与查询串（path / humanOverride / 分页过滤）', async () => {
    stubFetch({
      data: [makeAnalysisDto({ id: 601, path: 'ai' as TrizMappingPath, fallbackReasons: [] })],
      meta: { total: 1, page: 2, perPage: 20, totalPages: 1 },
    })

    const envelope = await trizCopilotApi.list(TRIZ_PROJECT_ID, {
      page: 2,
      path: 'ai',
      humanOverride: true,
    })

    expect(envelope.data[0]?.id).toBe(601)
    expect(envelope.meta.total).toBe(1)
    const url = String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '')
    expect(url).toContain('page=2')
    expect(url).toContain('path=ai')
    expect(url).toContain('humanOverride=true')
  })

  test('详情：GET 单条分析记录（含候选原则与预算快照）', async () => {
    stubFetch({ data: makeAnalysisDto({ id: 777 }) })

    const envelope = await trizCopilotApi.detail(TRIZ_PROJECT_ID, 777)

    expect(envelope.data.id).toBe(777)
    expect(envelope.data.candidatePrinciples.length).toBeGreaterThan(0)
    expect(envelope.data.budget.tokenBudget).toBe(4000)
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '')).toContain(`${ANALYSES_PATH}/777`)
  })

  test('改判：POST /:id/override，载荷只带被改判的参数编号，业务字段零变更', async () => {
    backend.enqueueOverride({
      data: {
        ...makeAnalysisDto({ humanOverride: true }),
        change: {
          from: { improvingParameter: 25, worseningParameter: 27 },
          to: { improvingParameter: 25, worseningParameter: 36 },
        },
        solutions: makeSolveResponse().data.solutions,
      },
    })

    const envelope = await trizCopilotApi.override(TRIZ_PROJECT_ID, 501, {
      worseningParameter: 36,
    })

    expect(backend.calls[0]?.method).toBe('POST')
    expect(backend.calls[0]?.url).toContain(`${ANALYSES_PATH}/501/override`)
    expect(backend.calls[0]?.body).toEqual({ worseningParameter: 36 })
    expect(envelope.data.humanOverride).toBe(true)
    expect(envelope.data.change.to.worseningParameter).toBe(36)
  })
})

describe('hooks（列表 / 详情 / 受理 / 改判）', () => {
  test('useTrizCopilotAnalyses：空态可辨识（data 为空数组而非 undefined）', async () => {
    const { result } = renderHook(() => useTrizCopilotAnalyses(TRIZ_PROJECT_ID), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data).toEqual([])
    expect(result.current.data?.meta.total).toBe(0)
  })

  test('useTrizCopilotAnalyses：4xx 进入 isError 且 error.status 可读（不吞成空态）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => apiErrorResponse(403, 'PERMISSION_DENIED', '缺少 project:view 权限')),
    )

    const { result } = renderHook(() => useTrizCopilotAnalyses(TRIZ_PROJECT_ID), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const apiError = result.current.error as unknown as ApiError
    expect(apiError.status).toBe(403)
    expect(apiError.code).toBe('PERMISSION_DENIED')
    expect(result.current.data).toBeUndefined()
  })

  test('useTrizCopilotAnalysis：analysisId 为空时不发请求（零请求）', () => {
    const { result } = renderHook(() => useTrizCopilotAnalysis(TRIZ_PROJECT_ID, null), {
      wrapper: makeWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(backend.calls).toHaveLength(0)
  })

  test('useSolveTrizContradiction：mutation 载荷与结果落地', async () => {
    backend.enqueueSolve(makeSolveResponse({ id: 888 }))
    const { result } = renderHook(() => useSolveTrizContradiction(TRIZ_PROJECT_ID), {
      wrapper: makeWrapper(),
    })

    result.current.mutate({ statement: '既要赶进度又要保质量' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.data.id).toBe(888)
    expect(backend.count('/triz-copilot/analyses')).toBe(1)
  })

  test('useOverrideTrizContradiction：改判后详情缓存即时更新（无需二次请求）', async () => {
    backend.enqueueOverride({
      data: {
        ...makeAnalysisDto({ humanOverride: true }),
        change: {
          from: { improvingParameter: 25, worseningParameter: 27 },
          to: { improvingParameter: 25, worseningParameter: 36 },
        },
        solutions: makeSolveResponse().data.solutions,
      },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children)
    }
    const { result } = renderHook(() => useOverrideTrizContradiction(TRIZ_PROJECT_ID, 501), {
      wrapper: Wrapper,
    })

    result.current.mutate({ worseningParameter: 36 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const cached = queryClient.getQueryData(trizCopilotKeys.detail(TRIZ_PROJECT_ID, 501)) as {
      data: { humanOverride: boolean }
    }
    expect(cached.data.humanOverride).toBe(true)
  })
})

describe('低敏投影与解析器（零信任）', () => {
  test('resolveTrizMappingView：改判响应无顶层 mapping 时由分析记录派生同形状依据', () => {
    const analysis = makeAnalysisDto({ humanOverride: true })
    const view = resolveTrizMappingView(analysis)

    expect(view.path).toBe(analysis.path)
    expect(view.improvingParameter?.number).toBe(25)
    expect(view.candidatePrinciples.map((principle) => principle.number)).toEqual([10, 28, 24])
    expect(view.sourceSections[0]).toContain('triz-application-ai-pm.md')
  })

  test('resolveTrizMappingView：受理响应的顶层 mapping 优先生效', () => {
    const analysis = makeAnalysisDto()
    const mapping = makeMappingView(analysis, { sourceMappingIds: ['CLASSIC-1'] })

    expect(resolveTrizMappingView(analysis, mapping).sourceMappingIds).toEqual(['CLASSIC-1'])
  })

  test('trizExcludedPrincipleNumbers：未进 Top 3 的原则编号可读', () => {
    const analysis = makeAnalysisDto({
      candidatePrinciples: [
        makeCandidate(10, '预操作'),
        makeCandidate(28, '机械系统替代'),
        makeCandidate(24, '中介物'),
        makeCandidate(31, '多孔材料'),
      ],
    })

    expect(trizExcludedPrincipleNumbers(analysis)).toContain(31)
  })

  test('差异预览 / 回执解析：结构不符返回 null，不制造假回执', () => {
    const diff = makeInterventionDiff('risk')

    expect(parseTrizInterventionDiff(diff)?.entity.title).toContain('预操作')
    expect(parseTrizInterventionDiff({ target: 'unknown' })).toBeNull()
    expect(parseTrizInterventionReceipt(makeCommitEnvelope('risk').data)?.entityId).toBe(9001)
    expect(parseTrizInterventionReceipt({ committed: true })).toBeNull()
  })

  test('三类落库目标 → 写工具名映射（工具名反查为同一闭集）', () => {
    expect(Object.values(TRIZ_TARGET_TOOL_NAMES)).toHaveLength(3)
    for (const toolName of Object.values(TRIZ_TARGET_TOOL_NAMES)) {
      expect(isTrizInterventionToolName(toolName)).toBe(true)
      expect(trizTargetForToolName(toolName)).not.toBeNull()
    }
    expect(isTrizInterventionToolName('update_task_schedule')).toBe(false)
    expect(trizTargetForToolName('nope')).toBeNull()
  })
})
