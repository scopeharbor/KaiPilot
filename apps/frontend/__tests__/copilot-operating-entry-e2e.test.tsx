/**
 * v3-copilot-productized-operating-entry —— 端到端流程测试（任务 6.2 / 6.3）。
 *
 * 6.2 主流程：Dashboard readiness → quick start 填入 → 同一面板 live submit →
 *      mutation destination 呈现为待确认 → 确认仍由既有动作边界接管（入口不提供确认控件）。
 * 6.3 错误恢复：401 refresh、403、422、429、stale、retryable 5xx 与明确 demo；
 *      断言生产错误零 fixture answer、零外部调用、草稿按边界可恢复。
 *
 * 网络全部走 mock：`copilotApi` 被替换，`globalThis.fetch` 为 fail-fast 桩，
 * 因此 providerCalls / networkCalls / domainWrites 恒为 0。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { CopilotOperatingEntry } from '@/components/copilot/CopilotOperatingEntry'
import { CopilotSidebarPanel } from '@/components/copilot/CopilotSidebarPanel'
import { useCopilotStore } from '@/stores/copilot-store'
import { submitCopilotTurn, retryCopilotTurn } from '@/lib/copilot/submit'
import {
  ENTRY_FIXTURE_API_ERRORS,
  ENTRY_FIXTURE_SNAPSHOT_REVISION,
  ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION,
  readyEntrySnapshotFixture,
} from '@aiproj/types'
import type { CopilotTurnResponse } from '@aiproj/types'

// ---------------------------------------------------------------------------
// mock
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
          destinations: turn.destinations.map((d) => d.destination),
          intentSummary: turn.intentSummary,
          scope: turn.scope,
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

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '42' }),
  usePathname: () => '/projects/42',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/stores/auth-store', () => {
  const authState = { currentOrganizationId: 7, user: null, planTier: 'free', permissions: [] }
  const useAuthStore = (selector?: (state: unknown) => unknown) =>
    selector ? selector(authState) : authState
  useAuthStore.getState = () => authState
  useAuthStore.setState = vi.fn()
  useAuthStore.subscribe = vi.fn(() => () => {})
  return {
    useAuthStore,
    selectEffectiveOrganizationId: (state: { currentOrganizationId: number | null }) =>
      state.currentOrganizationId,
  }
})

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: ['ai:trigger', 'project:view'],
    can: () => true,
    canAny: () => true,
    canAll: () => true,
  }),
}))

/** mutation 类目的地：persistenceReachable 且要求人工确认。 */
const MUTATION_TURN: CopilotTurnResponse = {
  sessionId: 'csess_live_e2e',
  messageId: 'cpm_live_e2e',
  destinations: [
    {
      destination: 'draft_layer',
      confidence: 84,
      confidenceBand: 'high',
      evidenceRefs: [],
      parameterHints: [],
      reason: 'rule:mutation',
      requiresUserConfirmation: true,
    },
  ],
  clarificationRequired: false,
  clarificationItems: [],
  assumptionEntries: [],
  ambiguity: null,
  warnings: [],
  degradedReason: null,
  rejectedReferenceCount: 0,
  scope: 'project',
  intentSummary: '调整排期',
  stats: { ruleHitCount: 1, fallbackCount: 0 },
  mode: 'live',
  result: {
    kind: 'route',
    destinations: [
      {
        destination: 'draft_layer',
        confidence: 84,
        confidenceBand: 'high',
        evidenceRefs: [],
        parameterHints: [],
        reason: 'rule:mutation',
        requiresUserConfirmation: true,
      },
    ],
  },
}

let fetchCalls = 0

function renderEntryAndPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CopilotOperatingEntry />
      <CopilotSidebarPanel />
    </QueryClientProvider>,
  )
}

function entryEl(): HTMLElement {
  return document.querySelector('[data-copilot-entry]') as HTMLElement
}

async function waitForReady() {
  await waitFor(() => expect(entryEl()?.getAttribute('data-copilot-entry-state')).toBe('ready'))
}

beforeEach(() => {
  readinessMock.mockReset()
  submitTurnMock.mockReset()
  fetchCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (...args: unknown[]) => {
      fetchCalls += 1
      throw new Error(`默认测试不得发起真实网络调用：${String(args[0])}`)
    }),
  )
  act(() => {
    useCopilotStore.setState({
      open: false,
      form: 'drawer',
      draft: '',
      messages: [],
      mode: 'live',
      liveSessionId: null,
      turn: null,
      streaming: false,
      streamPhase: 'idle',
      streamError: null,
      demoActions: [],
      demoAssumptions: [],
      degradeReason: null,
      demoCapabilityDeclared: false,
      demoSelected: false,
      failure: null,
      retryEnvelope: null,
      quickStartSelection: null,
      scopeNotice: null,
      toolSnapshotRevision: null,
    })
  })
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ===========================================================================
// 6.2 —— 主流程
// ===========================================================================

