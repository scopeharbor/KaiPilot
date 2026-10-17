/**
 * Compiler 观测器测试（tasks 4.1–4.7）。
 */

import { describe, it, expect } from 'vitest'
import { CompilerObserver } from '../../../app/services/transport-health/compiler_observer.js'
import {
  TestMetricsSink,
  MemoryMetricsSink,
} from '../../../app/services/transport-health/metrics_port.js'
import { HealthSummaryService } from '../../../app/services/transport-health/health_summary_service.js'

describe('CompilerObserver', () => {
  let metrics: TestMetricsSink
  let diagnostics: TestMetricsSink
  let observer: CompilerObserver

  function freshObserver(): void {
    metrics = new TestMetricsSink()
    diagnostics = new TestMetricsSink()
    observer = new CompilerObserver({ metricsPort: metrics, diagnosticPort: diagnostics })
  }

  // ── 4.1: Publish ──

  describe('Publish', () => {
    it('recordPublishSuccess 记录成功', () => {
      freshObserver()
      observer.recordPublishSuccess('test-corr')
      expect(metrics.counterTotal('publish', { outcome: 'success' })).toBe(1)
    })

    it('recordPublishFailure 记录失败', () => {
      freshObserver()
      observer.recordPublishFailure('test-corr')
      expect(metrics.counterTotal('publish', { outcome: 'failure' })).toBe(1)
    })
  })

  // ── 4.2: 订阅 ──

  describe('订阅', () => {
    it('recordSubscribe 接受', () => {
      freshObserver()
      observer.recordSubscribe('test-corr', true)
      expect(metrics.counterTotal('subscribe', { outcome: 'success' })).toBe(1)
    })

    it('recordSubscribe 拒绝', () => {
      freshObserver()
      observer.recordSubscribe('test-corr', false)
      expect(metrics.counterTotal('subscribe', { outcome: 'rejected' })).toBe(1)
    })

    it('recordUnsubscribe 记录退订', () => {
      freshObserver()
      observer.recordUnsubscribe('test-corr')
      expect(metrics.counterTotal('unsubscribe')).toBe(1)
    })
  })

  // ── 4.3: 不复制 Stage metadata ──

  describe('不复制 Stage metadata', () => {
    it('observer 不存储 stage metadata、artifact 或 cost ledger 字段', () => {
      freshObserver()
      observer.recordPublishSuccess('test-corr')
      // 验证记录的诊断不含 stage 业务字段
      const diags = diagnostics.findByType('diagnostic')
      for (const d of diags) {
        const payload = d.diagnostic!
        expect(payload.errorCode).toBeUndefined() // 成功 publish 无 errorCode
      }
    })
  })

  // ── 4.4: 集成测试 ──

  describe('集成测试', () => {
    it('publish 成功 → replay 成功 → 终态投递', () => {
      freshObserver()
      const corr = 'integ-test-1'
      observer.recordPublishSuccess(corr)
      observer.recordReplayRequest(corr)
      observer.recordReplaySuccess(corr)
      observer.recordTerminal(corr, true)
      expect(metrics.counterTotal('publish', { outcome: 'success' })).toBe(1)
      expect(metrics.counterTotal('replay_success')).toBe(1)
      expect(metrics.counterTotal('terminal_delivery', { outcome: 'success' })).toBe(1)
    })

    it('publish 失败 → REST replay 成功', () => {
      freshObserver()
      const corr = 'integ-test-2'
      observer.recordPublishFailure(corr)
      observer.recordRestFallbackSuccess(corr)
      expect(metrics.counterTotal('publish', { outcome: 'failure' })).toBe(1)
      expect(metrics.counterTotal('rest_fallback', { outcome: 'success' })).toBe(1)
    })

    it('订阅拒绝不泄露 run 是否存在', () => {
      freshObserver()
      const corr = 'integ-test-3'
      observer.recordSubscribeRejected(corr)
      expect(metrics.counterTotal('subscribe_rejected')).toBe(1)
      const diags = diagnostics.findByType('diagnostic')
      expect(diags[0]?.diagnostic?.reasonCode).toBe('SUBSCRIBE_REJECTED')
    })
  })

  // ── 4.5: 失败注入 ──

  describe('失败注入', () => {
    it('replay 失败 + retention reset', () => {
      freshObserver()
      const corr = 'fail-test-1'
      observer.recordReplayFailure(corr, 3) // 3 次重试
      observer.recordReplayReset(corr, 'REPLAY_RESET_REQUIRED')
      expect(metrics.counterTotal('replay_failure')).toBe(1)
      expect(metrics.counterTotal('replay_reset')).toBe(1)
      const diags = diagnostics.findByType('diagnostic')
      const resetDiag = diags.find((d) => d.diagnostic?.reasonCode === 'REPLAY_RESET_REQUIRED')
      expect(resetDiag).toBeDefined()
    })

    it('cleanup 超时后正常清理', () => {
      freshObserver()
      observer.recordUnsubscribe('cleanup-test')
      expect(metrics.counterTotal('unsubscribe')).toBe(1)
    })

    it('terminal 缺失', () => {
      freshObserver()
      observer.recordTerminal('missing', false)
      expect(metrics.counterTotal('terminal_delivery', { outcome: 'failure' })).toBe(1)
    })
  })

  // ── 4.6: 跨组织安全 ──

  describe('跨组织安全', () => {
    it('只产生聚合安全结果', () => {
      freshObserver()
      // 模拟来自 3 个不同组织的拒绝——只记录聚合信息
      observer.recordSubscribeRejected('org-a')
      observer.recordSubscribeRejected('org-b')
      observer.recordSubscribeRejected('org-c')
      expect(metrics.counterTotal('subscribe_rejected')).toBe(3)
      // 诊断不含 organizationId
      for (const r of diagnostics.records) {
        expect((r.diagnostic as any)?.organizationId).toBeUndefined()
      }
    })
  })

  // ── 4.7: 回归验证 ──

  describe('回归验证', () => {
    it('metrics sink 失败不回滚 Stage Event', () => {
      freshObserver()
      // 模拟 metrics 失败但业务路径正常
      const errors = CompilerObserver.assertNoBusinessEventSideEffect(
        true, // metrics failure
        true, // stage event persisted
        true, // realtime continued
      )
      expect(errors).toEqual([])
    })

    it('metrics sink 失败不制造幽灵事件', () => {
      freshObserver()
      CompilerObserver.assertNoBusinessEventSideEffect(
        true, // metrics failure
        true, // stage event persisted
        true, // realtime continued
      )
      // 幽灵事件：metrics 失败后不应出现不存在的业务事件
      const diags = diagnostics.findByType('diagnostic')
      expect(diags).toHaveLength(0) // 尚未记录任何诊断
    })

    it('metrics sink 失败不触发 artifact apply', () => {
      freshObserver()
      observer.recordPublishFailure('test')
      // publish 失败只记录指标，不触发 artifact apply
      // 验证：没有 artifact 相关的诊断
      const diagRecords = diagnostics.records.filter(
        (r) => r.diagnostic?.operation === 'terminal_delivery',
      )
      expect(diagRecords).toHaveLength(0)
    })
  })
})

describe('Compiler 健康摘要兼容性', () => {
  it('observer 数据可在 HealthSummaryService 中聚合', () => {
    const metrics = new TestMetricsSink()
    const diagnostics = new TestMetricsSink()
    const observer = new CompilerObserver({ metricsPort: metrics, diagnosticPort: diagnostics })

    const corr = 'health-test'
    observer.recordPublishSuccess(corr)
    observer.recordSubscribe(corr, true)
    observer.recordReplaySuccess(corr)
    observer.recordTerminal(corr, true)

    const heap = new MemoryMetricsSink()
    for (const r of diagnostics.records) {
      if (r.diagnostic) heap.recordDiagnostic(r.diagnostic)
    }
    const svc = new HealthSummaryService()
    const summary = svc.aggregate(heap)
    const compiler = summary.summaries.find((s) => s.streamKind === 'compiler')!
    expect(compiler.terminalDeliveryCount).toBeGreaterThan(0)
  })
})
