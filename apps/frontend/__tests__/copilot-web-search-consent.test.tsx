/**
 * v3-copilot-optional-web-search-configuration §2.4 —— 按次开关与引用分区前端测试。
 *
 * 覆盖：
 * - 默认不联网：不带 webSearchConsent 提交时请求体为 false（可能触发的服务端
 *   五门判定仍以组织/场景/权限/router 必要性为准）
 * - 显式同意：开启开关后提交携带 webSearchConsent: true，提交后开关复位（按次）
 * - answer-done 事件转发 webSearchStatus → store 状态 → 消息列表引用分区渲染；
 *   降级状态显示「外部资料不可用」而非假引用
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { CopilotSidebarPanel } from '@/components/copilot/CopilotSidebarPanel'
import { CopilotMessageList } from '@/components/copilot/CopilotMessageList'
import { useCopilotStore } from '@/stores/copilot-store'
import { submitCopilotTurn } from '@/lib/copilot/submit'

const streamBodies: Array<Record<string, unknown>> = []

vi.mock('@/lib/api/copilot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/copilot')>('@/lib/api/copilot')
  return {
    ...actual,
    copilotApi: {
      readiness: vi.fn(),
      submitTurn: vi.fn(),
      // 流式提交：捕获请求体，派发 turn-error（不完整流），供请求形状断言
      submitTurnStream: async (...args: unknown[]) => {
        const request = args[0] as Record<string, unknown>
        streamBodies.push(request)
        const handlers = args[1] as {
          onOpen?: () => void
          onEvent: (event: Record<string, unknown>) => void
        }
        handlers.onOpen?.()
        handlers.onEvent({
          type: 'turn-error',
          sequence: 1,
          errorKind: 'retryable-service',
        })
      },
    },
  }
})

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7' }),
  usePathname: () => '/projects/7',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: ['ai:trigger'],
    canAny: () => true,
    can: () => true,
    canAll: () => true,
  }),
}))

function resetStore() {
  act(() => {
    useCopilotStore.setState({
      open: true,
      form: 'drawer',
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
      webSearchStatus: null,
    })
  })
  streamBodies.length = 0
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CopilotSidebarPanel />
    </QueryClientProvider>,
  )
}

beforeEach(resetStore)
afterEach(() => {
  vi.restoreAllMocks()
  resetStore()
})

describe('Copilot 按次网页搜索同意（v3-copilot-optional-web-search-configuration）', () => {
  it('默认不联网：未开启开关提交时请求体 webSearchConsent=false', async () => {
    await submitCopilotTurn({
      text: '本地消防申报要求是什么',
      mentions: [],
      currentRoute: '/projects/7',
    })
    expect(streamBodies).toHaveLength(1)
    expect(streamBodies[0]!.webSearchConsent).toBe(false)
  })

  it('显式同意：webSearchConsent: true 传入请求体', async () => {
    await submitCopilotTurn({
      text: '本地消防申报要求是什么',
      mentions: [],
      currentRoute: '/projects/7',
      webSearchConsent: true,
    })
    expect(streamBodies[0]!.webSearchConsent).toBe(true)
  })

  it('面板开关：开启后提交携带同意，提交后按次复位为关闭', async () => {
    renderPanel()
    const toggle = await screen.findByRole('switch', { name: '允许本次使用网页搜索' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    // 开启后显示用途预览
    expect(screen.getByText(/可能发送你问题涉及的主题/)).toBeTruthy()

    const input = await screen.findByLabelText('AI Copilot 输入框')
    fireEvent.change(input, { target: { value: '本地消防申报要求' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => expect(streamBodies.length).toBe(1))
    expect(streamBodies[0]!.webSearchConsent).toBe(true)
    // 按次：提交后复位
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  })

  it('引用分区：called 状态显示外部来源提示', async () => {
    act(() => {
      useCopilotStore.setState({
        messages: [
          {
            messageId: 'm1',
            sessionId: 's1',
            role: 'assistant',
            messageSummary: '回答',
            sourceRefs: [],
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        webSearchStatus: {
          code: 'web_search_called',
          message: '已使用外部网页搜索（结果带引用来源）。',
        },
      })
    })
    render(
      <CopilotMessageList
        messages={useCopilotStore.getState().messages}
        onPickExample={() => {}}
      />,
    )
    expect(screen.getByText('已使用外部网页搜索')).toBeTruthy()
    expect(screen.getByText(/外部来源带引用标记/)).toBeTruthy()
  })

  it('引用分区：降级状态显示「外部资料不可用」且不出现假引用', async () => {
    act(() => {
      useCopilotStore.setState({
        messages: [
          {
            messageId: 'm2',
            sessionId: 's1',
            role: 'assistant',
            messageSummary: '内部数据回答',
            sourceRefs: [],
            createdAt: '2026-09-01T00:00:00.000Z',
          },
        ],
        webSearchStatus: {
          code: 'web_search_timeout',
          message: '外部搜索超时；已继续使用内部资料。',
        },
      })
    })
    render(
      <CopilotMessageList
        messages={useCopilotStore.getState().messages}
        onPickExample={() => {}}
      />,
    )
    expect(screen.getByText('外部资料不可用')).toBeTruthy()
    expect(screen.getByText(/外部搜索超时/)).toBeTruthy()
    expect(screen.queryByText(/外部来源带引用标记/)).toBeNull()
  })
})
