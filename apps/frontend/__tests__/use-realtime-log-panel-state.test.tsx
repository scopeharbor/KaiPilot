/**
 * useRealtimeLogPanelState hook 测试（v2-5-streaming-realtime-log-panel，task 4.1/4.3）。
 *
 * 覆盖：
 * - 4.1 复用 useStreamRecovery/useStreamConnectionStatus 呈现恢复/连接态
 * - 4.2/4.3 零写入：ingestLog/ingestEnvelope/reset 全生命周期零 network 写、零业务 store 写、零 run 触发
 * - log-buffer 经 reduceLogEvent 委托累积
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRealtimeLogPanelState } from '@/hooks/use-realtime-log-panel-state'
import type { StreamingProgressEnvelope, RealtimeLogEvent } from '@aiproj/types'

function makeEnvelope(overrides: Partial<StreamingProgressEnvelope>): StreamingProgressEnvelope {
  return {
    domain: overrides.domain ?? 'ai-draft',
    streamId: overrides.streamId ?? 's1',
    sequence: overrides.sequence ?? 1,
    type: overrides.type ?? 'progress',
    payload: overrides.payload ?? {},
    contractVersion: overrides.contractVersion ?? 'v1',
    occurredAt: overrides.occurredAt ?? '2026-07-21T00:00:00.000Z',
  } as unknown as StreamingProgressEnvelope
}

function makeLog(overrides: Partial<RealtimeLogEvent>): RealtimeLogEvent {
  return {
    streamId: overrides.streamId ?? 's1',
    stageId: overrides.stageId ?? 'stage-a',
    phase: overrides.phase ?? 'running',
    attempt: overrides.attempt ?? 1,
    severity: overrides.severity ?? 'info',
    messageCode: overrides.messageCode ?? 'stage.started',
    count: overrides.count,
    durationMs: overrides.durationMs,
    safeRefs: overrides.safeRefs,
    hash: overrides.hash,
    timestamp: overrides.timestamp ?? '2026-07-21T00:00:00.000Z',
  }
}

describe('useRealtimeLogPanelState —— log-buffer 委托累积 (4.1)', () => {
  it('ingestLog 经 reduceLogEvent 委托 log-buffer 累积', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    act(() => {
      result.current.ingestLog(makeLog({ stageId: 'a', timestamp: 't1' }))
      result.current.ingestLog(makeLog({ stageId: 'b', timestamp: 't2' }))
    })
    expect(result.current.logBuffer.entries).toHaveLength(2)
    expect(result.current.logBuffer.entries.map((e) => e.stageId)).toEqual(['a', 'b'])
  })

  it('ingestLog 幂等去重', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    const log = makeLog({ stageId: 'a', timestamp: 't1' })
    act(() => {
      result.current.ingestLog(log)
      result.current.ingestLog(log)
    })
    expect(result.current.logBuffer.entries).toHaveLength(1)
  })

  it('ingestEnvelope 序列缺口冻结缓冲', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    act(() => {
      result.current.ingestEnvelope(makeEnvelope({ sequence: 1 }))
      result.current.ingestLog(makeLog({ stageId: 'a', timestamp: 't1' }))
      result.current.ingestEnvelope(makeEnvelope({ sequence: 5 })) // gap
    })
    expect(result.current.needsReset).toBe(true)
    expect(result.current.logBuffer.frozen).toBe(true)
    // 冻结后 ingestLog 被忽略
    act(() => {
      result.current.ingestLog(makeLog({ stageId: 'b', timestamp: 't2' }))
    })
    expect(result.current.logBuffer.entries).toHaveLength(1)
  })

  it('reset 重建缓冲', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    act(() => {
      result.current.ingestLog(makeLog({ stageId: 'a', timestamp: 't1' }))
      result.current.reset()
    })
    expect(result.current.logBuffer.entries).toHaveLength(0)
    expect(result.current.logBuffer.frozen).toBe(false)
  })
})

describe('useRealtimeLogPanelState —— 零写入 (4.2 / 4.3)', () => {
  it('ingestLog/ingestEnvelope/reset 全生命周期零 network 写', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    act(() => {
      result.current.ingestEnvelope(makeEnvelope({ sequence: 1 }))
      result.current.ingestLog(makeLog({ stageId: 'a', timestamp: 't1' }))
      result.current.ingestLog(
        makeLog({ stageId: 'b', timestamp: 't2', severity: 'error', messageCode: 'stage.failed' }),
      )
      result.current.reset('RESUME')
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('不触发任何 mutation/apply/sync 类 store 写（无业务副作用）', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    // hook 只产出可读 state 与 dispatch 纯函数，无业务 store 依赖
    act(() => {
      result.current.ingestLog(makeLog({ stageId: 'a', timestamp: 't1' }))
    })
    // logBuffer 仅为投影数据，非业务状态
    expect(result.current.logBuffer.entries).toHaveLength(1)
    // 无任何 run 触发入口
    expect(typeof result.current.ingestLog).toBe('function')
    expect(typeof result.current.ingestEnvelope).toBe('function')
    expect(typeof result.current.reset).toBe('function')
    // 不存在 trigger/apply/sync/cancel 等 mutation 接口
    const api = Object.keys(result.current)
    expect(api.some((k) => /trigger|apply|sync|cancel|create|update|delete|run/i.test(k))).toBe(
      false,
    )
  })
})

describe('useRealtimeLogPanelState —— 恢复/连接态消费 (4.1)', () => {
  it('needsReset 回退到投影 needsReset（recovery 为静态 stub）', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    expect(result.current.needsReset).toBe(false)
    act(() => {
      result.current.ingestEnvelope(makeEnvelope({ sequence: 1 }))
      result.current.ingestEnvelope(makeEnvelope({ sequence: 5 })) // gap
    })
    expect(result.current.needsReset).toBe(true)
  })

  it('disconnected 来自 useStreamConnectionStatus（默认 idle → 非 disconnected）', () => {
    const { result } = renderHook(() => useRealtimeLogPanelState('s1', 'ai-draft'))
    // 默认连接状态 idle，非断开
    expect(result.current.disconnected).toBe(false)
  })
})
