/**
 * v3-copilot-productized-operating-entry —— 前端数据与错误状态接线测试
 * （任务 4.1 / 4.2 / 4.3 / 4.4 / 4.5）。
 *
 * 覆盖：
 * - query key 绑定 organization + project scope、缓存隔离、重试策略、旧响应不可覆盖新 scope
 * - store 持久化白名单与 reset 边界
 * - live submit 的生产错误分类：不追加 fixture 回复、不产生确认入口、保留有界可恢复输入
 * - 演示态准入：未声明不可进入、声明但未选择不进入、显式进入零网络
 * - scope 变更保护：保留草稿、提示新旧 scope、确认前禁提交
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { copilotKeys } from '@/lib/api/copilot'
import {
  COPILOT_READINESS_MAX_RETRIES,
  shouldRetryCopilotReadiness,
  useCopilotReadiness,
} from '@/hooks/use-copilot-readiness'
import {
  COPILOT_GLOBAL_SCOPE_LABEL,
  copilotScopeLabel,
  useCopilotScopeGuard,
} from '@/hooks/use-copilot-scope-guard'
import {
  COPILOT_DEMO_CAPABILITY_ENV,
  readCopilotDemoCapability,
} from '@/lib/copilot/demo-capability'
import {
  COPILOT_RETRY_ENVELOPE_MAX_TEXT,
  COPILOT_STORE_KEY,
  buildCopilotRetryEnvelope,
  useCopilotStore,
} from '@/stores/copilot-store'
import { describeCopilotFailure, retryCopilotTurn, submitCopilotTurn } from '@/lib/copilot/submit'
import type { CopilotTurnResponse } from '@aiproj/types'
import { readyEntrySnapshotFixture, ENTRY_FIXTURE_API_ERRORS } from '@aiproj/types'

// ---------------------------------------------------------------------------
// mock：API 客户端与路由参数
// ---------------------------------------------------------------------------

const readinessMock = vi.fn()
const submitTurnMock = vi.fn()

vi.mock('@/lib/api/copilot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/copilot')>('@/lib/api/copilot')
  return {
    ...actual,
    copilotApi: {
      readiness: (...args: unknown[]) => readinessMock(...args),
      submitTurn: (...args: unknown[]) => submitTurnMock(...args),
      // 流式提交适配：转调 JSON mock，并把结果派发为流式事件
      //（v3-copilot-live-streaming-output 后 submit 走流式端点）。
      submitTurnStream: async (...args: unknown[]) => {
        const request = args[0] as Parameters<typeof submitCopilotTurn>[0] & { text: string }
        const handlers = args[1] as {
          onOpen?: () => void
          onEvent: (event: never) => void
          onEnd?: () => void
        }
        handlers.onOpen?.()
        // mockRejectedValue：直接抛出，让 submit 的 catch 按原分类处理
        const turn = (await submitTurnMock(request)) as CopilotTurnResponse
        handlers.onEvent({
          type: 'turn-meta',
          sequence: 1,
          sessionId: turn.sessionId,
          destinations: turn.destinations?.map((d) => d.destination) ?? [],
          intentSummary: turn.intentSummary ?? '',
          scope: turn.scope ?? 'project',
        } as never)
        const result = turn.result
        if (result?.kind === 'route') {
          handlers.onEvent({
            type: 'turn-route',
            sequence: 2,
            destinations: result.destinations,
          } as never)
        } else if (result?.kind === 'clarify') {
          handlers.onEvent({
            type: 'turn-clarify',
            sequence: 2,
            items: result.items,
          } as never)
        } else if (result?.kind === 'answer' || result?.kind === 'structured') {
          handlers.onEvent({
            type: 'answer-delta',
            sequence: 2,
            delta: result.content,
          } as never)
          handlers.onEvent({
            type: 'answer-done',
            sequence: 3,
            assistantMessageId: result.assistantMessageId,
            contentSummary: result.content,
          } as never)
        }
        handlers.onEnd?.()
      },
    },
  }
})

const routeParams = { current: {} as { id?: string } }
vi.mock('next/navigation', () => ({
  useParams: () => routeParams.current,
}))

const authState = { current: { currentOrganizationId: 7 as number | null, user: null } }
vi.mock('@/stores/auth-store', () => {
  const useAuthStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(authState.current) : authState.current
  useAuthStore.getState = () => authState.current
  useAuthStore.setState = vi.fn()
  useAuthStore.subscribe = vi.fn(() => () => {})
  return {
    useAuthStore,
    selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
      state.currentOrganizationId,
  }
})

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function resetStore() {
  act(() => {
    useCopilotStore.setState({
      open: false,
      draft: '',
      streaming: false,
      streamPhase: 'idle',
      messages: [],
      demoActions: [],
      demoAssumptions: [],
      streamError: null,
      mode: 'live',
      liveSessionId: null,
      turn: null,
      degradeReason: null,
      demoCapabilityDeclared: false,
      demoSelected: false,
      retryEnvelope: null,
      failure: null,
      quickStartSelection: null,
      scopeNotice: null,
    })
  })
  localStorage.clear()
}

beforeEach(() => {
  readinessMock.mockReset()
  submitTurnMock.mockReset()
  routeParams.current = {}
  authState.current = { currentOrganizationId: 7, user: null }
  resetStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ===========================================================================
// 4.1 —— query key 与 hook
// ===========================================================================

describe('4.1 readiness query keys and hook', () => {
  it('query key 绑定 organization + project scope', () => {
    expect(copilotKeys.readiness({ organizationId: 7, projectId: 42 })).toEqual([
      'copilot',
      'readiness',
      7,
      42,
    ])
    expect(copilotKeys.readiness({ organizationId: 7, projectId: null })).toEqual([
      'copilot',
      'readiness',
      7,
      0,
    ])
    // 不同 scope 必须是不同的 key
    expect(copilotKeys.readiness({ organizationId: 7, projectId: 42 })).not.toEqual(
      copilotKeys.readiness({ organizationId: 8, projectId: 42 }),
    )
    expect(copilotKeys.readiness({ organizationId: 7, projectId: 42 })).not.toEqual(
      copilotKeys.readiness({ organizationId: 7, projectId: 43 }),
    )
  })

  it('从路由推导项目 scope 并请求对应 snapshot', async () => {
    routeParams.current = { id: '42' }
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    const client = newClient()

    const { result } = renderHook(() => useCopilotReadiness(), {
      wrapper: makeWrapper(client),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(readinessMock).toHaveBeenCalledWith({ organizationId: 7, projectId: 42 })
    expect(
      client.getQueryData(copilotKeys.readiness({ organizationId: 7, projectId: 42 })),
    ).toEqual(readyEntrySnapshotFixture)
  })

  it('非法路由 id 不产生项目 scope', async () => {
    routeParams.current = { id: 'abc' }
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    const client = newClient()
    const { result } = renderHook(() => useCopilotReadiness(), { wrapper: makeWrapper(client) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(readinessMock).toHaveBeenCalledWith({ organizationId: 7, projectId: null })
  })

  it('无有效组织时不发请求', async () => {
    authState.current = { currentOrganizationId: null, user: null }
    const client = newClient()
    const { result } = renderHook(() => useCopilotReadiness(), { wrapper: makeWrapper(client) })
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(readinessMock).not.toHaveBeenCalled()
  })

  it('缓存按 scope 隔离：旧 scope 的响应不会落到新 scope 的缓存槽', async () => {
    const projectSnapshot = {
      ...readyEntrySnapshotFixture,
      evaluatedAt: '2026-08-24T03:00:00.000Z',
    }
    readinessMock.mockImplementation(async (scope: { projectId: number | null }) =>
      scope.projectId === 42 ? projectSnapshot : readyEntrySnapshotFixture,
    )
    const client = newClient()

    routeParams.current = { id: '42' }
    const first = renderHook(() => useCopilotReadiness(), { wrapper: makeWrapper(client) })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    first.unmount()

    routeParams.current = {}
    const second = renderHook(() => useCopilotReadiness(), { wrapper: makeWrapper(client) })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))

    expect(
      client.getQueryData(copilotKeys.readiness({ organizationId: 7, projectId: 42 })),
    ).toEqual(projectSnapshot)
    expect(
      client.getQueryData(copilotKeys.readiness({ organizationId: 7, projectId: null })),
    ).toEqual(readyEntrySnapshotFixture)
    expect(second.result.current.data).toEqual(readyEntrySnapshotFixture)
  })

  it('权限/校验类失败不重试；服务/限流类按上限重试', () => {
    expect(shouldRetryCopilotReadiness(0, ENTRY_FIXTURE_API_ERRORS.permission)).toBe(false)
    expect(shouldRetryCopilotReadiness(0, ENTRY_FIXTURE_API_ERRORS.validation)).toBe(false)
    expect(shouldRetryCopilotReadiness(0, ENTRY_FIXTURE_API_ERRORS.stale)).toBe(false)
    expect(shouldRetryCopilotReadiness(0, ENTRY_FIXTURE_API_ERRORS.service)).toBe(true)
    expect(shouldRetryCopilotReadiness(0, ENTRY_FIXTURE_API_ERRORS.rateLimit)).toBe(true)
    expect(
      shouldRetryCopilotReadiness(COPILOT_READINESS_MAX_RETRIES, ENTRY_FIXTURE_API_ERRORS.service),
    ).toBe(false)
  })
})

// ===========================================================================
// 4.2 —— store 边界
// ===========================================================================

describe('4.2 copilot store entry state', () => {
  it('入口态默认值：生产通道、无演示声明、无失败、无 retry envelope', () => {
    const state = useCopilotStore.getState()
    expect(state.mode).toBe('live')
    expect(state.demoCapabilityDeclared).toBe(false)
    expect(state.demoSelected).toBe(false)
    expect(state.failure).toBeNull()
    expect(state.retryEnvelope).toBeNull()
    expect(state.scopeNotice).toBeNull()
  })

  it('持久化白名单只含宽度/用户模式/自动展开——readiness 与输入一律不落盘', () => {
    act(() => {
      const state = useCopilotStore.getState()
      state.setWidth(480)
      state.setDraft('这是一段不该落盘的输入')
      state.setRetryEnvelope(buildCopilotRetryEnvelope({ text: '同样不该落盘', currentRoute: '/' }))
      state.setFailure({
        kind: 'permission',
        retryable: false,
        preserveDraft: true,
        requiresReauth: false,
        refreshReadiness: true,
        allowsDemonstration: false,
        messageKey: 'copilot.entry.failure.permission',
      })
      state.setQuickStartSelection(readyEntrySnapshotFixture.quickStarts[0]!)
      state.setDemoCapabilityDeclared(true)
    })

    const persisted = JSON.parse(localStorage.getItem(COPILOT_STORE_KEY) ?? '{}')
    expect(Object.keys(persisted.state).sort()).toEqual([
      'autoExpandEnabled',
      'copilotUserMode',
      'width',
    ])
    const raw = localStorage.getItem(COPILOT_STORE_KEY) ?? ''
    expect(raw).not.toContain('不该落盘')
    expect(raw).not.toContain('permission')
    expect(raw).not.toContain('readiness')
  })

  it('resetSession 清空失败分类、retry envelope、quick start 选择与 scope 提示', () => {
    act(() => {
      const state = useCopilotStore.getState()
      state.setRetryEnvelope(buildCopilotRetryEnvelope({ text: 'x', currentRoute: '/' }))
      state.setQuickStartSelection(readyEntrySnapshotFixture.quickStarts[0]!)
      state.setScopeNotice({
        previousLabel: '全局',
        nextLabel: '项目 #42',
        previousProjectId: null,
        nextProjectId: 42,
      })
      state.setDemoCapabilityDeclared(true)
      state.enterExplicitDemonstration()
      state.resetSession()
    })
    const state = useCopilotStore.getState()
    expect(state.retryEnvelope).toBeNull()
    expect(state.quickStartSelection).toBeNull()
    expect(state.scopeNotice).toBeNull()
    expect(state.failure).toBeNull()
    expect(state.demoSelected).toBe(false)
  })

  it('retry envelope 有界截断', () => {
    const envelope = buildCopilotRetryEnvelope({
      text: 'x'.repeat(COPILOT_RETRY_ENVELOPE_MAX_TEXT + 500),
      currentRoute: '/projects/7',
    })
    expect(envelope.text.length).toBe(COPILOT_RETRY_ENVELOPE_MAX_TEXT)
    expect(envelope.currentRoute).toBe('/projects/7')
  })
})

// ===========================================================================
// 4.3 —— 生产错误不再变成演示成功
// ===========================================================================

describe('4.3 live submission failure classification', () => {
  const productionErrors = [
    ENTRY_FIXTURE_API_ERRORS.permission,
    ENTRY_FIXTURE_API_ERRORS.validation,
    ENTRY_FIXTURE_API_ERRORS.rateLimit,
    ENTRY_FIXTURE_API_ERRORS.stale,
    ENTRY_FIXTURE_API_ERRORS.conflict,
    ENTRY_FIXTURE_API_ERRORS.service,
  ]

  it.each(productionErrors)('%o 保持 live 失败态，不追加 fixture 回复', async (error) => {
    resetStore()
    submitTurnMock.mockRejectedValue(error)

    await act(async () => {
      await submitCopilotTurn({ text: '帮我看下进度', mentions: [], currentRoute: '/projects/7' })
    })

    const state = useCopilotStore.getState()
    expect(state.mode).toBe('live')
    expect(state.turn).toBeNull()
    expect(state.failure?.allowsDemonstration).toBe(false)
    // 只落用户消息，绝不追加 assistant fixture 回复
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.role).toBe('user')
    expect(state.demoActions).toEqual([])
    expect(state.demoAssumptions).toEqual([])
  })

  it('未知错误默认 live failure（unknown），不进入演示', async () => {
    submitTurnMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await act(async () => {
      await submitCopilotTurn({ text: '帮我看下进度', mentions: [], currentRoute: '/projects/7' })
    })
    const state = useCopilotStore.getState()
    expect(state.mode).toBe('live')
    expect(state.failure?.kind).toBe('unknown')
    expect(state.streamPhase).toBe('error')
  })

  it('可恢复输入按分类保留，并可重放', async () => {
    submitTurnMock.mockRejectedValueOnce(ENTRY_FIXTURE_API_ERRORS.service)
    await act(async () => {
      await submitCopilotTurn({ text: '帮我看下进度', mentions: [], currentRoute: '/projects/7' })
    })
    expect(useCopilotStore.getState().retryEnvelope?.text).toBe('帮我看下进度')

    submitTurnMock.mockResolvedValueOnce({
      sessionId: 'csess_live_1',
      mode: 'live',
      result: {
        kind: 'answer',
        assistantMessageId: 'cpm-assistant-1',
        content: '这是可恢复重试后的真实回答。',
      },
    })
    await act(async () => {
      await retryCopilotTurn()
    })
    expect(submitTurnMock).toHaveBeenCalledTimes(2)
    expect(useCopilotStore.getState().retryEnvelope).toBeNull()
  })

  it('不可重试的失败不重放', async () => {
    submitTurnMock.mockRejectedValue(ENTRY_FIXTURE_API_ERRORS.permission)
    await act(async () => {
      await submitCopilotTurn({ text: '帮我改任务', mentions: [], currentRoute: '/projects/7' })
    })
    submitTurnMock.mockClear()
    await act(async () => {
      await retryCopilotTurn()
    })
    expect(submitTurnMock).not.toHaveBeenCalled()
  })

  it('失败文案只描述类别与下一步，不透传后端信息', () => {
    const outcome = {
      kind: 'permission' as const,
      retryable: false,
      preserveDraft: true,
      requiresReauth: false,
      refreshReadiness: true,
      allowsDemonstration: false as const,
      messageKey: 'copilot.entry.failure.permission',
    }
    const copy = describeCopilotFailure(outcome)
    expect(copy).toContain('权限')
    expect(copy).not.toContain('403')
    expect(copy).not.toContain('PERMISSION_DENIED')
  })
})

// ===========================================================================
// 4.4 —— 演示态显式准入
// ===========================================================================

describe('4.4 explicit demonstration gate', () => {
  it('宿主未声明时用户无法进入演示', () => {
    let entered = true
    act(() => {
      entered = useCopilotStore.getState().enterExplicitDemonstration()
    })
    expect(entered).toBe(false)
    expect(useCopilotStore.getState().mode).toBe('live')
    expect(useCopilotStore.getState().demoSelected).toBe(false)
  })

  it('宿主声明但用户未选择时仍不进入演示', () => {
    act(() => {
      useCopilotStore.getState().setDemoCapabilityDeclared(true)
    })
    expect(useCopilotStore.getState().mode).toBe('live')
    expect(useCopilotStore.getState().demoSelected).toBe(false)
  })

  it('声明 + 显式选择才进入演示，且零网络零写入', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    let entered = false
    act(() => {
      useCopilotStore.getState().setDemoCapabilityDeclared(true)
      entered = useCopilotStore.getState().enterExplicitDemonstration()
    })

    expect(entered).toBe(true)
    expect(useCopilotStore.getState().mode).toBe('demonstration')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(submitTurnMock).not.toHaveBeenCalled()
  })

  it('提供返回 readiness 评估的动作', () => {
    act(() => {
      const state = useCopilotStore.getState()
      state.setDemoCapabilityDeclared(true)
      state.enterExplicitDemonstration()
      state.exitDemonstration()
    })
    const state = useCopilotStore.getState()
    expect(state.mode).toBe('live')
    expect(state.demoSelected).toBe(false)
    expect(state.messages).toEqual([])
    expect(state.demoActions).toEqual([])
  })

  it('能力声明只读构建期显式开关，不从 NODE_ENV 或错误推断', () => {
    expect(readCopilotDemoCapability({ [COPILOT_DEMO_CAPABILITY_ENV]: '1' })).toBe(true)
    expect(readCopilotDemoCapability({ [COPILOT_DEMO_CAPABILITY_ENV]: '0' })).toBe(false)
    expect(readCopilotDemoCapability({ NODE_ENV: 'development' })).toBe(false)
    expect(readCopilotDemoCapability({})).toBe(false)
  })
})

// ===========================================================================
// 4.5 —— scope 变更保护
// ===========================================================================

type ScopeGuardProps = { projectId: number | null; label: string | null }

describe('4.5 scope change protection', () => {
  it('scope 展示名：组织级用全局，项目名不可用时给中性占位', () => {
    expect(copilotScopeLabel(null)).toBe(COPILOT_GLOBAL_SCOPE_LABEL)
    expect(copilotScopeLabel(42, '灯塔迁移项目')).toBe('灯塔迁移项目')
    expect(copilotScopeLabel(42, null)).toBe('项目 #42')
  })

  it('project→project 变更且草稿非空：保留草稿、提示新旧 scope、禁止提交', async () => {
    act(() => {
      useCopilotStore.getState().setDraft('这段草稿必须保留')
    })

    const { rerender } = renderHook((props: ScopeGuardProps) => useCopilotScopeGuard(props), {
      initialProps: { projectId: 42, label: '灯塔迁移项目' } as ScopeGuardProps,
    })
    rerender({ projectId: 43, label: '第二个项目' })

    const state = useCopilotStore.getState()
    expect(state.draft).toBe('这段草稿必须保留')
    expect(state.scopeNotice).toEqual({
      previousLabel: '灯塔迁移项目',
      nextLabel: '第二个项目',
      previousProjectId: 42,
      nextProjectId: 43,
    })

    submitTurnMock.mockResolvedValue({ sessionId: 'x', mode: 'live' })
    await act(async () => {
      await submitCopilotTurn({
        text: '这段草稿必须保留',
        mentions: [],
        currentRoute: '/projects/43',
      })
    })
    expect(submitTurnMock).not.toHaveBeenCalled()
  })

  it('project→global 同样触发提示', () => {
    act(() => {
      useCopilotStore.getState().setDraft('草稿')
    })
    const { rerender } = renderHook((props: ScopeGuardProps) => useCopilotScopeGuard(props), {
      initialProps: { projectId: 42, label: '灯塔迁移项目' } as ScopeGuardProps,
    })
    rerender({ projectId: null, label: null })
    expect(useCopilotStore.getState().scopeNotice?.nextLabel).toBe(COPILOT_GLOBAL_SCOPE_LABEL)
  })

  it('草稿为空时不打扰用户', () => {
    const { rerender } = renderHook((props: ScopeGuardProps) => useCopilotScopeGuard(props), {
      initialProps: { projectId: 42, label: '灯塔迁移项目' } as ScopeGuardProps,
    })
    rerender({ projectId: 43, label: '第二个项目' })
    expect(useCopilotStore.getState().scopeNotice).toBeNull()
  })

  it('scope 变更作废上一 scope 的 quick start 选择', () => {
    act(() => {
      useCopilotStore.getState().setQuickStartSelection(readyEntrySnapshotFixture.quickStarts[0]!)
    })
    const { rerender } = renderHook((props: ScopeGuardProps) => useCopilotScopeGuard(props), {
      initialProps: { projectId: 42, label: '灯塔迁移项目' } as ScopeGuardProps,
    })
    rerender({ projectId: 43, label: '第二个项目' })
    expect(useCopilotStore.getState().quickStartSelection).toBeNull()
  })

  it('同一 scope 内展示名刷新不算变更', () => {
    act(() => {
      useCopilotStore.getState().setDraft('草稿')
    })
    const { rerender } = renderHook((props: ScopeGuardProps) => useCopilotScopeGuard(props), {
      initialProps: { projectId: 42, label: null } as ScopeGuardProps,
    })
    rerender({ projectId: 42, label: '灯塔迁移项目' })
    expect(useCopilotStore.getState().scopeNotice).toBeNull()
  })

  it('确认后恢复提交能力', async () => {
    act(() => {
      useCopilotStore.getState().setDraft('草稿')
    })
    const { rerender } = renderHook((props: ScopeGuardProps) => useCopilotScopeGuard(props), {
      initialProps: { projectId: 42, label: '灯塔迁移项目' } as ScopeGuardProps,
    })
    rerender({ projectId: 43, label: '第二个项目' })
    expect(useCopilotStore.getState().scopeNotice).not.toBeNull()

    act(() => {
      useCopilotStore.getState().acknowledgeScopeNotice()
    })
    submitTurnMock.mockResolvedValue({ sessionId: 'csess_x', mode: 'live' })
    await act(async () => {
      await submitCopilotTurn({ text: '草稿', mentions: [], currentRoute: '/projects/43' })
    })
    expect(submitTurnMock).toHaveBeenCalledTimes(1)
  })

  it('刷新后（首次挂载）不产生提示', () => {
    act(() => {
      useCopilotStore.getState().setDraft('草稿')
    })
    renderHook(() => useCopilotScopeGuard({ projectId: 43, label: '第二个项目' }))
    expect(useCopilotStore.getState().scopeNotice).toBeNull()
  })
})
