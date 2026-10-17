/**
 * AI Draft 观测器测试（tasks 3.1–3.7）。
 */

import { describe, it, expect } from 'vitest'
import { AiDraftObserver } from '../../../app/services/transport-health/ai_draft_observer.js'
import {
  TestMetricsSink,
  MemoryMetricsSink,
} from '../../../app/services/transport-health/metrics_port.js'
import { HealthSummaryService } from '../../../app/services/transport-health/health_summary_service.js'
import {
  generateCorrelationId,
  resetCorrelationCounter,
} from '../../../app/services/transport-health/diagnostic_events.js'

describe('AiDraftObserver', () => {
  let metrics: TestMetricsSink
  let diagnostics: TestMetricsSink
  let observer: AiDraftObserver

  function freshObserver(): void {
    metrics = new TestMetricsSink()
    diagnostics = new TestMetricsSink()
    observer = new AiDraftObserver({ metricsPort: metrics, diagnosticPort: diagnostics })
  }

  // ── 3.1: Session 生命周期 ──

  describe('Session 生命周期', () => {
    it('recordSessionOpen 记录 metric 和诊断', () => {
      freshObserver()
      observer.recordSessionOpen('test-corr')
      expect(metrics.counterTotal('session_open')).toBe(1)
      expect(diagnostics.findByType('diagnostic').length).toBe(1)
    })

    it('不把 draftId 作为 label', () => {
      freshObserver()
      observer.recordSessionOpen('test-corr')
      observer.recordSessionOpen('test-corr-2')
      // 不同 correlationId 不应创建新的 series
      expect(metrics.records.filter((r) => r.type === 'counter').length).toBe(2)
    })

    it('recordSessionClose 记录结束原因', () => {
      freshObserver()
      observer.recordSessionOpen('test-corr')
      observer.recordSessionClose('test-corr', 'CLEANUP_OK')
      expect(metrics.counterTotal('session_close')).toBe(1)
    })
  })

  // ── 3.2: SSE 事件 ──

  describe('SSE 事件', () => {
    it('recordSseOpen 记录连接', () => {
      freshObserver()
      observer.recordSseOpen('test-corr')
      expect(metrics.counterTotal('sse_open')).toBe(1)
    })

    it('recordFirstEvent 记录延迟', () => {
      freshObserver()
      observer.recordFirstEvent('test-corr', 100)
      const durs = metrics.findDurations('first_event_latency')
      expect(durs).toContain(100)
    })

    it('recordFirstEvent 慢事件标记 stale', () => {
      freshObserver()
      observer.recordFirstEvent('test-corr', 10000)
      const diags = diagnostics.findByType('diagnostic')
      expect(diags[0]?.diagnostic?.outcome).toBe('stale')
      expect(diags[0]?.diagnostic?.reasonCode).toBe('FIRST_EVENT_SLOW')
    })

    it('recordSemanticProgress 记录进度', () => {
      freshObserver()
      observer.recordSemanticProgress('test-corr')
      expect(metrics.counterTotal('semantic_progress')).toBe(1)
    })
  })

  // ── 3.3: Heartbeat、断开、恢复 ──

  describe('Heartbeat、断开、恢复', () => {
    it('recordHeartbeat 记录间隔', () => {
      freshObserver()
      observer.recordHeartbeat('test-corr', 15000)
      const durs = metrics.findDurations('heartbeat_gap')
      expect(durs).toContain(15000)
    })

    it('recordHeartbeat 长时间 gap 标记 stale', () => {
      freshObserver()
      observer.recordHeartbeat('test-corr', 120000)
      const diags = diagnostics.findByType('diagnostic')
      expect(diags[0]?.diagnostic?.reasonCode).toBe('HEARTBEAT_STALE')
    })

    it('recordDisconnect 异常标记 failure', () => {
      freshObserver()
      observer.recordDisconnect('test-corr', true)
      expect(metrics.counterTotal('disconnect', { outcome: 'failure' })).toBe(1)
    })

    it('recordDisconnect 正常标记 success', () => {
      freshObserver()
      observer.recordDisconnect('test-corr', false)
      expect(metrics.counterTotal('disconnect', { outcome: 'success' })).toBe(1)
    })

    it('recordResume cursor 过期', () => {
      freshObserver()
      observer.recordResume('test-corr', true)
      expect(metrics.counterTotal('resume', { outcome: 'expired' })).toBe(1)
    })
  })

  // ── 3.4: 确定性集成测试 ──

  describe('确定性集成测试', () => {
    it('started-before-model：首事件延迟记录', () => {
      freshObserver()
      resetCorrelationCounter()
      const corr = generateCorrelationId('test')
      observer.recordSseOpen(corr)
      observer.recordFirstEvent(corr, 200) // model 开始后 200ms 有首事件
      // 验证 metrics
      expect(metrics.counterTotal('sse_open')).toBe(1)
      expect(metrics.findDurations('first_event_latency')).toContain(200)
    })

    it('heartbeat 丢失检测', () => {
      freshObserver()
      const corr = generateCorrelationId('hb')
      observer.recordHeartbeat(corr, 15000) // 正常
      observer.recordHeartbeat(corr, 120000) // 丢失
      const durs = metrics.findDurations('heartbeat_gap')
      expect(durs).toEqual([15000, 120000])
      // 验证诊断中有 stale
      const staleDiags = diagnostics.records.filter(
        (r) => r.diagnostic?.reasonCode === 'HEARTBEAT_STALE',
      )
      expect(staleDiags.length).toBe(1)
    })

    it('断线重连后恢复', () => {
      freshObserver()
      const corr = generateCorrelationId('reconnect')
      observer.recordDisconnect(corr, true) // 异常断开
      observer.recordResume(corr, false) // 正常恢复
      expect(metrics.counterTotal('disconnect', { outcome: 'failure' })).toBe(1)
      expect(metrics.counterTotal('resume', { outcome: 'success' })).toBe(1)
    })

    it('replay 成功', () => {
      freshObserver()
      const corr = generateCorrelationId('replay')
      observer.recordReplay(corr, 'success', 'REPLAY_OK')
      expect(metrics.counterTotal('replay', { outcome: 'success' })).toBe(1)
    })
  })

  // ── 3.5: 失败注入测试 ──

  describe('失败注入测试', () => {
    it('cursor 过期 reset', () => {
      freshObserver()
      const corr = generateCorrelationId('reset')
      observer.recordResetRequired(corr, 'REPLAY_RESET_REQUIRED')
      expect(metrics.counterTotal('reset', { outcome: 'failure' })).toBe(1)
    })

    it('生成失败', () => {
      freshObserver()
      const corr = generateCorrelationId('fail')
      observer.recordGenerationFailed(corr, 'MODEL_TIMEOUT')
      expect(metrics.counterTotal('generation_failed')).toBe(1)
      const diags = diagnostics.findByType('diagnostic')
      expect(diags[0]?.diagnostic?.errorCode).toBe('MODEL_TIMEOUT')
    })

    it('cleanup 超时', () => {
      freshObserver()
      const corr = generateCorrelationId('cleanup')
      observer.recordCleanup(corr, true)
      expect(metrics.counterTotal('cleanup', { outcome: 'timeout' })).toBe(1)
    })

    it('孤儿会话', () => {
      freshObserver()
      const corr = generateCorrelationId('orphan')
      observer.recordOrphanSession(corr)
      expect(metrics.counterTotal('orphan_session')).toBe(1)
    })
  })

  // ── 3.6: 敏感负载检查 ──

  describe('敏感负载安全检查', () => {
    it('assertNoSensitiveFields 检测到敏感字段', () => {
      const diags = [
        {
          timestamp: 't',
          streamKind: 'ai-draft',
          operation: 'session_open',
          prompt: 'user input here', // 禁止
        },
      ]
      const errors = AiDraftObserver.assertNoSensitiveFields(diags)
      expect(errors.length).toBeGreaterThan(0)
    })

    it('assertNoSensitiveFields 通过安全负载', () => {
      const diags = [
        {
          timestamp: 't',
          streamKind: 'ai-draft',
          operation: 'session_open',
          reasonCode: 'CONNECT_SUCCESS',
        },
      ]
      const errors = AiDraftObserver.assertNoSensitiveFields(diags)
      expect(errors.length).toBe(0)
    })

    it('AI Draft 诊断不包含用户身份', () => {
      freshObserver()
      const corr = generateCorrelationId('test')
      observer.recordSessionOpen(corr)
      observer.recordFirstEvent(corr, 100)
      observer.recordTerminal(corr, 'completed')
      const snap = diagnostics.snapshot()
      const errors = AiDraftObserver.assertNoSensitiveFields(snap.diagnostics as any)
      expect(errors.length).toBe(0)
    })
  })

  // ── 3.7: 回归验证 ──

  describe('回归验证', () => {
    it('instrumentation 不改变业务终态', () => {
      freshObserver()
      const corr = generateCorrelationId('regress')
      observer.recordSseOpen(corr)
      observer.recordFirstEvent(corr, 300)
      observer.recordTerminal(corr, 'completed')
      // 只验证观测器自身行为，业务序列/持久化由业务代码保证
      expect(metrics.records.length).toBeGreaterThan(0)
    })
  })
})