describe('6.2 dashboard → quick start → same panel → pending review', () => {
  it('quick start 填入后在同一面板提交，mutation 目的地呈现为待确认且确认前零业务写入', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    submitTurnMock.mockResolvedValue(MUTATION_TURN)
    renderEntryAndPanel()
    await waitForReady()

    // ① 入口 readiness 就绪 → 选择 quick start（只填草稿，不提交）
    fireEvent.click(
      document.querySelector('[data-entry-quick-start="core.project-health"]') as HTMLButtonElement,
    )
    expect(submitTurnMock).not.toHaveBeenCalled()
    expect(useCopilotStore.getState().draft).toBe('帮我总结当前项目的健康度与主要风险。')

    // ② 面板已打开且是**同一个**面板（无第二个对话面）
    expect(useCopilotStore.getState().open).toBe(true)
    await waitFor(() => expect(document.querySelectorAll('[data-copilot-input]')).toHaveLength(1))

    // ③ 在面板内 live 提交
    await act(async () => {
      await submitCopilotTurn({
        text: useCopilotStore.getState().draft,
        mentions: [],
        currentRoute: '/projects/42',
      })
    })

    const state = useCopilotStore.getState()
    expect(submitTurnMock).toHaveBeenCalledTimes(1)
    expect(state.mode).toBe('live')
    expect(state.turn?.destinations[0]?.destination).toBe('draft_layer')

    // ④ mutation 目的地只作为「待确认」呈现：入口与面板都不提供任何执行/应用控件
    expect(state.turn?.destinations[0]?.requiresUserConfirmation).toBe(true)
    const entryText = entryEl().textContent ?? ''
    for (const forbidden of ['立即应用', '确认执行', '直接写入']) {
      expect(entryText).not.toContain(forbidden)
    }
    expect(document.querySelector('[data-copilot-entry] button[data-entry-confirm]')).toBeNull()

    // ⑤ 确认前零业务写入：唯一的服务端调用是回合端点，没有 confirm/apply 调用
    expect(fetchCalls).toBe(0)
    expect(submitTurnMock.mock.calls).toHaveLength(1)
    expect(state.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('主动作与 quick start 共用同一 store 与同一会话，不产生第二套历史', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    submitTurnMock.mockResolvedValue(MUTATION_TURN)
    renderEntryAndPanel()
    await waitForReady()

    fireEvent.click(document.querySelector('[data-entry-open]') as HTMLButtonElement)
    await act(async () => {
      await submitCopilotTurn({ text: '第一问', mentions: [], currentRoute: '/projects/42' })
    })
    const sessionAfterFirst = useCopilotStore.getState().liveSessionId

    act(() => {
      useCopilotStore.getState().setOpen(false)
    })
    fireEvent.click(
      document.querySelector('[data-entry-quick-start="core.project-health"]') as HTMLButtonElement,
    )
    await act(async () => {
      await submitCopilotTurn({ text: '第二问', mentions: [], currentRoute: '/projects/42' })
    })

    expect(useCopilotStore.getState().liveSessionId).toBe(sessionAfterFirst)
    expect(submitTurnMock.mock.calls[1]?.[0]).toMatchObject({ sessionId: sessionAfterFirst })
    expect(document.querySelectorAll('[data-copilot-input]')).toHaveLength(1)
  })

  it('插件 quick start 在快照更换后提交 fail closed，零调用', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntryAndPanel()
    await waitForReady()

    fireEvent.click(
      document.querySelector(
        '[data-entry-quick-start="plugin.triz.contradiction"]',
      ) as HTMLButtonElement,
    )
    await waitFor(() =>
      expect(useCopilotStore.getState().toolSnapshotRevision).toBe(ENTRY_FIXTURE_SNAPSHOT_REVISION),
    )

    act(() => {
      useCopilotStore.getState().setToolSnapshotRevision(ENTRY_FIXTURE_STALE_SNAPSHOT_REVISION)
    })
    await act(async () => {
      await submitCopilotTurn({ text: '分析矛盾', mentions: [], currentRoute: '/projects/42' })
    })

    expect(submitTurnMock).not.toHaveBeenCalled()
    expect(fetchCalls).toBe(0)
    expect(useCopilotStore.getState().failure?.kind).toBe('stale')
  })
})

// ===========================================================================
// 6.3 —— 错误恢复
// ===========================================================================

