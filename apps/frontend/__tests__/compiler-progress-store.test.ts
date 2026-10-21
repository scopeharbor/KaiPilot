/**
 * Compiler Progress Store 单元测试：envelope 投影、序号幂等、阶段 FSM 与汇总状态、
 * 连接 / 心跳标记与重置。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { StreamingProgressEnvelope } from '@aiproj/types/progress-streaming'
import { useCompilerProgressStore } from '@/lib/compiler/compiler-progress-store'

let seq = 0

function envelope(overrides: object = {}): StreamingProgressEnvelope {
  seq += 1
  return {
    contractVersion: '1.0',
    eventId: `evt-${seq}`,
    streamId: 'compiler:7',
    domain: 'compiler',
    sequence: seq,
    occurredAt: `2026-10-20T00:00:${String(seq).padStart(2, '0')}.000Z`,
    type: 'progress',
    payload: {},
    ...overrides,
  } as unknown as StreamingProgressEnvelope
}

const store = () => useCompilerProgressStore.getState()

describe('useCompilerProgressStore', () => {
  beforeEach(() => {
    seq = 0
    store().clear()
  })

  it('非 compiler 领域或拿不到 runId 的事件被忽略', () => {
    store().applyEnvelope(envelope({ domain: 'ai-draft' } as Partial<StreamingProgressEnvelope>))
    store().applyEnvelope(envelope({ streamId: 'not-a-compiler-stream' }))
    expect(store().runs.size).toBe(0)
  })

  it('从 payload 投影阶段字段，started → progress 进入 running', () => {
    store().applyEnvelope(
      envelope({
        type: 'started',
        payload: { runId: 7, stageId: 'plan', phase: 'planning', attemptNumber: 1 },
      }),
    )
    store().applyEnvelope(
      envelope({
        type: 'progress',
        payload: {
          runId: 7,
          stageId: 'plan',
          phase: 'planning',
          durationMs: 120,
          llmCalls: 2,
          llmCost: 0.5,
          needsReview: true,
        },
      }),
    )

    const run = store().getRunState(7)
    expect(run?.overallStatus).toBe('running')
    expect(run?.lastSequence).toBe(2)
    expect(run?.connected).toBe(true)
    expect(run?.lastEventTime).toBe('2026-10-20T00:00:02.000Z')
    const stage = run?.stages.get('plan')
    expect(stage).toMatchObject({
      phase: 'planning',
      status: 'progress',
      fsmState: 'running',
      durationMs: 120,
      llmCalls: 2,
      llmCost: 0.5,
      needsReview: true,
      errorCode: null,
    })
  })

  it('runId 与阶段可从 streamId 和 _domainPayload 推出', () => {
    store().applyEnvelope(
      envelope({
        streamId: 'compiler:42',
        type: 'started',
        _domainPayload: {
          domain: 'compiler',
          runId: '42',
          progress: { stageId: 'layout', attempt: 3, errorCode: 'E_STAGE' },
        },
      } as Partial<StreamingProgressEnvelope>),
    )
    const stage = store().getRunState(42)?.stages.get('layout')
    expect(stage?.attemptNumber).toBe(3)
    expect(stage?.errorCode).toBe('E_STAGE')
    expect(stage?.phase).toBe('layout')
    expect(stage?.fsmState).toBe('started')

    // 没有 payload 也没有扩展时阶段记为 unknown
    store().applyEnvelope(envelope({ streamId: 'compiler:43', type: 'started' }))
    expect(store().getRunState(43)?.stages.has('unknown')).toBe(true)
  })

  it('序号不递增的旧事件不覆盖新状态；非法转换保持原 FSM', () => {
    store().applyEnvelope(envelope({ type: 'started', payload: { runId: 7, stageId: 'a' } }))
    const stale = envelope({ type: 'failed', payload: { runId: 7, stageId: 'a' }, sequence: 1 })
    store().applyEnvelope(stale)
    expect(store().getRunState(7)?.stages.get('a')?.fsmState).toBe('started')

    // initial 阶段直接收到 progress 属非法转换，FSM 停在 initial
    store().applyEnvelope(envelope({ type: 'progress', payload: { runId: 7, stageId: 'b' } }))
    expect(store().getRunState(7)?.stages.get('b')?.fsmState).toBe('initial')
  })

  it('汇总状态：全部完成为 completed，有失败为 failed，有取消为 cancelled', () => {
    for (const stageId of ['a', 'b']) {
      store().applyEnvelope(envelope({ type: 'started', payload: { runId: 1, stageId } }))
      store().applyEnvelope(envelope({ type: 'completed', payload: { runId: 1, stageId } }))
    }
    expect(store().getRunState(1)?.overallStatus).toBe('completed')

    store().applyEnvelope(envelope({ type: 'started', payload: { runId: 2, stageId: 'a' } }))
    store().applyEnvelope(envelope({ type: 'cancelled', payload: { runId: 2, stageId: 'a' } }))
    expect(store().getRunState(2)?.overallStatus).toBe('cancelled')

    store().applyEnvelope(envelope({ type: 'started', payload: { runId: 3, stageId: 'a' } }))
    store().applyEnvelope(
      envelope({ type: 'failed', payload: { runId: 3, stageId: 'a', errorCode: 'E_FAIL' } }),
    )
    expect(store().getRunState(3)?.overallStatus).toBe('failed')
    expect(store().getRunState(3)?.stages.get('a')?.errorCode).toBe('E_FAIL')

    // 终态后再来的事件不改变 FSM
    store().applyEnvelope(envelope({ type: 'progress', payload: { runId: 3, stageId: 'a' } }))
    expect(store().getRunState(3)?.stages.get('a')?.fsmState).toBe('failed')
  })

  it('断线、心跳超时、重置与清空', () => {
    store().setDisconnected(9)
    store().markHeartbeatStale(9)
    expect(store().runs.size).toBe(0)

    store().applyEnvelope(envelope({ type: 'started', payload: { runId: 9, stageId: 'a' } }))
    store().setDisconnected(9)
    store().markHeartbeatStale(9)
    expect(store().getRunState(9)).toMatchObject({ connected: false, heartbeatStale: true })

    store().resetRun(9)
    expect(store().getRunState(9)).toBeUndefined()

    store().applyEnvelope(envelope({ type: 'started', payload: { runId: 10, stageId: 'a' } }))
    store().clear()
    expect(store().runs.size).toBe(0)
  })
})
