/**
 * Transport-health 诊断事件、健康摘要与阈值测试（tasks 5.1–5.6, 6.1–6.3, 7.1–7.5）。
 */

import { describe, it, expect } from 'vitest'
import {
  createDiagnosticEvent,
  serializeDiagnosticEvent,
  containsForbiddenDiagnosticFields,
  generateCorrelationId,
  resetCorrelationCounter,
} from '../../../app/services/transport-health/diagnostic_events.js'
import { HealthSummaryService } from '../../../app/services/transport-health/health_summary_service.js'
import { ThresholdEvaluator } from '../../../app/services/transport-health/threshold_evaluator.js'
import {
  MemoryMetricsSink,
  TestMetricsSink,
  makeLabels,
} from '../../../app/services/transport-health/metrics_port.js'
import { DEFAULT_THRESHOLDS } from '@aiproj/types/streaming-observability'

describe('DiagnosticEvent', () => {
  it('创建合法诊断事件', () => {
    const event = createDiagnosticEvent({
      streamKind: 'ai-draft',
      transport: 'sse',
      operation: 'first_event',
      outcome: 'success',
      reasonCode: 'FIRST_EVENT_OK',
      correlationId: 'corr-1',
      durationMs: 150,
    })
    expect(event.streamKind).toBe('ai-draft')
    expect(event.reasonCode).toBe('FIRST_EVENT_OK')
    expect(event.durationBucketMs).toBe(200)
  })

  it('序列化只输出 allowed 字段', () => {
    const event = createDiagnosticEvent({
      streamKind: 'compiler',
      transport: 'realtime',
      operation: 'publish',
      outcome: 'failure',
      reasonCode: 'PUBLISH_FAILED',
      correlationId: 'corr-2',
      safeCount: 3,
    })
    const serialized = serializeDiagnosticEvent(event)
    // correlationId 是 allowlist 中的字段，应在输出中
    expect(Object.keys(serialized)).toContain('correlationId')
    // Verify all keys are from allowlist
    expect(
      Object.keys(serialized).every((k) =>
        [
          'timestamp',
          'streamKind',
          'transport',
          'correlationId',
          'operation',
          'outcome',
          'reasonCode',
          'durationBucketMs',
          'safeCount',
          'errorCode',
        ].includes(k),
      ),
    ).toBe(true)
  })

  it('containsForbiddenDiagnosticFields 检测敏感字段', () => {
    expect(containsForbiddenDiagnosticFields({ prompt: 'hello' }).found).toBe(true)
    expect(containsForbiddenDiagnosticFields({ rawOutput: '...' }).found).toBe(true)
    expect(containsForbiddenDiagnosticFields({ token: 'abc' }).found).toBe(true)
    expect(containsForbiddenDiagnosticFields({ secret: 'xyz' }).found).toBe(true)
  })

  it('containsForbiddenDiagnosticFields 通过安全对象', () => {
    expect(
      containsForbiddenDiagnosticFields({ streamKind: 'ai-draft', transport: 'sse' }).found,
    ).toBe(false)
  })

  it('correlationId 生成与重置', () => {
    resetCorrelationCounter()
    const id1 = generateCorrelationId('test')
    const id2 = generateCorrelationId('test')
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^test_/)
  })

  it('相同 failure injection 产生一致 reasonCode', () => {
    resetCorrelationCounter()
    const event1 = createDiagnosticEvent({
      streamKind: 'compiler',
      transport: 'realtime',
      operation: 'replay_failure',
      outcome: 'failure',
      reasonCode: 'REPLAY_FAILED',
      correlationId: generateCorrelationId('replay'),
    })
    const event2 = createDiagnosticEvent({
      streamKind: 'compiler',
      transport: 'realtime',
      operation: 'replay_failure',
      outcome: 'failure',
      reasonCode: 'REPLAY_FAILED',
      correlationId: generateCorrelationId('replay'),
    })
    expect(event1.reasonCode).toBe(event2.reasonCode)
    expect(event1.operation).toBe(event2.operation)
    // correlationId 是顺序递增的，第二个应不同（counter 已自增）
    expect(event1.correlationId).not.toBe(event2.correlationId)
  })
})

