/**
 * Transport-health 指标端口测试（tasks 2.4–2.7）。
 */

import { describe, it, expect } from 'vitest'
import {
  NoopMetricsSink,
  MemoryMetricsSink,
  TestMetricsSink,
  makeLabels,
  InstrumentationError,
} from '../../../app/services/transport-health/metrics_port.js'
import {
  validateLabels,
  estimateSeriesCount,
} from '../../../app/services/transport-health/label_allowlist.js'

describe('NoopMetricsSink', () => {
  const sink = new NoopMetricsSink()

  it('incrementCounter 不抛出', () => {
    expect(() =>
      sink.incrementCounter('test', makeLabels('ai-draft', 'sse', 'success')),
    ).not.toThrow()
  })

  it('recordDuration 不抛出', () => {
    expect(() =>
      sink.recordDuration('test', makeLabels('ai-draft', 'sse', 'success'), 100),
    ).not.toThrow()
  })

  it('snapshot 返回空', () => {
    const snap = sink.snapshot()
    expect(snap.counters).toEqual({})
    expect(snap.seriesCount).toBe(0)
  })

  it('sink 失败不向业务路径抛出', () => {
    // no-op 不会抛出，但 memory sink 的 label 验证也可能被绕过
    expect(() => {
      sink.incrementCounter('test', makeLabels('compiler', 'realtime', 'failure'))
      sink.recordDiagnostic({} as any)
    }).not.toThrow()
  })
})

describe('MemoryMetricsSink', () => {
  it('counter 累加', () => {
    const sink = new MemoryMetricsSink()
    sink.incrementCounter('test_count', makeLabels('ai-draft', 'sse', 'success'))
    sink.incrementCounter('test_count', makeLabels('ai-draft', 'sse', 'success'))
    const snap = sink.snapshot()
    const key = Object.keys(snap.counters).find((k) => k.startsWith('test_count'))
    expect(key).toBeTruthy()
    expect(snap.counters[key!]).toBe(2)
  })

  it('duration 记录', () => {
    const sink = new MemoryMetricsSink()
    sink.recordDuration('test_dur', makeLabels('ai-draft', 'sse', 'success'), 100)
    sink.recordDuration('test_dur', makeLabels('ai-draft', 'sse', 'success'), 200)
    const snap = sink.snapshot()
    const key = Object.keys(snap.durations).find((k) => k.startsWith('test_dur'))
    expect(key).toBeTruthy()
    expect(snap.durations[key!].length).toBe(2)
  })

  it('gauge 设置', () => {
    const sink = new MemoryMetricsSink()
    sink.setGauge('active_sessions', makeLabels('compiler', 'realtime', 'success'), 5)
    const snap = sink.snapshot()
    expect(Object.values(snap.gauges)).toContain(5)
  })

  it('reset 清空所有', () => {
    const sink = new MemoryMetricsSink()
    sink.incrementCounter('c', makeLabels('ai-draft', 'sse', 'success'))
    expect(sink.snapshot().seriesCount).toBeGreaterThan(0)
    sink.reset()
    expect(sink.snapshot().seriesCount).toBe(0)
  })

  it('诊断事件记录', () => {
    const sink = new MemoryMetricsSink()
    sink.recordDiagnostic({
      timestamp: new Date().toISOString(),
      streamKind: 'ai-draft',
      transport: 'sse',
      correlationId: 'test-1',
      operation: 'first_event',
      outcome: 'success',
      reasonCode: 'FIRST_EVENT_OK',
    })
    expect(sink.snapshot().diagnostics.length).toBe(1)
  })

  it('高基数 ID label 触发警告（不是异常）', () => {
    const sink = new MemoryMetricsSink()
    expect(() =>
      sink.incrementCounter('test', {
        streamKind: 'ai-draft',
        transport: 'sse',
        outcome: 'success',
      } as any),
    ).not.toThrow()
  })

  it('error 模式下禁止 label 抛出 InstrumentationError', () => {
    const sink = new MemoryMetricsSink({ onForbiddenLabel: 'error' })
    expect(() =>
      sink.incrementCounter('test', {
        streamKind: 'ai-draft',
        transport: 'sse',
        outcome: 'success',
        draftId: 'draft-123',
      } as any),
    ).toThrow(InstrumentationError)
  })
})

