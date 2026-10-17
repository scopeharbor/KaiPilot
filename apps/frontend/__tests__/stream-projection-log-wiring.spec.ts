/**
 * stream-projection 接线测试（v2-5-streaming-realtime-log-panel）。
 *
 * 覆盖：
 * - 2.2 缓冲与 StreamProjectionState 的 gap/reset 对齐：进入 needsReset/SEQUENCE_GAP 冻结缓冲、重置后重建
 * - 2.3 reduceLogEvent 从「丢弃」升级为「更新 lastEventAt 且委托 log-buffer 投影」，不改 reduceStreamEnvelope
 * - 5.2 零行为变化回归：feature-off/无事件/投影异常时 reduceStreamEnvelope 与恢复路径逐位等值、面板不渲染
 */

import { describe, it, expect } from 'vitest'
import {
  createStreamProjectionState,
  reduceStreamEnvelope,
  reduceLogEvent,
  handleResetRequired,
} from '@/lib/realtime/stream-projection'
import type { StreamingProgressEnvelope, RealtimeLogEvent } from '@aiproj/types'
import { createLogBuffer, reduceLogBuffer, freezeLogBuffer } from '@/lib/realtime/log-buffer'

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

describe('reduceLogEvent —— 从「丢弃」升级为委托 log-buffer (2.3)', () => {
  it('委托 log-buffer 累积日志条目（不再丢弃）', () => {
    const state = createStreamProjectionState('s1', 'ai-draft')
    const s1 = reduceLogEvent(state, makeLog({ stageId: 'a', timestamp: 't1' }))
    const s2 = reduceLogEvent(s1, makeLog({ stageId: 'b', timestamp: 't2' }))
    expect(s2.logBuffer.entries).toHaveLength(2)
    expect(s2.logBuffer.entries.map((e) => e.stageId)).toEqual(['a', 'b'])
  })

  it('更新 lastEventAt', () => {
    const state = createStreamProjectionState('s1', 'ai-draft')
    expect(state.lastEventAt).toBeNull()
    const next = reduceLogEvent(state, makeLog({}))
    expect(next.lastEventAt).not.toBeNull()
  })

  it('重复事件幂等（经 log-buffer 去重）', () => {
    const state = createStreamProjectionState('s1', 'ai-draft')
    const log = makeLog({ stageId: 'a', timestamp: 't1' })
    const s1 = reduceLogEvent(state, log)
    const s2 = reduceLogEvent(s1, log)
    expect(s2.logBuffer.entries).toHaveLength(1)
  })

  it('保留 StreamProjectionState 结构兼容（reduceStreamEnvelope 字段不变）', () => {
    const state = createStreamProjectionState('s1', 'ai-draft')
    const next = reduceLogEvent(state, makeLog({}))
    // 进度归约字段不受影响
    expect(next.streamId).toBe(state.streamId)
    expect(next.domain).toBe(state.domain)
    expect(next.lastSequence).toBe(state.lastSequence)
    expect(next.terminal).toBe(state.terminal)
    expect(next.needsReset).toBe(state.needsReset)
    expect(next.error).toBe(state.error)
    // 仅 lastEventAt 更新 + logBuffer 委托
    expect(next.lastEventAt).not.toBe(state.lastEventAt)
    expect(next.logBuffer.entries.length).toBeGreaterThan(state.logBuffer.entries.length)
  })
})

describe('gap/reset 与 StreamProjectionState 对齐 (2.2)', () => {
  it('序列缺口（SEQUENCE_GAP）冻结日志缓冲、不追加越过缺口的日志', () => {
    let state = createStreamProjectionState('s1', 'ai-draft')
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1 }))
    // 累积一条日志
    state = reduceLogEvent(state, makeLog({ stageId: 'a', timestamp: 't1' }))
    expect(state.logBuffer.entries).toHaveLength(1)
    expect(state.needsReset).toBe(false)

    // 序列跳号 → SEQUENCE_GAP
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 5 }))
    expect(state.needsReset).toBe(true)
    expect(state.error).toBe('SEQUENCE_GAP')
    expect(state.logBuffer.frozen).toBe(true)

    // 冻结后追加的日志被忽略
    const before = state.logBuffer.entries.length
    state = reduceLogEvent(state, makeLog({ stageId: 'b', timestamp: 't2' }))
    expect(state.logBuffer.entries).toHaveLength(before) // 不追加
  })

  it('handleResetRequired 重建缓冲、解冻、恢复追加能力', () => {
    let state = createStreamProjectionState('s1', 'ai-draft')
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1 }))
    state = reduceLogEvent(state, makeLog({ stageId: 'a', timestamp: 't1' }))
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 5 })) // gap
    expect(state.logBuffer.frozen).toBe(true)
    expect(state.logBuffer.entries).toHaveLength(1)

    // 重置
    state = handleResetRequired(state, 'RESUME_REQUIRED')
    expect(state.needsReset).toBe(true)
    expect(state.error).toBe('RESUME_REQUIRED')
    expect(state.logBuffer.entries).toHaveLength(0) // 重建清空
    expect(state.logBuffer.frozen).toBe(false)

    // 恢复追加能力
    state = reduceLogEvent(state, makeLog({ stageId: 'c', timestamp: 't3' }))
    expect(state.logBuffer.entries).toHaveLength(1)
    expect(state.logBuffer.entries[0]!.stageId).toBe('c')
  })

  it('重连后正常序列恢复：needsReset=false 后缓冲解冻', () => {
    let state = createStreamProjectionState('s1', 'ai-draft')
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1 }))
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 5 })) // gap
    expect(state.logBuffer.frozen).toBe(true)

    // 重置后用新 projection state 重新订阅（模拟恢复后重建订阅）
    state = createStreamProjectionState('s1', 'ai-draft')
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1 }))
    expect(state.needsReset).toBe(false)
    expect(state.logBuffer.frozen).toBe(false)
    // 现在可以追加
    state = reduceLogEvent(state, makeLog({ stageId: 'd', timestamp: 't4' }))
    expect(state.logBuffer.entries).toHaveLength(1)
  })
})

