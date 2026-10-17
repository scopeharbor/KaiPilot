/**
 * W1 生成剧场 SSE 客户端单元测试（tasks.md 1.3）：
 * - Mock ReadableStream 注入正常 9 模块事件序列 / 乱序 / 重复 sequence；
 * - 单调过滤器准确放行与丢弃（RL-07）；
 * - 跨 chunk 分帧（半帧边界）增量解码；
 * - AbortController 中断时底层 reader 的 cancel 释放。
 */

import { describe, expect, test } from 'vitest'
import { PROJECT_DRAFT_MODULES, type ProjectDraftStreamEvent } from '@aiproj/types'
import {
  createSequenceFilter,
  filterAndAcceptEvent,
  isSequencePassThroughEvent,
  isStreamResetErrorCode,
  runDraftGenerationStream,
  STREAM_RESET_ERROR_CODES,
  type TheaterSseClientOptions,
  type TheaterStreamOutcome,
} from '@/lib/next/theater-sse-client'
import {
  completedDraftEvent,
  createChunkedSseStream,
  createMockSseStream,
  deltaEvent,
  heartbeatEvent,
  makeContext,
  moduleCompletedEvent,
  outputEvent,
  progressEvent,
  responseOf,
  sseFrame,
  startedEvent,
  TEST_DRAFT_ID,
  warningEvent,
} from './_next-theater-sse-fixtures'

function nonReplayTransport(
  overrides: Partial<TheaterSseClientOptions['transport']> = {},
): TheaterSseClientOptions['transport'] {
  return {
    openStream: async () => {
      throw new Error('本测试不应发起生成流')
    },
    openReplay: async () => {
      throw new Error('本测试不应发起续传')
    },
    fetchSnapshot: async () => {
      throw new Error('本测试不应触发快照降级')
    },
    ...overrides,
  }
}

describe('filterAndAcceptEvent 单调递增校验（设计 Decision 3）', () => {
  test('严格推进、重复/倒序丢弃、保活通道恒放行且不推进游标', () => {
    const state = createSequenceFilter()

    expect(filterAndAcceptEvent(startedEvent(1), state)).toBe(true)
    expect(state.lastSequence).toBe(1)

    // 重复 sequence → 丢弃
    expect(filterAndAcceptEvent(startedEvent(1), state)).toBe(false)
    expect(state.lastSequence).toBe(1)

    // 跳号（2 缺失）但单调 → 接受
    expect(filterAndAcceptEvent(progressEvent(3), state)).toBe(true)
    expect(state.lastSequence).toBe(3)

    // 倒序（历史包重放）→ 丢弃
    expect(filterAndAcceptEvent(moduleCompletedEvent('charter', 2), state)).toBe(false)
    expect(state.lastSequence).toBe(3)

    // 零序号保活 / 瞬时输出通道 → 恒放行，不推进游标
    expect(filterAndAcceptEvent(heartbeatEvent(), state)).toBe(true)
    expect(filterAndAcceptEvent(outputEvent('片段'), state)).toBe(true)
    expect(state.lastSequence).toBe(3)

    expect(isSequencePassThroughEvent('draft.heartbeat')).toBe(true)
    expect(isSequencePassThroughEvent('generation.output')).toBe(true)
    expect(isSequencePassThroughEvent('module.delta')).toBe(false)
    expect(isStreamResetErrorCode('STREAM_RETENTION_MISS')).toBe(true)
    expect(isStreamResetErrorCode('STREAM_REPLAY_RESET_REQUIRED')).toBe(true)
    expect(isStreamResetErrorCode('AI_SERVICE_ERROR')).toBe(false)
    expect(STREAM_RESET_ERROR_CODES.size).toBe(2)
  })
})