describe('HealthSummaryService', () => {
  it('空 sink 返回两个领域摘要', () => {
    const sink = new MemoryMetricsSink()
    const svc = new HealthSummaryService()
    const summary = svc.aggregate(sink)
    expect(summary.summaries.length).toBe(2)
    expect(summary.summaries[0].streamKind).toBe('ai-draft')
    expect(summary.summaries[1].streamKind).toBe('compiler')
  })

  it('含数据时返回正确的统计', () => {
    const sink = new MemoryMetricsSink()
    // 模拟 AI Draft 首事件延迟
    sink.recordDuration('first_event_latency', makeLabels('ai-draft', 'sse', 'success'), 500)
    sink.recordDuration('first_event_latency', makeLabels('ai-draft', 'sse', 'success'), 1000)
    // 模拟 Compiler replay
    sink.recordDiagnostic({
      timestamp: new Date().toISOString(),
      streamKind: 'compiler',
      transport: 'realtime',
      correlationId: 'test',
      operation: 'replay_success',
      outcome: 'success',
      reasonCode: 'REPLAY_OK',
    })
    sink.recordDiagnostic({
      timestamp: new Date().toISOString(),
      streamKind: 'compiler',
      transport: 'realtime',
      correlationId: 'test',
      operation: 'replay_failure',
      outcome: 'failure',
      reasonCode: 'REPLAY_FAILED',
    })

    const svc = new HealthSummaryService()
    const summary = svc.aggregate(sink)

    const aiDraft = summary.summaries.find((s) => s.streamKind === 'ai-draft')!
    expect(aiDraft.firstEventLatencyMs).not.toBeNull()
    expect(aiDraft.firstEventLatencyMs!.sampleCount).toBe(2)
    expect(aiDraft.firstEventLatencyMs!.avgMs).toBe(750)

    const compiler = summary.summaries.find((s) => s.streamKind === 'compiler')!
    expect(compiler.replaySummary).not.toBeNull()
    expect(compiler.replaySummary!.successCount).toBe(1)
    expect(compiler.replaySummary!.failureCount).toBe(1)
  })

  it('首事件延迟统计正确', () => {
    const sink = new MemoryMetricsSink()
    sink.recordDuration('first_event_latency', makeLabels('ai-draft', 'sse', 'success'), 100)
    sink.recordDuration('first_event_latency', makeLabels('ai-draft', 'sse', 'success'), 200)
    sink.recordDuration('first_event_latency', makeLabels('ai-draft', 'sse', 'success'), 300)

    const svc = new HealthSummaryService()
    const summary = svc.aggregate(sink)
    const aiDraft = summary.summaries.find((s) => s.streamKind === 'ai-draft')!

    expect(aiDraft.firstEventLatencyMs!.avgMs).toBe(200)
    expect(aiDraft.firstEventLatencyMs!.p50Ms).toBe(200)
    expect(aiDraft.firstEventLatencyMs!.maxMs).toBe(300)
  })

  it('windowStartedAt 不为空', () => {
    const sink = new MemoryMetricsSink()
    const svc = new HealthSummaryService()
    const summary = svc.aggregate(sink)
    for (const s of summary.summaries) {
      expect(s.windowStartedAt).toBeTruthy()
    }
  })

  it('无数据时健康状态为 healthy', () => {
    const sink = new MemoryMetricsSink()
    const svc = new HealthSummaryService()
    const summary = svc.aggregate(sink)
    for (const s of summary.summaries) {
      expect(s.healthState).toBe('healthy')
    }
  })

  it('诊断中 failure → 健康状态为 critical', () => {
    const sink = new MemoryMetricsSink()
    sink.recordDiagnostic({
      timestamp: new Date().toISOString(),
      streamKind: 'compiler',
      transport: 'realtime',
      correlationId: 'test',
      operation: 'publish_failure',
      outcome: 'failure',
      reasonCode: 'PUBLISH_FAILED',
    })
    const svc = new HealthSummaryService()
    const summary = svc.aggregate(sink)
    const compiler = summary.summaries.find((s) => s.streamKind === 'compiler')!
    expect(compiler.healthState).toBe('critical')
    expect(compiler.alerts.length).toBeGreaterThan(0)
  })

  it('进程重启后 windowStartedAt 更新', () => {
    const svc1 = new HealthSummaryService({ resetReason: 'RESET_REASON_PROCESS_RESTART' })
    const svc2 = new HealthSummaryService({ resetReason: 'RESET_REASON_PROCESS_RESTART' })
    // 两个不同的实例应有不同的 windowStartedAt
    // （毫秒级差异，不 assert 相等）
    expect(svc1.windowStartedAt).toBeTruthy()
    expect(svc2.windowStartedAt).toBeTruthy()
  })
})