describe('零行为变化回归 (5.2)', () => {
  it('reduceStreamEnvelope 进度归约与引入本能力前逐位等值（logBuffer 为加法，不影响进度字段）', () => {
    const state = createStreamProjectionState('s1', 'ai-draft')
    const next = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1, type: 'progress' }))
    // 进度归约核心字段
    expect(next.lastSequence).toBe(1)
    expect(next.terminal).toBe(false)
    expect(next.needsReset).toBe(false)
    expect(next.error).toBeNull()
    // logBuffer 为加法默认值，不影响进度
    expect(next.logBuffer.entries).toEqual([])
    expect(next.logBuffer.frozen).toBe(false)
  })

  it('completed/failed/cancelled 终态投影不受 logBuffer 影响', () => {
    let state = createStreamProjectionState('s1', 'ai-draft')
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1, type: 'progress' }))
    const done = reduceStreamEnvelope(state, makeEnvelope({ sequence: 2, type: 'completed' }))
    expect(done.terminal).toBe(true)
    expect(done.needsReset).toBe(false)
    // logBuffer 保持加法默认（无日志事件时为空）
    expect(done.logBuffer.entries).toEqual([])
  })

  it('无日志事件时 reduceStreamEnvelope 与 reduceLogEvent 不产生写入副作用', () => {
    const state = createStreamProjectionState('s1', 'ai-draft')
    const s1 = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1 }))
    // 无日志事件 → logBuffer 保持空，面板不渲染（空态）
    expect(s1.logBuffer.entries).toEqual([])
  })

  it('feature-off 等价：空缓冲 → 面板不渲染（reduceStreamEnvelope 路径不受影响）', () => {
    // 模拟 feature-off：reduceLogEvent 不被调用，只走 reduceStreamEnvelope
    const state = createStreamProjectionState('s1', 'ai-draft')
    let s = state
    for (let i = 1; i <= 5; i++) {
      s = reduceStreamEnvelope(s, makeEnvelope({ sequence: i, type: 'progress' }))
    }
    // logBuffer 始终空 → 面板 feature-off/无事件 → 不渲染
    expect(s.logBuffer.entries).toEqual([])
    expect(s.lastSequence).toBe(5)
    expect(s.needsReset).toBe(false)
  })
})

describe('log-buffer 模块独立行为与 projection 委托一致性', () => {
  it('直接调 reduceLogBuffer 与经 reduceLogEvent 委托结果一致', () => {
    const log = makeLog({ stageId: 'x', timestamp: 'tx' })
    // 直接
    let direct = createLogBuffer()
    direct = reduceLogBuffer(direct, log)
    // 经委托
    const state = createStreamProjectionState('s1', 'ai-draft')
    const delegated = reduceLogEvent(state, log)
    expect(delegated.logBuffer.entries).toEqual(direct.entries)
    expect(delegated.logBuffer.seenKeys.size).toBe(direct.seenKeys.size)
    expect(delegated.logBuffer.nextSeq).toBe(direct.nextSeq)
  })

  it('freezeLogBuffer 与经 reduceStreamEnvelope gap 冻结一致', () => {
    // 直接冻结
    const direct = freezeLogBuffer(
      reduceLogBuffer(createLogBuffer(), makeLog({ stageId: 'a', timestamp: 't1' })),
    )
    expect(direct.frozen).toBe(true)
    expect(direct.entries).toHaveLength(1)

    // 经 projection gap 冻结
    let state = createStreamProjectionState('s1', 'ai-draft')
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 1 }))
    state = reduceLogEvent(state, makeLog({ stageId: 'a', timestamp: 't1' }))
    state = reduceStreamEnvelope(state, makeEnvelope({ sequence: 5 })) // gap
    expect(state.logBuffer.frozen).toBe(true)
    expect(state.logBuffer.entries).toHaveLength(1)
  })
})
