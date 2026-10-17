import { useAuthStore } from '@/stores/auth-store'
import { accessTokenWith } from './_jwt-helper'
/**
 * v3-copilot-live-streaming-output —— 流式客户端测试。
 *
 * 覆盖：
 * - SSE 帧解析（parseCopilotSseFrame / parseCopilotSseFrames：event 名与载荷
 *   一致、半帧 pending 拼接、畸形帧跳过）
 * - submitCopilotTurn 流式映射：answer-delta 增量追加 → answer-done 转正、
 *   turn-clarify / turn-route 终态映射、turn-error / 中断失败态不伪造完成
 * - CopilotMessageList 流式占位气泡渲染
 */

import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { useCopilotStore } from '@/stores/copilot-store'
import { CopilotMessageList } from '@/components/copilot/CopilotMessageList'
import { copilotApi, parseCopilotSseFrame, parseCopilotSseFrames } from '@/lib/api/copilot'
import { submitCopilotTurn } from '@/lib/copilot/submit'
import type { CopilotStreamEvent } from '@aiproj/types'

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
      streamingAssistant: null,
      degradeReason: null,
      clarificationRounds: 0,
    })
  })
  localStorage.clear()
}

beforeEach(resetStore)
afterEach(() => {
  vi.restoreAllMocks()
  resetStore()
})

// ---------------------------------------------------------------------------
// SSE 帧解析
// ---------------------------------------------------------------------------

describe('parseCopilotSseFrame', () => {
  test('标准帧解析出事件', () => {
    const frame = [
      'id: 2',
      'event: answer-delta',
      'data: {"type":"answer-delta","sequence":2,"delta":"第一段"}',
    ].join('\n')
    const event = parseCopilotSseFrame(frame)
    expect(event).not.toBeNull()
    expect(event).toMatchObject({ type: 'answer-delta', sequence: 2, delta: '第一段' })
  })

  test('服务端心跳注释行（: ping）被跳过，不影响前后事件', () => {
    expect(parseCopilotSseFrame(': ping')).toBeNull()
    const { events, pending } = parseCopilotSseFrames(
      ': ping\n\nid: 1\nevent: turn-meta\ndata: {"type":"turn-meta","sequence":1}\n\n: ping\n\n',
      '',
    )
    expect(events.map((event) => event.type)).toEqual(['turn-meta'])
    expect(pending).toBe('')
  })

  test('event 名与载荷类型不一致时跳过', () => {
    const frame = [
      'id: 2',
      'event: chunk',
      'data: {"type":"answer-delta","sequence":2,"delta":"x"}',
    ].join('\n')
    expect(parseCopilotSseFrame(frame)).toBeNull()
  })

  test('畸形 JSON 跳过', () => {
    const frame = ['event: turn-meta', 'data: {oops'].join('\n')
    expect(parseCopilotSseFrame(frame)).toBeNull()
  })

  test('非整数 sequence 跳过', () => {
    const frame = [
      'event: answer-delta',
      'data: {"type":"answer-delta","sequence":1.5,"delta":"x"}',
    ].join('\n')
    expect(parseCopilotSseFrame(frame)).toBeNull()
  })
})

describe('parseCopilotSseFrames', () => {
  test('连续帧解析 + 半帧 pending 拼接', () => {
    // 第一帧完整 + 第二帧不完整（缺结尾 \n\n 与剩余 data）
    const firstFrame = [
      'event: turn-meta',
      'data: {"type":"turn-meta","sequence":1,"sessionId":"s1","destinations":[],"intentSummary":"q","scope":"project"}',
      '',
      '',
    ].join('\n')
    const secondHalf = 'event: answer-delta\ndata: {"type":"answer-delta","sequence":2,"delta":"部'
    const first = parseCopilotSseFrames(firstFrame + secondHalf, '')
    expect(first.events).toHaveLength(1)
    expect(first.events[0]).toMatchObject({ type: 'turn-meta', sequence: 1 })
    expect(first.pending).toContain('answer-delta')

    const second = parseCopilotSseFrames('分"}\n\n', first.pending)
    expect(second.events).toHaveLength(1)
    expect(second.events[0]).toMatchObject({ type: 'answer-delta', delta: '部分' })
  })

  test('终态事件被识别', () => {
    const events: CopilotStreamEvent[] = [
      { type: 'answer-done', sequence: 3, assistantMessageId: 'm1', contentSummary: 's' },
    ]
    for (const e of events) {
      const frame = ['event: ' + e.type, 'data: ' + JSON.stringify(e)].join('\n')
      expect(parseCopilotSseFrame(frame)?.type).toBe(e.type)
    }
  })
})

// ---------------------------------------------------------------------------
// submit 流式映射
// ---------------------------------------------------------------------------

/** 构造一个模拟 SSE 响应体（ReadableStream），每帧一个 chunk。 */
function makeSseBody(frames: Array<{ event: string; data: unknown }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const parts: string[] = []
  for (const frame of frames) {
    parts.push(['event: ' + frame.event, 'data: ' + JSON.stringify(frame.data), '', ''].join('\n'))
  }
  const blob = encoder.encode(parts.join(''))
  return new ReadableStream({
    start(controller) {
      controller.enqueue(blob)
      controller.close()
    },
  })
}

const LIVE_REQUEST = {
  text: '项目现在怎么样',
  mentions: [],
  currentRoute: '/projects/7',
}