describe('6.3 error recovery flows', () => {
  const cases: readonly [string, unknown, string, boolean][] = [
    ['401 会话失效', ENTRY_FIXTURE_API_ERRORS.auth, 'auth', true],
    ['403 权限不足', ENTRY_FIXTURE_API_ERRORS.permission, 'permission', false],
    ['422 校验失败', ENTRY_FIXTURE_API_ERRORS.validation, 'validation', false],
    ['429 限流', ENTRY_FIXTURE_API_ERRORS.rateLimit, 'rate-limit', true],
    ['409 stale', ENTRY_FIXTURE_API_ERRORS.stale, 'stale', false],
    ['503 可重试服务故障', ENTRY_FIXTURE_API_ERRORS.service, 'retryable-service', true],
  ]

  it.each(cases)('%s：保持 live，零 fixture answer，零外部调用', async (_name, error, kind) => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    submitTurnMock.mockRejectedValue(error)
    renderEntryAndPanel()
    await waitForReady()

    await act(async () => {
      await submitCopilotTurn({ text: '帮我看下排期', mentions: [], currentRoute: '/projects/42' })
    })

    const state = useCopilotStore.getState()
    expect(state.mode).toBe('live')
    expect(state.failure?.kind).toBe(kind)
    expect(state.failure?.allowsDemonstration).toBe(false)
    // 零 fixture answer：没有 assistant 消息、没有演示动作/假设
    expect(state.messages.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(state.demoActions).toEqual([])
    expect(state.demoAssumptions).toEqual([])
    // 零外部调用：只有被 mock 的回合端点，没有真实 fetch
    expect(fetchCalls).toBe(0)
  })

  it.each(cases)('%s：草稿按边界可恢复', async (_name, error, _kind, retryable) => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    submitTurnMock.mockRejectedValue(error)
    renderEntryAndPanel()
    await waitForReady()

    await act(async () => {
      await submitCopilotTurn({ text: '帮我看下排期', mentions: [], currentRoute: '/projects/42' })
    })
    expect(useCopilotStore.getState().retryEnvelope?.text).toBe('帮我看下排期')

    submitTurnMock.mockClear()
    submitTurnMock.mockResolvedValue(MUTATION_TURN)
    await act(async () => {
      await retryCopilotTurn()
    })
    expect(submitTurnMock).toHaveBeenCalledTimes(retryable ? 1 : 0)
  })

  it('401 之后重放成功即恢复 live 结果（复用既有 refresh 通道）', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    submitTurnMock.mockRejectedValueOnce(ENTRY_FIXTURE_API_ERRORS.auth)
    renderEntryAndPanel()
    await waitForReady()

    await act(async () => {
      await submitCopilotTurn({ text: '帮我看下排期', mentions: [], currentRoute: '/projects/42' })
    })
    expect(useCopilotStore.getState().failure?.requiresReauth).toBe(true)

    submitTurnMock.mockResolvedValueOnce(MUTATION_TURN)
    await act(async () => {
      await retryCopilotTurn()
    })
    const state = useCopilotStore.getState()
    expect(state.turn?.sessionId).toBe('csess_live_e2e')
    expect(state.retryEnvelope).toBeNull()
    expect(state.mode).toBe('live')
  })

  it('明确 demo：只有宿主声明 + 用户选择才进入，且零网络零写入', async () => {
    readinessMock.mockResolvedValue(readyEntrySnapshotFixture)
    renderEntryAndPanel()
    await waitForReady()

    // 未声明：入口不给进入演示的控件，直接调用也不生效
    expect(document.querySelector('[data-entry-enter-demo]')).toBeNull()
    act(() => {
      expect(useCopilotStore.getState().enterExplicitDemonstration()).toBe(false)
    })

    // 声明后由用户显式选择
    act(() => {
      useCopilotStore.getState().setDemoCapabilityDeclared(true)
    })
    await waitFor(() => expect(document.querySelector('[data-entry-enter-demo]')).toBeTruthy())
    act(() => {
      ;(document.querySelector('[data-entry-enter-demo]') as HTMLButtonElement).click()
    })

    await waitFor(() => expect(useCopilotStore.getState().mode).toBe('demonstration'))
    await act(async () => {
      await submitCopilotTurn({ text: '演示一下', mentions: [], currentRoute: '/projects/42' })
    })

    expect(submitTurnMock).not.toHaveBeenCalled()
    expect(fetchCalls).toBe(0)
    expect(useCopilotStore.getState().streaming).toBe(true)

    // 返回生产通道
    act(() => {
      ;(document.querySelector('[data-entry-exit-demo]') as HTMLButtonElement).click()
    })
    await waitFor(() => expect(useCopilotStore.getState().mode).toBe('live'))
  })

  it('readiness 自身失败只影响入口局部，不影响面板可用性', async () => {
    readinessMock.mockRejectedValue(ENTRY_FIXTURE_API_ERRORS.validation)
    renderEntryAndPanel()
    await waitFor(() =>
      expect(entryEl().getAttribute('data-copilot-entry-state')).toBe('unavailable'),
    )
    // 面板本身仍然挂载（入口失败不阻塞其余应用）
    act(() => {
      useCopilotStore.getState().setOpen(true)
    })
    await waitFor(() => expect(document.querySelector('[data-copilot-input]')).toBeTruthy())
  })
})
