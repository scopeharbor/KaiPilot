/**
 * 浏览器里模型实时输出片段合并（2026-09-28）：几千个片段不再逐个 set 重渲染整页。
 * 测试环境默认逐个同步归约，这里把 NODE_ENV 换成 production 后重新加载 store 验证合并路径。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('模型实时输出片段合并', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    window.sessionStorage.clear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  test('1000 个片段合并成一次更新；终态事件先落下攒着的片段再收尾', async () => {
    const { useAiProjectDraftStore } = await import('@/stores/ai-project-draft-store')
    vi.useFakeTimers()
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    const listener = vi.fn()
    const unsubscribe = useAiProjectDraftStore.subscribe(listener)
    for (let index = 0; index < 1000; index++) {
      store.applyDraftEvent({
        type: 'generation.output',
        draftId: 'draft-001',
        version: 1,
        sequence: 0,
        text: '字',
        callId: '1',
        label: '拆解',
      })
    }
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(useAiProjectDraftStore.getState().streamOutput).toHaveLength(1000)

    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '尾',
      callId: '1',
    })
    store.applyDraftEvent({
      type: 'draft.failed',
      draftId: 'draft-001',
      version: 1,
      sequence: 2,
      errorCode: 'AI_SERVICE_ERROR',
      message: '生成失败',
      consistency: 'failed',
    })
    const state = useAiProjectDraftStore.getState()
    expect(state.streamOutput.endsWith('尾')).toBe(true)
    expect(state.streamOutputActive).toBe(false)
    expect(state.streamLanes.every((lane) => lane.done)).toBe(true)
    unsubscribe()
  }, 30_000)

  test('清空输出时丢弃还没落下的片段', async () => {
    const { useAiProjectDraftStore } = await import('@/stores/ai-project-draft-store')
    vi.useFakeTimers()
    const store = useAiProjectDraftStore.getState()
    store.startDraftGeneration('draft-001')
    store.applyDraftEvent({
      type: 'generation.output',
      draftId: 'draft-001',
      version: 1,
      sequence: 0,
      text: '旧的',
    })
    store.clearStreamOutput()
    vi.advanceTimersByTime(100)
    expect(useAiProjectDraftStore.getState().streamOutput).toBe('')
  }, 30_000)
})