describe('submitCopilotTurn 流式路径', () => {
  test('answer-delta 增量追加 → answer-done 转正为正式消息', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: makeSseBody([
        {
          event: 'turn-meta',
          data: {
            type: 'turn-meta',
            sequence: 1,
            sessionId: 'sess-live-1',
            destinations: ['general_qa'],
            intentSummary: '查询项目状态',
            scope: 'project',
          },
        },
        { event: 'answer-delta', data: { type: 'answer-delta', sequence: 2, delta: '项目' } },
        { event: 'answer-delta', data: { type: 'answer-delta', sequence: 3, delta: '进展正常' } },
        {
          event: 'answer-done',
          data: {
            type: 'answer-done',
            sequence: 4,
            assistantMessageId: 'cpm-stream-1',
            contentSummary: '项目进展正常',
          },
        },
      ]),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await submitCopilotTurn(LIVE_REQUEST)

    const state = useCopilotStore.getState()
    // 流式占位已清空，正式 assistant 消息在
    expect(state.streamingAssistant).toBeNull()
    const assistant = state.messages.find((m) => m.role === 'assistant')
    expect(assistant).toBeDefined()
    expect(assistant?.messageSummary).toContain('项目进展正常')
    expect(state.turn).not.toBeNull()
    expect(state.streaming).toBe(false)
  })

  test('turn-clarify 终态映射到澄清 UI 状态', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: makeSseBody([
        {
          event: 'turn-meta',
          data: {
            type: 'turn-meta',
            sequence: 1,
            sessionId: 'sess-live-2',
            destinations: [],
            intentSummary: '',
            scope: 'project',
          },
        },
        {
          event: 'turn-clarify',
          data: {
            type: 'turn-clarify',
            sequence: 2,
            items: [{ slotId: 'target_task', label: '目标任务', tier: 'critical' }],
          },
        },
      ]),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await submitCopilotTurn({ ...LIVE_REQUEST, text: '为什么延期' })

    const state = useCopilotStore.getState()
    expect(state.turn?.clarificationRequired).toBe(true)
    expect(state.turn?.clarificationItems.length).toBeGreaterThan(0)
    expect(state.streamingAssistant).toBeNull()
  })

  test('turn-error 不伪造完成且保留已累积文本', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: makeSseBody([
        { event: 'answer-delta', data: { type: 'answer-delta', sequence: 1, delta: '部分回答' } },
        {
          event: 'turn-error',
          data: { type: 'turn-error', sequence: 2, errorKind: 'retryable-service' },
        },
      ]),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await submitCopilotTurn(LIVE_REQUEST)

    const state = useCopilotStore.getState()
    expect(state.failure).not.toBeNull()
    expect(state.turn).toBeNull()
    // 已累积文本转正为可见消息（保留）
    const assistant = state.messages.find((m) => m.role === 'assistant')
    expect(assistant?.messageSummary).toContain('部分回答')
    expect(state.streaming).toBe(false)
  })

  test('传输中断（无终态）按 retryable-service 失败处理', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      // 只有 chunk 没有终态 → 流读完即中断
      body: makeSseBody([
        { event: 'answer-delta', data: { type: 'answer-delta', sequence: 1, delta: '一段' } },
      ]),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await submitCopilotTurn(LIVE_REQUEST)

    const state = useCopilotStore.getState()
    expect(state.streaming).toBe(false)
    expect(state.turn).toBeNull()
    expect(state.failure?.kind).toBe('retryable-service')
  })
})

// ---------------------------------------------------------------------------
// 流式占位渲染
// ---------------------------------------------------------------------------

describe('CopilotMessageList 流式占位', () => {
  test('streamingAssistant 渲染增量文本', () => {
    act(() => {
      useCopilotStore.setState({
        streamingAssistant: { messageId: 'cpm-stream-x', content: '正在流式输出的回答…' },
      })
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CopilotMessageList messages={[]} onPickExample={() => {}} />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/正在流式输出的回答/)).toBeDefined()
    expect(document.querySelector('[data-copilot-streaming="live"]')).not.toBeNull()
  })

  test('空内容占位显示生成提示', () => {
    act(() => {
      useCopilotStore.setState({
        streamingAssistant: { messageId: 'cpm-stream-y', content: '' },
      })
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CopilotMessageList messages={[]} onPickExample={() => {}} />
      </QueryClientProvider>,
    )
    expect(screen.getByText(/正在生成/)).toBeDefined()
  })
})

test('切换登录身份中止旧流，并丢弃迟到帧与完成回调', async () => {
  const loginAs = (id: number) =>
    useAuthStore.getState().setSession({
      user: { id, email: `${id}@test.local`, fullName: null, organizations: [] },
      accessToken: accessTokenWith([]),
      refreshToken: `r-${id}`,
    })
  loginAs(101)
  let finishRead!: (value: { done: boolean; value?: Uint8Array }) => void
  let signal!: AbortSignal
  const fetchMock = vi.fn(async (_url, init) => {
    signal = init.signal
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((resolve) => {
              finishRead = resolve
            }),
          releaseLock: vi.fn(),
        }),
      },
    }
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  const onEvent = vi.fn()
  const onEnd = vi.fn()
  const pending = copilotApi.submitTurnStream(
    {
      sessionId: null,
      scope: 'global',
      attribution: {},
      text: '私有问题',
      mentions: [],
    },
    { onEvent, onEnd },
  )
  await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'))
  loginAs(102)
  expect(signal.aborted).toBe(true)
  finishRead({
    done: false,
    value: new TextEncoder().encode(
      'event: answer-delta\ndata: {"type":"answer-delta","sequence":1,"delta":"A 私有内容"}\n\n',
    ),
  })
  await expect(pending).rejects.toMatchObject({ code: 'AUTH_SCOPE_CHANGED' })
  expect(onEvent).not.toHaveBeenCalled()
  expect(onEnd).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  useAuthStore.getState().clear()
})
