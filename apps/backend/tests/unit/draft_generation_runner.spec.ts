import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDraftStreamEvent } from '@aiproj/types'
import { DraftGenerationRunner } from '#services/ai_draft/draft_generation_runner'

function progress(sequence: number): ProjectDraftStreamEvent {
  return {
    type: 'draft.progress',
    draftId: 'draft-1',
    version: 1,
    sequence,
    phase: 'receiving',
    receivedChars: 10,
  }
}

describe('DraftGenerationRunner', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('heartbeat 只在静默期产生，且使用独立 sequence 不推进语义 sequence', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({
      heartbeatIntervalMs: 1_000,
      runnerTtlMs: 10_000,
      completedRetentionMs: 1_000,
    })
    expect(runner.register('draft-1', {} as never, 1, 7)).toBe(true)

    vi.advanceTimersByTime(1_000)
    const heartbeat = runner.readBatch('draft-1', 0)
    // §5.3: 心跳使用独立 sequence 计数器，从 1 开始递增
    expect(heartbeat.events).toMatchObject([{ type: 'draft.heartbeat', sequence: 1, version: 1 }])

    runner.pushEvent('draft-1', progress(8))
    vi.advanceTimersByTime(999)
    const afterActivity = runner.readBatch('draft-1', heartbeat.nextOffset)
    expect(afterActivity.events).toEqual([progress(8)])
    runner.cleanupRunner('draft-1')
  })

  it('25 秒没有业务 delta 时仍每 5 秒产生可解析活性事件，结束后释放 timer', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({
      heartbeatIntervalMs: 5_000,
      runnerTtlMs: 60_000,
      completedRetentionMs: 1_000,
    })
    runner.register('draft-1', {} as never, 1, 7)
    const timersBefore = vi.getTimerCount()

    vi.advanceTimersByTime(25_000)
    const batch = runner.readBatch('draft-1', 0)
    expect(batch.events).toHaveLength(5)
    expect(batch.events.every((event) => event.type === 'draft.heartbeat')).toBe(true)
    expect(batch.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5])

    runner.cleanupRunner('draft-1')
    expect(vi.getTimerCount()).toBeLessThan(timersBefore)
  })

  it('实时读取使用队列 offset，因此 heartbeat 不会被 sequence cursor 过滤', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({ heartbeatIntervalMs: 100 })
    runner.register('draft-1', {} as never, 1, 3)
    runner.pushEvent('draft-1', progress(4))
    const first = runner.readBatch('draft-1', 0)
    vi.advanceTimersByTime(100)
    const second = runner.readBatch('draft-1', first.nextOffset)

    expect(first.events.map((event) => event.sequence)).toEqual([4])
    // §5.3: 心跳使用独立序列号 1（heartbeatSequence++），不是 lastSequence
    expect(second.events).toMatchObject([{ type: 'draft.heartbeat', sequence: 1 }])
    runner.cleanupRunner('draft-1')
  })

  it('完成后保留尾事件一小段时间，再按 retention 清理', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({
      heartbeatIntervalMs: 1_000,
      completedRetentionMs: 500,
    })
    runner.register('draft-1', {} as never, 1)
    runner.pushEvent('draft-1', progress(1))
    runner.complete('draft-1')

    expect(runner.isRunning('draft-1')).toBe(false)
    expect(runner.readBatch('draft-1', 0).events).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(runner.hasRunner('draft-1')).toBe(false)
  })

  it('没有连接或 waiter 时仍接收完整事件并完成，消费视图不控制生成寿命', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({ completedRetentionMs: 1_000 })
    runner.register('draft-1', {} as never, 1, 1)

    runner.pushEvent('draft-1', progress(2))
    runner.pushEvent('draft-1', {
      type: 'draft.failed',
      draftId: 'draft-1',
      version: 1,
      sequence: 3,
      errorCode: 'TEST_TERMINAL',
      message: 'fixture',
      consistency: 'failed',
    })
    runner.fail('draft-1')

    expect(runner.readBatch('draft-1', 0).events.map((item) => item.sequence)).toEqual([2, 3])
    expect(runner.isRunning('draft-1')).toBe(false)
    runner.cleanupRunner('draft-1')
  })

  it('generation.output（sequence=0）实时队列可见，但不参与语义序列恢复', () => {
    const runner = new DraftGenerationRunner({ completedRetentionMs: 1_000 })
    runner.register('draft-1', {} as never, 1, 1)
    runner.pushEvent('draft-1', progress(2))
    runner.pushEvent('draft-1', {
      type: 'generation.output',
      draftId: 'draft-1',
      version: 1,
      sequence: 0,
      text: '模型正在输出真实内容片段。',
    })

    // 实时队列（offset 读取）：语义事件与输出事件按序可见
    const batch = runner.readBatch('draft-1', 0)
    expect(batch.events.map((event) => event.type)).toEqual(['draft.progress', 'generation.output'])
    expect(batch.events[1]).toMatchObject({
      type: 'generation.output',
      sequence: 0,
      text: '模型正在输出真实内容片段。',
    })

    // 语义恢复（sequence cursor）：输出事件 sequence=0 被过滤，不推进恢复序列
    const semantic = runner.readEvents('draft-1', 1)
    expect(semantic.map((event) => event.type)).toEqual(['draft.progress'])
    runner.cleanupRunner('draft-1')
  })

  it('并发上限只计算仍在运行的 runner，拒绝重复注册', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({ maxRunners: 1, completedRetentionMs: 1_000 })
    expect(runner.register('draft-1', {} as never, 1)).toBe(true)
    expect(runner.register('draft-1', {} as never, 1)).toBe(false)
    expect(runner.register('draft-2', {} as never, 1)).toBe(false)

    runner.complete('draft-1')
    expect(runner.register('draft-2', {} as never, 1)).toBe(true)
    runner.cleanupRunner('draft-1')
    runner.cleanupRunner('draft-2')
  })

  it('TTL 到期会移除 runner 与定时器，避免长期泄漏', () => {
    vi.useFakeTimers()
    const runner = new DraftGenerationRunner({
      heartbeatIntervalMs: 100,
      runnerTtlMs: 300,
    })
    runner.register('draft-1', {} as never, 1)
    vi.advanceTimersByTime(300)
    expect(runner.hasRunner('draft-1')).toBe(false)
    expect(runner.activeCount).toBe(0)
  })
})