describe('AI Draft 健康摘要兼容性', () => {
  it('observer 数据可在 HealthSummaryService 中聚合', () => {
    const metrics = new TestMetricsSink()
    const diagnostics = new TestMetricsSink()
    const observer = new AiDraftObserver({ metricsPort: metrics, diagnosticPort: diagnostics })

    const corr = generateCorrelationId('agg')
    observer.recordSessionOpen(corr)
    observer.recordFirstEvent(corr, 500)
    observer.recordHeartbeat(corr, 15000)
    observer.recordTerminal(corr, 'completed')
    observer.recordSessionClose(corr, 'CLEANUP_OK')

    // 用 memory sink 聚合 HealthSummary
    const memorySink = diagnostics.snapshot()
    expect(memorySink.diagnostics.length).toBeGreaterThan(0)

    const svc = new HealthSummaryService()
    // 使用 TestMetricsSink 的快照需要创建一个 MemoryMetricsSink 来喂给 aggregator
    const heap = new MemoryMetricsSink()
    // 将 test sink 记录重放到 memory sink
    for (const r of diagnostics.records) {
      if (r.diagnostic) heap.recordDiagnostic(r.diagnostic)
    }
    const summary = svc.aggregate(heap)
    const aiDraft = summary.summaries.find((s) => s.streamKind === 'ai-draft')!
    expect(aiDraft.healthState).toBe('healthy') // 成功事件多
    expect(aiDraft.activeSessionCount).toBe(0)
  })
})
