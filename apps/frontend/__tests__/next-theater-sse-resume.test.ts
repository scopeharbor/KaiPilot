/**
 * W1 断线重连与游标失效降级测试（tasks.md 1.4-1.6）：
 * - 传输中断 / EOF 后携带 Last-Event-ID 自动续传（GET /:id/events?after= + 请求头）；
 * - 最多 3 次指数退避（1s/2s/4s）后仍失败 → SSE_RECONNECT_EXHAUSTED；
 * - STREAM_RETENTION_MISS 不判死：自动降级 GET /:id 快照回放重建进度；
 *   已落定 → completed（recoveredFromSnapshot）；仍在进行 → 重置游标后继续 tail；
 * - 15 秒心跳停滞 → stale 健康标记 + 半开连接自动续传；
 * - 硬性等待上限（>180s 未完成且无心跳）→ STREAM_PROVIDER_TIMEOUT；
 * - defaultTheaterTransport 契约（Last-Event-ID 头 / ?after 参数 / POST body）。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ProjectDraftStreamEvent } from '@aiproj/types'
import {
  defaultTheaterTransport,
  runDraftGenerationStream,
  THEATER_STREAM_DEFAULTS,
  type TheaterSseTransport,
} from '@/lib/next/theater-sse-client'
import {
  completedDraftEvent,
  createErrorEndingStream,
  createMockSseStream,
  createSilentAfterSseStream,
  deltaEvent,
  failedEvent,
  makeContext,
  makeMockDraft,
  makeMockMeta,
  makeSnapshotDetail,
  makeMockValidation,
  moduleCompletedEvent,
  progressEvent,
  responseOf,
  sseFrame,
  startedEvent,
  TEST_DRAFT_ID,
} from './_next-theater-sse-fixtures'

vi.mock('@/lib/api-client', () => ({
  apiFetch: vi.fn(),
  apiRawFetch: vi.fn(),
}))
import { apiFetch, apiRawFetch } from '@/lib/api-client'

interface ReconnectRecord {
  attempt: number
  lastSequence: number
  delayMs: number
}

interface ReplayRecord {
  draftId: string
  lastSequence: number
}

function makeReplayRecordingTransport(
  replayRecords: ReplayRecord[],
  replayStreamFactory: (draftId: string, lastSequence: number) => Response,
  openStreamResponse: Response,
): TheaterSseTransport {
  return {
    openStream: async () => openStreamResponse,
    openReplay: async (draftId, lastSequence) => {
      replayRecords.push({ draftId, lastSequence })
      return replayStreamFactory(draftId, lastSequence)
    },
    fetchSnapshot: async () => {
      throw new Error('本测试不应触发快照降级')
    },
  }
}

describe('断点续传（Last-Event-ID）', () => {
  test('传输中断后自动携带 Last-Event-ID 续传并衔接剩余事件', async () => {
    const received: ProjectDraftStreamEvent[] = []
    const reconnectCalls: ReconnectRecord[] = []
    const replayRecords: ReplayRecord[] = []
    const firstStream = createErrorEndingStream(
      [
        sseFrame('draft.started', startedEvent(1)),
        sseFrame('module.delta', deltaEvent('charter', 2)),
        sseFrame('module.completed', moduleCompletedEvent('charter', 3)),
        sseFrame('module.delta', deltaEvent('wbs', 4)),
      ],
      new Error('网络瞬断'),
    )
    const transport = makeReplayRecordingTransport(
      replayRecords,
      () =>
        responseOf(
          createMockSseStream([
            sseFrame('module.delta', deltaEvent('tasks', 5)),
            sseFrame('module.completed', moduleCompletedEvent('tasks', 6)),
            sseFrame('draft.progress', progressEvent(7)),
            sseFrame('draft.completed', completedDraftEvent(8)),
          ]),
        ),
      responseOf(firstStream),
    )

    const outcome = await runDraftGenerationStream({
      context: makeContext(),
      transport,
      thresholds: { reconnectBackoffBaseMs: 5, reconnectBackoffMaxMs: 5 },
      onEvent: (event) => received.push(event),
      onReconnect: (attempt, lastSequence, delayMs) =>
        reconnectCalls.push({ attempt, lastSequence, delayMs }),
    })

    // 续传游标 = 中断前已确认的 lastSequence
    expect(replayRecords).toEqual([{ draftId: TEST_DRAFT_ID, lastSequence: 4 }])
    expect(reconnectCalls).toEqual([{ attempt: 1, lastSequence: 4, delayMs: 5 }])
    expect(received.map((event) => event.sequence).filter((s) => s > 0)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
    expect(outcome.status).toBe('completed')
    expect(outcome.lastSequence).toBe(8)
  })

  test('流正常 EOF 但未达终态同样触发断点续传', async () => {
    const replayRecords: ReplayRecord[] = []
    const transport = makeReplayRecordingTransport(
      replayRecords,
      () =>
        responseOf(
          createMockSseStream([
            sseFrame('module.completed', moduleCompletedEvent('tasks', 5)),
            sseFrame('draft.completed', completedDraftEvent(6)),
          ]),
        ),
      responseOf(
        createMockSseStream([
          sseFrame('draft.started', startedEvent(1)),
          sseFrame('module.delta', deltaEvent('charter', 2)),
          sseFrame('module.completed', moduleCompletedEvent('charter', 3)),
          sseFrame('module.delta', deltaEvent('wbs', 4)),
        ]),
      ),
    )

    const outcome = await runDraftGenerationStream({
      context: makeContext(),
      transport,
      thresholds: { reconnectBackoffBaseMs: 5, reconnectBackoffMaxMs: 5 },
      onEvent: () => undefined,
    })

    expect(replayRecords).toEqual([{ draftId: TEST_DRAFT_ID, lastSequence: 4 }])
    expect(outcome.status).toBe('completed')
    expect(outcome.lastSequence).toBe(6)
  })

  test('最多 3 次指数退避（1s/2s/4s）后仍失败 → SSE_RECONNECT_EXHAUSTED', async () => {
    vi.useFakeTimers()
    try {
      const reconnectCalls: ReconnectRecord[] = []
      const transport: TheaterSseTransport = {
        openStream: async () =>
          responseOf(
            createErrorEndingStream(
              [
                sseFrame('draft.started', startedEvent(1)),
                sseFrame('module.delta', deltaEvent('charter', 2)),
              ],
              new Error('连接持续失败'),
            ),
          ),
        openReplay: async () => {
          throw new Error('续传持续失败')
        },
        fetchSnapshot: async () => {
          throw new Error('不应触发快照')
        },
      }
      const run = runDraftGenerationStream({
        context: makeContext(),
        transport,
        // 拉长停滞阈值，避免看门狗干扰退避断言
        thresholds: { staleMs: 60_000, hardDeadlineMs: 600_000 },
        onEvent: () => undefined,
        onReconnect: (attempt, lastSequence, delayMs) =>
          reconnectCalls.push({ attempt, lastSequence, delayMs }),
      })

      await vi.advanceTimersByTimeAsync(10_000)
      const outcome = await run

      expect(reconnectCalls.map((record) => record.attempt)).toEqual([1, 2, 3])
      expect(reconnectCalls.map((record) => record.delayMs)).toEqual([1_000, 2_000, 4_000])
      expect(reconnectCalls.every((record) => record.lastSequence === 2)).toBe(true)
      expect(outcome.status).toBe('failed')
      expect(outcome.errorCode).toBe('SSE_RECONNECT_EXHAUSTED')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('游标失效降级（STREAM_RETENTION_MISS Fallback）', () => {
  function retentionMissStreamResponse(): Response {
    return responseOf(
      createMockSseStream([
        sseFrame('draft.started', startedEvent(1)),
        sseFrame('module.delta', deltaEvent('charter', 2)),
        sseFrame('draft.failed', failedEvent(3, 'STREAM_RETENTION_MISS')),
      ]),
    )
  }

  test('收到 STREAM_RETENTION_MISS 不判死，快照已落定时直接 completed', async () => {
    const received: ProjectDraftStreamEvent[] = []
    const snapshots: unknown[] = []
    const detail = makeSnapshotDetail({
      draft: makeMockDraft(),
      meta: makeMockMeta(),
      validation: makeMockValidation(),
      events: [startedEvent(1), deltaEvent('charter', 2)],
    })
    const transport: TheaterSseTransport = {
      openStream: async () => retentionMissStreamResponse(),
      openReplay: async () => {
        throw new Error('快照已落定，不应再发起续传')
      },
      fetchSnapshot: async () => detail,
    }

    const outcome = await runDraftGenerationStream({
      context: makeContext(),
      transport,
      onEvent: (event) => received.push(event),
      onSnapshotResolved: (snapshot) => snapshots.push(snapshot),
    })

    // 重置信号事件不转发、不判死
    expect(received.map((event) => event.type)).toEqual(['draft.started', 'module.delta'])
    expect(snapshots).toEqual([detail])
    expect(outcome.status).toBe('completed')
    expect(outcome.recoveredFromSnapshot).toBe(true)
    expect(outcome.lastSequence).toBe(2)
  })

  test('快照仍在进行时回放事件重建进度并继续 tail 续传', async () => {
    const received: ProjectDraftStreamEvent[] = []
    const replayRecords: ReplayRecord[] = []
    const detail = makeSnapshotDetail({
      events: [
        startedEvent(1),
        deltaEvent('charter', 2),
        moduleCompletedEvent('charter', 3),
        deltaEvent('wbs', 4),
      ],
    })
    const transport: TheaterSseTransport = {
      openStream: async () => retentionMissStreamResponse(),
      openReplay: async (draftId, lastSequence) => {
        replayRecords.push({ draftId, lastSequence })
        return responseOf(
          createMockSseStream([
            sseFrame('module.delta', deltaEvent('tasks', 5)),
            sseFrame('module.completed', moduleCompletedEvent('tasks', 6)),
            sseFrame('draft.completed', completedDraftEvent(7)),
          ]),
        )
      },
      fetchSnapshot: async () => detail,
    }

    const outcome = await runDraftGenerationStream({
      context: makeContext(),
      transport,
      thresholds: { reconnectBackoffBaseMs: 5, reconnectBackoffMaxMs: 5 },
      onEvent: (event) => received.push(event),
    })

    // 回放时已 ≤ 游标的事件去重，只补 3/4；续传从新游标 4 开始
    expect(received.map((event) => event.sequence).filter((s) => s > 0)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ])
    expect(replayRecords).toEqual([{ draftId: TEST_DRAFT_ID, lastSequence: 4 }])
    expect(outcome.status).toBe('completed')
    expect(outcome.recoveredFromSnapshot).toBe(true)
    expect(outcome.lastSequence).toBe(7)
  })
})

describe('停滞检测与硬性超时', () => {
  test('15 秒未收帧标记 stale 并自动终止半开连接触发续传', async () => {
    vi.useFakeTimers()
    try {
      const healthChanges: string[] = []
      const replayRecords: ReplayRecord[] = []
      const silentStream = createSilentAfterSseStream([
        sseFrame('draft.started', startedEvent(1)),
        sseFrame('module.delta', deltaEvent('charter', 2)),
      ])
      const transport = makeReplayRecordingTransport(
        replayRecords,
        () =>
          responseOf(
            createMockSseStream([
              sseFrame('draft.progress', progressEvent(3)),
              sseFrame('draft.completed', completedDraftEvent(4)),
            ]),
          ),
        responseOf(silentStream),
      )

      const run = runDraftGenerationStream({
        context: makeContext(),
        transport,
        onEvent: () => undefined,
        onHealthChange: (health) => healthChanges.push(health),
      })

      await vi.advanceTimersByTimeAsync(15_000) // 看门狗到点 → stale → 中止滞流
      await vi.advanceTimersByTimeAsync(1_000) // 第 1 次退避 → 续传
      const outcome = await run

      expect(healthChanges).toContain('stale')
      expect(replayRecords).toEqual([{ draftId: TEST_DRAFT_ID, lastSequence: 2 }])
      expect(outcome.status).toBe('completed')
      expect(outcome.lastSequence).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  test('超过硬性等待上限且无心跳 → STREAM_PROVIDER_TIMEOUT', async () => {
    vi.useFakeTimers()
    try {
      const transport: TheaterSseTransport = {
        openStream: async () =>
          responseOf(
            createSilentAfterSseStream([
              sseFrame('draft.started', startedEvent(1)),
              sseFrame('module.delta', deltaEvent('charter', 2)),
            ]),
          ),
        // 续传后仍是静默流：每轮都会再次停滞
        openReplay: async () =>
          responseOf(createSilentAfterSseStream([sseFrame('draft.progress', progressEvent(3))])),
        fetchSnapshot: async () => {
          throw new Error('不应触发快照')
        },
      }
      const run = runDraftGenerationStream({
        context: makeContext(),
        transport,
        thresholds: {
          staleMs: 1_000,
          hardDeadlineMs: 3_000,
          reconnectBackoffBaseMs: 10,
          reconnectBackoffMaxMs: 10,
        },
        onEvent: () => undefined,
      })

      await vi.advanceTimersByTimeAsync(10_000)
      const outcome = await run

      expect(outcome.status).toBe('failed')
      expect(outcome.errorCode).toBe('STREAM_PROVIDER_TIMEOUT')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('defaultTheaterTransport 请求契约', () => {
  beforeEach(() => {
    vi.mocked(apiRawFetch).mockReset()
    vi.mocked(apiFetch).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('openReplay 携带 Last-Event-ID 头与 ?after= 查询参数', async () => {
    vi.mocked(apiRawFetch).mockResolvedValue({ body: null } as unknown as Response)
    await defaultTheaterTransport.openReplay('draft-test-001', 12)
    expect(apiRawFetch).toHaveBeenCalledWith('/ai/project-drafts/draft-test-001/events?after=12', {
      headers: { 'Last-Event-ID': '12' },
    })
  })

  test('openStream 使用 POST stream 端点并携带上下文请求体', async () => {
    vi.mocked(apiRawFetch).mockResolvedValue({ body: null } as unknown as Response)
    const input = { context: makeContext() }
    await defaultTheaterTransport.openStream(input)
    expect(apiRawFetch).toHaveBeenCalledWith(
      '/ai/project-drafts/stream',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }),
    )
  })

  test('fetchSnapshot 命中详情端点', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeSnapshotDetail({}))
    await defaultTheaterTransport.fetchSnapshot('draft-test-001')
    expect(apiFetch).toHaveBeenCalledWith('/ai/project-drafts/draft-test-001', expect.any(Object))
  })

  test('THEATER_STREAM_DEFAULTS 对齐规格：15s stale、3 次退避、180s 硬上限', () => {
    expect(THEATER_STREAM_DEFAULTS).toMatchObject({
      staleMs: 15_000,
      longRunningMs: 30_000,
      maxReconnectAttempts: 3,
      reconnectBackoffBaseMs: 1_000,
      reconnectBackoffMaxMs: 10_000,
      hardDeadlineMs: 180_000,
    })
  })
})