describe('runDraftGenerationStream 流式消费与单调过滤', () => {
  function runWith(
    transportOverrides: Partial<TheaterSseClientOptions['transport']> = {},
    onEvent?: (event: ProjectDraftStreamEvent) => void,
  ): { outcome: Promise<TheaterStreamOutcome>; received: ProjectDraftStreamEvent[] } {
    const received: ProjectDraftStreamEvent[] = []
    const outcome = runDraftGenerationStream({
      context: makeContext(),
      transport: nonReplayTransport(transportOverrides),
      onEvent: (event) => {
        received.push(event)
        onEvent?.(event)
      },
    })
    return { outcome, received }
  }

  test('9 模块按序到达时正常推进并抵达 completed 终态', async () => {
    const frames: string[] = [sseFrame('draft.started', startedEvent(1))]
    let sequence = 2
    for (const module of PROJECT_DRAFT_MODULES) {
      frames.push(sseFrame('module.delta', deltaEvent(module, sequence++)))
      frames.push(sseFrame('module.completed', moduleCompletedEvent(module, sequence++)))
    }
    frames.push(sseFrame('draft.progress', progressEvent(sequence++)))
    frames.push(sseFrame('validation.warning', warningEvent(sequence++)))
    frames.push(sseFrame('draft.heartbeat', heartbeatEvent()))
    frames.push(sseFrame('generation.output', outputEvent('正在生成草案结构…')))
    frames.push(sseFrame('draft.completed', completedDraftEvent(sequence)))

    const { outcome, received } = runWith({
      openStream: async () => responseOf(createMockSseStream(frames)),
    })
    const result = await outcome

    expect(result.status).toBe('completed')
    expect(result.draftId).toBe(TEST_DRAFT_ID)
    expect(result.lastSequence).toBe(sequence)

    // started + 9 模块 ×2 + progress + warning + heartbeat + output + completed
    expect(received).toHaveLength(1 + 9 * 2 + 2 + 1 + 1 + 1)

    const semanticSequences = received
      .filter((event) => event.sequence > 0)
      .map((event) => event.sequence)
    for (let index = 1; index < semanticSequences.length; index++) {
      expect(semanticSequences[index]!).toBeGreaterThan(semanticSequences[index - 1]!)
    }
    expect(received[received.length - 1]!.type).toBe('draft.completed')

    // 9 模块完成事件按契约顺序到达
    const completedModules = received
      .filter((event) => event.type === 'module.completed')
      .map(
        (event) => (event as Extract<ProjectDraftStreamEvent, { type: 'module.completed' }>).module,
      )
    expect(completedModules).toEqual([...PROJECT_DRAFT_MODULES])
  })

  test('重复与乱序 sequence 事件被单调过滤器安全过滤', async () => {
    const frames = [
      sseFrame('draft.started', startedEvent(1)),
      sseFrame('module.delta', deltaEvent('charter', 2)),
      sseFrame('module.delta', deltaEvent('charter', 2)), // 重复包
      sseFrame('module.delta', deltaEvent('wbs', 2)), // 乱序（回放包）
      sseFrame('module.completed', moduleCompletedEvent('charter', 3)),
      sseFrame('module.delta', deltaEvent('tasks', 2)), // 迟到的旧包
      sseFrame('module.delta', deltaEvent('tasks', 4)),
      sseFrame('module.completed', moduleCompletedEvent('tasks', 5)),
    ]

    const { outcome, received } = runWith({
      openStream: async () => responseOf(createMockSseStream(frames)),
      // 流正常收尾后客户端自动续传，续传补发终态
      openReplay: async () =>
        responseOf(createMockSseStream([sseFrame('draft.completed', completedDraftEvent(6))])),
    })
    const result = await outcome

    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(received.filter((event) => event.type === 'module.delta')).toHaveLength(2)
    expect(result.lastSequence).toBe(6)
    expect(result.status).toBe('completed')
  })

  test('保活与瞬时输出通道在流内恒放行且不推进游标', async () => {
    const frames = [
      sseFrame('draft.started', startedEvent(1)),
      sseFrame('draft.heartbeat', heartbeatEvent(0, 4_000)),
      sseFrame('generation.output', outputEvent('第一批文本')),
      sseFrame('module.delta', deltaEvent('charter', 2)),
      sseFrame('draft.heartbeat', heartbeatEvent(0, 9_000)),
      sseFrame('generation.output', outputEvent('第二批文本')),
      sseFrame('module.completed', moduleCompletedEvent('charter', 3)),
      sseFrame('draft.completed', completedDraftEvent(4)),
    ]

    const { outcome, received } = runWith({
      openStream: async () => responseOf(createMockSseStream(frames)),
    })
    const result = await outcome

    expect(received.map((event) => event.sequence)).toEqual([1, 0, 0, 2, 0, 0, 3, 4])
    expect(received.filter((event) => event.type === 'draft.heartbeat')).toHaveLength(2)
    expect(received.filter((event) => event.type === 'generation.output')).toHaveLength(2)
    expect(result.lastSequence).toBe(4)
    expect(result.status).toBe('completed')
  })

  test('跨 chunk 半帧边界增量解码不丢帧', async () => {
    const frames = [
      sseFrame('draft.started', startedEvent(1)),
      sseFrame('module.delta', deltaEvent('charter', 2)),
      sseFrame('module.completed', moduleCompletedEvent('charter', 3)),
      sseFrame('validation.warning', warningEvent(4)),
      sseFrame('draft.completed', completedDraftEvent(5)),
    ]

    const { outcome, received } = runWith({
      openStream: async () => responseOf(createChunkedSseStream(frames, 7)),
    })
    const result = await outcome

    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(result.lastSequence).toBe(5)
    expect(result.status).toBe('completed')
  })

  test('AbortController 中止时底层 reader 被 cancel 且返回 aborted', async () => {
    let cancelCalled = false
    const controller = new AbortController()
    const frames = [
      sseFrame('draft.started', startedEvent(1)),
      sseFrame('module.delta', deltaEvent('charter', 2)),
    ]
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const frame of frames) c.enqueue(encoder.encode(frame))
        // 永不 close：模拟长连接
      },
      cancel() {
        cancelCalled = true
      },
    })

    const received: ProjectDraftStreamEvent[] = []
    const outcome = runDraftGenerationStream({
      context: makeContext(),
      signal: controller.signal,
      transport: nonReplayTransport({
        openStream: async () => responseOf(stream),
      }),
      onEvent: (event) => {
        received.push(event)
        if (received.length === 2) controller.abort()
      },
    })
    const result = await outcome

    expect(result.status).toBe('aborted')
    expect(received.map((event) => event.sequence)).toEqual([1, 2])
    expect(cancelCalled).toBe(true)
  })

  test('初始生成连接建立失败返回 SSE_CONNECTION_FAILED', async () => {
    const { outcome } = runWith({
      openStream: async () => {
        throw new Error('网络不可达')
      },
    })
    const result = await outcome

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('SSE_CONNECTION_FAILED')
  })
})
describe('runDraftGenerationStream retryOf 会话复用重试', () => {
  test('retryOf 走 openRetry（带 draftId 与生成输入），不触 openStream / openReplay', async () => {
    const frames = [
      sseFrame('draft.started', startedEvent(11)),
      sseFrame('module.completed', moduleCompletedEvent('charter', 12)),
      sseFrame('draft.completed', completedDraftEvent(13)),
    ]
    const calls: Array<{ draftId: string; input: unknown }> = []
    const received: ProjectDraftStreamEvent[] = []
    const outcome = runDraftGenerationStream({
      context: makeContext(),
      connectionId: 7,
      modelId: 9,
      retryOf: TEST_DRAFT_ID,
      transport: nonReplayTransport({
        openRetry: async (draftId, input) => {
          calls.push({ draftId, input })
          return responseOf(createMockSseStream(frames))
        },
      }),
      onEvent: (event) => received.push(event),
    })
    const result = await outcome

    expect(result.status).toBe('completed')
    expect(result.draftId).toBe(TEST_DRAFT_ID)
    expect(result.lastSequence).toBe(13)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.draftId).toBe(TEST_DRAFT_ID)
    expect(calls[0]!.input).toMatchObject({ connectionId: 7, modelId: 9 })
    expect(received.map((event) => event.type)).toEqual([
      'draft.started',
      'module.completed',
      'draft.completed',
    ])
  })

  test('retryOf 与 resume 并存时以 resume 为准（续传优先，不触 openRetry）', async () => {
    const frames = [
      sseFrame('module.completed', moduleCompletedEvent('charter', 21)),
      sseFrame('draft.completed', completedDraftEvent(22)),
    ]
    let retryCalled = false
    const outcome = runDraftGenerationStream({
      context: makeContext(),
      resume: { draftId: TEST_DRAFT_ID, lastSequence: 20 },
      retryOf: TEST_DRAFT_ID,
      transport: nonReplayTransport({
        openRetry: async () => {
          retryCalled = true
          throw new Error('不应调用 openRetry')
        },
        openReplay: async () => responseOf(createMockSseStream(frames)),
      }),
      onEvent: () => {},
    })
    const result = await outcome

    expect(result.status).toBe('completed')
    expect(retryCalled).toBe(false)
    expect(result.lastSequence).toBe(22)
  })

  test('transport 未实现 openRetry 时 retryOf 直接失败（SSE_RETRY_UNAVAILABLE）', async () => {
    const outcome = await runDraftGenerationStream({
      context: makeContext(),
      retryOf: TEST_DRAFT_ID,
      transport: nonReplayTransport(),
      onEvent: () => {},
    })
    const result = await outcome

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('SSE_RETRY_UNAVAILABLE')
  })
})

describe('没有可用 AI 连接（个人版导出 4.6）', () => {
  test('发起生成被 503 AI_CONNECTION_REQUIRED 拒绝时直接落定为提示，不重连', async () => {
    let openCalls = 0
    const result = await runDraftGenerationStream({
      context: makeContext(),
      transport: nonReplayTransport({
        openStream: async () => {
          openCalls += 1
          throw Object.assign(new Error('请先在设置中添加 AI 连接'), {
            status: 503,
            code: 'AI_SERVICE_ERROR',
            details: {
              reason: 'AI_CONNECTION_REQUIRED',
              settingsPath: '/next/settings/ai-connections',
            },
          })
        },
      }),
      onEvent: () => {},
    })

    expect(openCalls).toBe(1)
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('AI_CONNECTION_REQUIRED')
    expect(result.message).toBe('请先在设置中添加 AI 连接')
  })
})