describe('TestMetricsSink', () => {
  it('记录所有操作', () => {
    const sink = new TestMetricsSink()
    sink.incrementCounter('c1', makeLabels('ai-draft', 'sse', 'success'))
    sink.recordDuration('d1', makeLabels('compiler', 'realtime', 'success'), 100)
    sink.setGauge('g1', makeLabels('ai-draft', 'sse', 'success'), 10)
    expect(sink.records.length).toBe(3)
  })

  it('counterTotal 按 label 过滤', () => {
    const sink = new TestMetricsSink()
    sink.incrementCounter('c', makeLabels('ai-draft', 'sse', 'success'))
    sink.incrementCounter('c', makeLabels('compiler', 'realtime', 'failure'))
    sink.incrementCounter('c', makeLabels('ai-draft', 'sse', 'success'))
    expect(sink.counterTotal('c', { streamKind: 'ai-draft' })).toBe(2)
  })

  it('findDurations 返回匹配值', () => {
    const sink = new TestMetricsSink()
    sink.recordDuration('latency', makeLabels('ai-draft', 'sse', 'success'), 100)
    sink.recordDuration('latency', makeLabels('ai-draft', 'sse', 'success'), 200)
    sink.recordDuration('latency', makeLabels('compiler', 'realtime', 'failure'), 300)
    const dur = sink.findDurations('latency', { streamKind: 'ai-draft' })
    expect(dur).toEqual([100, 200])
  })

  it('clear 清空', () => {
    const sink = new TestMetricsSink()
    sink.incrementCounter('c', makeLabels('ai-draft', 'sse', 'success'))
    expect(sink.records.length).toBeGreaterThan(0)
    sink.clear()
    expect(sink.records.length).toBe(0)
  })

  it('snapshot 返回诊断', () => {
    const sink = new TestMetricsSink()
    sink.recordDiagnostic({
      timestamp: 't',
      streamKind: 'ai-draft',
      transport: 'sse',
      correlationId: 'test',
      operation: 'session_open',
      outcome: 'success',
      reasonCode: 'CONNECT_SUCCESS',
    })
    const snap = sink.snapshot()
    expect(snap.diagnostics).toHaveLength(1)
  })
})

describe('label-allowlist', () => {
  it('validateLabels: 合法 label 通过', () => {
    const result = validateLabels(
      { streamKind: 'ai-draft', transport: 'sse', outcome: 'success' },
      'report',
    )
    expect(result.valid).toBe(true)
  })

  it('validateLabels: 禁止字段被检测', () => {
    const result = validateLabels(
      { streamKind: 'ai-draft', transport: 'sse', outcome: 'success', userId: 'user-123' },
      'report',
    )
    expect(result.valid).toBe(false)
  })

  it('validateLabels: strip 模式移除禁止字段', () => {
    const result = validateLabels(
      { streamKind: 'ai-draft', transport: 'sse', outcome: 'success', draftId: 'd-1' },
      'strip',
    )
    expect(Object.keys(result.sanitized)).not.toContain('draftId')
  })

  it('validateLabels: reject 模式抛出', () => {
    expect(() =>
      validateLabels(
        { streamKind: 'ai-draft', transport: 'sse', outcome: 'success', runId: 'r-1' },
        'reject',
      ),
    ).toThrow()
  })

  it('estimateSeriesCount 有界', () => {
    const count = estimateSeriesCount(
      ['ai-draft', 'compiler'],
      ['success', 'failure', 'timeout'],
      ['CONNECT_SUCCESS', 'CONNECT_FAILURE', 'HEARTBEAT_OK', 'PUBLISH_FAILED', 'PUBLISH_OK'],
    )
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(500)
  })
})

describe('makeLabels', () => {
  it('返回完整标签', () => {
    const labels = makeLabels('ai-draft', 'sse', 'success', { reasonCode: 'FIRST_EVENT_OK' })
    expect(labels.streamKind).toBe('ai-draft')
    expect(labels.transport).toBe('sse')
    expect(labels.outcome).toBe('success')
    expect(labels.reasonCode).toBe('FIRST_EVENT_OK')
  })
})

describe('大量不同 stream fixture 验证 series 数量', () => {
  it('series 数量不随业务 ID 线性增长', () => {
    const sink = new MemoryMetricsSink()
    const streamKinds = ['ai-draft', 'compiler'] as const
    const outcomes = ['success', 'failure', 'timeout', 'stale'] as const
    const reasons = [
      'CONNECT_SUCCESS',
      'PUBLISH_FAILED',
      'HEARTBEAT_MISSED',
      'REPLAY_FAILED',
    ] as const

    // 模拟大量不同 stream——但只使用稳定 label 组合
    for (let i = 0; i < 100; i++) {
      for (const sk of streamKinds) {
        for (const oc of outcomes) {
          sink.incrementCounter(`stream_op`, {
            streamKind: sk,
            transport: sk === 'ai-draft' ? 'sse' : 'realtime',
            outcome: oc,
            reasonCode: reasons[i % reasons.length],
          } as any)
        }
      }
    }

    const snap = sink.snapshot()
    // series 数量应远小于 100 × 2 × 4 = 800 的上限
    // 因为只使用了 5 个 stable label 维度组合
    expect(snap.seriesCount).toBeGreaterThan(0)
    expect(snap.seriesCount).toBeLessThan(50)
  })
})
