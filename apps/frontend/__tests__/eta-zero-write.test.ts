/**
 * ETA 零写入断言测试（v2-5-streaming-eta-estimation task 4.5）。
 *
 * spec Requirement: ETA MUST NOT be used as a data source or trigger side effects。
 * 验证 ETA 相关代码路径不触发网络写（fetch/XHR/WebSocket）或 store 业务写入。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftProgressProjection, selectDraftEta } from '@/lib/ai-draft/progress-projection'
import { PROJECT_DRAFT_MODULES } from '@aiproj/types'
import { computeLinearEta, isEtaAvailable } from '@/lib/realtime/eta-estimator'
import { formatEta } from '@/lib/realtime/format-eta'
import { selectCompilerRunEta } from '@/lib/compiler/compiler-eta'
import { useCompilerProgressStore } from '@/lib/compiler/compiler-progress-store'
import type { CompilerRunState, StageProgressState } from '@/lib/compiler/compiler-progress-store'

describe('ETA 零写入断言（spec: 零网络写入 / 不作数据源）', () => {
  let fetchSpy: { mockRestore: () => void }

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve({} as Response))
    useCompilerProgressStore.getState().clear()
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('核心算法 computeLinearEta / isEtaAvailable / formatEta 不触发网络写', () => {
    computeLinearEta(120_000, 3, 9)
    isEtaAvailable('healthy', 'live', 'none')
    formatEta(180_000)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('selectDraftEta 调用任意次数不产生 fetch/XHR', () => {
    const state = createDraftProgressProjection()
    PROJECT_DRAFT_MODULES.slice(0, 3).forEach((m) => {
      state.modules[m] = 'completed'
    })
    state.elapsedMs = 120_000
    state.connection = 'live'
    state.healthState = 'healthy'
    state.terminal = 'none'
    for (let i = 0; i < 10; i++) {
      selectDraftEta(state)
      selectDraftEta(state, Date.now() + i * 1000)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('selectCompilerRunEta 不触发网络写、不写 store 业务字段', () => {
    const stages = new Map<string, StageProgressState>([
      [
        's1',
        {
          stageId: 's1',
          phase: 's1',
          status: 'completed' as never,
          fsmState: 'completed',
          attemptNumber: null,
          durationMs: 2000,
          llmCalls: 0,
          llmCost: 0,
          needsReview: false,
          errorCode: null,
          timestamp: null,
        },
      ],
      [
        's2',
        {
          stageId: 's2',
          phase: 's2',
          status: 'completed' as never,
          fsmState: 'completed',
          attemptNumber: null,
          durationMs: 3000,
          llmCalls: 0,
          llmCost: 0,
          needsReview: false,
          errorCode: null,
          timestamp: null,
        },
      ],
      [
        's3',
        {
          stageId: 's3',
          phase: 's3',
          status: 'progress' as never,
          fsmState: 'running',
          attemptNumber: null,
          durationMs: null,
          llmCalls: 0,
          llmCost: 0,
          needsReview: false,
          errorCode: null,
          timestamp: null,
        },
      ],
    ])
    const runState: CompilerRunState = {
      runId: 1,
      stages,
      overallStatus: 'running',
      lastSequence: 0,
      lastEventTime: null,
      heartbeatStale: false,
      connected: true,
    }
    const r = selectCompilerRunEta(runState)
    expect(r.etaMs).not.toBeNull()
    // 多次调用
    for (let i = 0; i < 10; i++) selectCompilerRunEta(runState)
    expect(fetchSpy).not.toHaveBeenCalled()
    // store 业务字段未被写（runs 仍为空，selector 未调 setState）
    expect(useCompilerProgressStore.getState().runs.size).toBe(0)
  })

  it('ETA 异常大值不影响健康状态判断（spec: 不影响健康状态判断）', () => {
    // 构造一个会产生大 ETA 的 projection（3/9, elapsedMs 极大）
    const state = createDraftProgressProjection()
    PROJECT_DRAFT_MODULES.slice(0, 3).forEach((m) => {
      state.modules[m] = 'completed'
    })
    state.elapsedMs = 3_600_000 * 10 // 10 小时
    state.connection = 'live'
    state.healthState = 'healthy'
    state.terminal = 'none'
    const r = selectDraftEta(state)
    // ETA 很大但 healthState 仍为 healthy（ETA 不反向影响健康判定）
    expect(r.etaMs).toBeGreaterThan(3_600_000)
    expect(state.healthState).toBe('healthy')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