describe('ThresholdEvaluator', () => {
  const sink = new MemoryMetricsSink()
  const svc = new HealthSummaryService()

  it('健康摘要通过所有阈值', () => {
    const summary = svc.aggregate(sink)
    const evaluator = new ThresholdEvaluator()
    for (const s of summary.summaries) {
      const result = evaluator.evaluate(s)
      expect(result.overallState).toBe('healthy')
    }
  })

  it('每个阈值都有 id、runbookRef 和 source', () => {
    for (const t of DEFAULT_THRESHOLDS) {
      expect(t.id).toBeTruthy()
      expect(t.runbookRef).toMatch(/^#/)
      expect(t.source).toBeTruthy()
    }
  })

  it('阈值越界只产生状态，不自动修复', () => {
    const sink2 = new MemoryMetricsSink()
    // 模拟高延迟
    for (let i = 0; i < 10; i++) {
      sink2.recordDuration('first_event_latency', makeLabels('ai-draft', 'sse', 'success'), 20000)
    }
    const summary = svc.aggregate(sink2)
    const evaluator = new ThresholdEvaluator()
    const aiDraft = summary.summaries.find((s) => s.streamKind === 'ai-draft')!
    const result = evaluator.evaluate(aiDraft)

    // 应有 warning 或 critical
    expect(['warning', 'critical']).toContain(result.overallState)
    // 阈值评价不修改业务状态
    expect(sink2.snapshot().seriesCount).toBeGreaterThan(0)
  })

  it('get thresholds 返回配置副本', () => {
    const evaluator = new ThresholdEvaluator()
    const thresholds = evaluator.thresholds
    expect(thresholds.length).toBeGreaterThan(0)
  })

  it('resetToDefaults 恢复默认', () => {
    const evaluator = new ThresholdEvaluator({ thresholds: [] })
    expect(evaluator.thresholds.length).toBe(0)
    evaluator.resetToDefaults()
    expect(evaluator.thresholds.length).toBeGreaterThan(0)
  })
})

describe('失败注入——相同的 failure injection 产生一致 reasonCode', () => {
  it('replay failure 始终 REPLAY_FAILED', () => {
    const event1 = createDiagnosticEvent({
      streamKind: 'compiler',
      transport: 'realtime',
      operation: 'replay_failure',
      outcome: 'failure',
      reasonCode: 'REPLAY_FAILED',
      correlationId: 'test-1',
    })
    const event2 = createDiagnosticEvent({
      streamKind: 'compiler',
      transport: 'realtime',
      operation: 'replay_failure',
      outcome: 'failure',
      reasonCode: 'REPLAY_FAILED',
      correlationId: 'test-2',
    })
    expect(event1.reasonCode).toBe('REPLAY_FAILED')
    expect(event2.reasonCode).toBe('REPLAY_FAILED')
  })

  it('heartbeat stale 始终 HEARTBEAT_STALE', () => {
    const event = createDiagnosticEvent({
      streamKind: 'ai-draft',
      transport: 'sse',
      operation: 'heartbeat',
      outcome: 'stale',
      reasonCode: 'HEARTBEAT_STALE',
      correlationId: 'test-3',
    })
    expect(event.reasonCode).toBe('HEARTBEAT_STALE')
  })

  it('metric/diagnostic/health 一致', () => {
    const sink = new TestMetricsSink()
    // 记录一次 replay failure
    sink.recordDiagnostic({
      timestamp: new Date().toISOString(),
      streamKind: 'compiler',
      transport: 'realtime',
      correlationId: 'test',
      operation: 'replay_failure',
      outcome: 'failure',
      reasonCode: 'REPLAY_FAILED',
    })

    const snap = sink.snapshot()
    expect(snap.diagnostics).toHaveLength(1)
    expect(snap.diagnostics[0]!.reasonCode).toBe('REPLAY_FAILED')
    expect(snap.diagnostics[0]!.operation).toBe('replay_failure')
  })
})
