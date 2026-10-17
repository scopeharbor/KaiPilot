/**
 * @aiproj/backend —— Compiler Realtime Bridge 生命周期观测器（tasks 4.1–4.7）。
 *
 * 在 Compiler Stage Event publish、subscribe、snapshot、gap replay、
 * REST fallback 和 terminal 边界记录低敏 transport-health 指标。
 *
 * 复用 Stage Event 持久化事实，不复制 stage metadata、artifact、
 * context packet 或 cost ledger 字段。
 *
 * @aiproj/backend
 */

import { TestMetricsSink } from './metrics_port.js'
import type { MetricsPort, MetricLabels } from '@aiproj/types/streaming-observability'
import { createDiagnosticEvent } from './diagnostic_events.js'
import type {
  StreamKind,
  Transport,
  Outcome,
  ReasonCode,
  Operation,
} from '@aiproj/types/streaming-observability'

export type CompilerObserverOptions = {
  metricsPort?: MetricsPort
  diagnosticPort?: MetricsPort
  streamKind?: StreamKind
  transport?: Transport
}

/**
 * Compiler Realtime Bridge 运行期观测器。
 *
 * 使用方式（伪代码）：
 *   const obs = new CompilerObserver({ metricsPort, diagnosticPort })
 *   obs.recordPublishSuccess('corr-1')
 *   obs.recordSubscribe('corr-2', true)
 *   obs.recordReplaySuccess('corr-3')
 */
export class CompilerObserver {
  readonly #metricsPort: MetricsPort
  readonly #diagnosticPort: MetricsPort
  readonly #streamKind: StreamKind
  readonly #transport: Transport

  constructor(options?: CompilerObserverOptions) {
    this.#metricsPort = options?.metricsPort ?? new TestMetricsSink()
    this.#diagnosticPort = options?.diagnosticPort ?? new TestMetricsSink()
    this.#streamKind = options?.streamKind ?? 'compiler'
    this.#transport = options?.transport ?? 'realtime'
  }

  /** 获取当前 metrics port（用于测试断言）。 */
  get metricsPort(): MetricsPort {
    return this.#metricsPort
  }

  /** 获取当前 diagnostic port（用于测试断言）。 */
  get diagnosticPort(): MetricsPort {
    return this.#diagnosticPort
  }

  #labels(outcome: Outcome, reasonCode?: ReasonCode): MetricLabels {
    return { streamKind: this.#streamKind, transport: this.#transport, outcome, reasonCode }
  }

  #recordDiagnostic(
    correlationId: string,
    operation: Operation,
    outcome: Outcome,
    reasonCode: ReasonCode,
    overrides?: { durationMs?: number; safeCount?: number; errorCode?: string },
  ): void {
    const event = createDiagnosticEvent({
      streamKind: this.#streamKind,
      transport: this.#transport,
      operation,
      outcome,
      reasonCode,
      correlationId,
      durationMs: overrides?.durationMs,
      safeCount: overrides?.safeCount,
      errorCode: overrides?.errorCode,
    })
    this.#diagnosticPort.recordDiagnostic(event)
  }

  // ── 4.1: Publish ──

  /**
   * 记录 publish 成功。
   * Stage Event 已持久化，realtime 发送成功。
   */
  recordPublishSuccess(correlationId: string): void {
    this.#metricsPort.incrementCounter('publish', this.#labels('success', 'PUBLISH_OK'))
    this.#recordDiagnostic(correlationId, 'publish_success', 'success', 'PUBLISH_OK')
  }

  /**
   * 记录 publish 失败。
   * Stage Event 已持久化，但 realtime 发送失败（业务不回滚）。
   */
  recordPublishFailure(correlationId: string): void {
    this.#metricsPort.incrementCounter('publish', this.#labels('failure', 'PUBLISH_FAILED'))
    this.#recordDiagnostic(correlationId, 'publish_failure', 'failure', 'PUBLISH_FAILED')
  }

  // ── 4.2: 订阅 ──

  /**
   * 记录订阅事件。
   */
  recordSubscribe(correlationId: string, accepted: boolean): void {
    if (accepted) {
      this.#metricsPort.incrementCounter('subscribe', this.#labels('success', 'SUBSCRIBE_OK'))
      this.#metricsPort.setGauge('active_subscriptions', this.#labels('success'), 1)
      this.#recordDiagnostic(correlationId, 'subscribe', 'success', 'SUBSCRIBE_OK')
    } else {
      this.#metricsPort.incrementCounter(
        'subscribe',
        this.#labels('rejected', 'SUBSCRIBE_REJECTED'),
      )
      this.#recordDiagnostic(correlationId, 'subscribe', 'rejected', 'SUBSCRIBE_REJECTED')
    }
  }

  /**
   * 记录退订事件。
   */
  recordUnsubscribe(correlationId: string): void {
    this.#metricsPort.incrementCounter('unsubscribe', this.#labels('success'))
    this.#metricsPort.setGauge('active_subscriptions', this.#labels('success'), 0)
    this.#recordDiagnostic(correlationId, 'unsubscribe', 'success', 'CLEANUP_OK')
  }

  // ── 4.2: Snapshot ──

  /**
   * 记录快照请求。
   */
  recordSnapshot(correlationId: string): void {
    this.#metricsPort.incrementCounter('snapshot', this.#labels('success'))
    this.#recordDiagnostic(correlationId, 'snapshot', 'success', 'CONNECT_SUCCESS')
  }

  // ── 4.2: Gap Replay ──

  /**
   * 记录 gap 检测后的 replay 请求和成功。
   */
  recordReplayRequest(correlationId: string): void {
    this.#metricsPort.incrementCounter('replay_request', this.#labels('success'))
    this.#recordDiagnostic(correlationId, 'replay_request', 'success', 'REPLAY_OK')
  }

  /**
   * 记录 replay 成功。
   */
  recordReplaySuccess(correlationId: string): void {
    this.#metricsPort.incrementCounter('replay_success', this.#labels('success', 'REPLAY_OK'))
    this.#recordDiagnostic(correlationId, 'replay_success', 'success', 'REPLAY_OK')
  }

  /**
   * 记录 replay 失败。
   */
  recordReplayFailure(correlationId: string, safeCount?: number): void {
    this.#metricsPort.incrementCounter('replay_failure', this.#labels('failure', 'REPLAY_FAILED'))
    this.#recordDiagnostic(correlationId, 'replay_failure', 'failure', 'REPLAY_FAILED', {
      safeCount,
    })
  }

  /**
   * 记录 replay reset。
   */
  recordReplayReset(correlationId: string, reason: ReasonCode): void {
    this.#metricsPort.incrementCounter('replay_reset', this.#labels('failure', reason))
    this.#recordDiagnostic(correlationId, 'replay_reset', 'failure', reason)
  }

  // ── 4.2: REST Fallback ──

  /**
   * 记录 REST fallback replay 成功。
   */
  recordRestFallbackSuccess(correlationId: string): void {
    this.#metricsPort.incrementCounter('rest_fallback', this.#labels('success', 'REST_REPLAY_OK'))
    this.#recordDiagnostic(correlationId, 'rest_replay', 'success', 'REST_REPLAY_OK')
  }

  /**
   * 记录 REST fallback replay 失败。
   */
  recordRestFallbackFailure(correlationId: string): void {
    this.#metricsPort.incrementCounter(
      'rest_fallback',
      this.#labels('failure', 'REST_REPLAY_FAILED'),
    )
    this.#recordDiagnostic(correlationId, 'rest_replay', 'failure', 'REST_REPLAY_FAILED')
  }

  // ── 4.2: 终态 ──

  /**
   * 记录终态投递。
   */
  recordTerminal(correlationId: string, isSuccess: boolean): void {
    const outcome: Outcome = isSuccess ? 'success' : 'failure'
    const reasonCode: ReasonCode = isSuccess ? 'TERMINAL_DELIVERED' : 'TERMINAL_MISSING'
    this.#metricsPort.incrementCounter('terminal_delivery', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'terminal_delivery', outcome, reasonCode)
  }

  // ── 4.6: 跨组织安全 ──

  /**
   * 记录订阅拒绝（跨组织/非成员/权限撤销）。
   * 只记录聚合安全结果，不泄露 run 是否存在。
   */
  recordSubscribeRejected(correlationId: string): void {
    this.#metricsPort.incrementCounter(
      'subscribe_rejected',
      this.#labels('rejected', 'SUBSCRIBE_REJECTED'),
    )
    this.#recordDiagnostic(correlationId, 'subscribe', 'rejected', 'SUBSCRIBE_REJECTED')
  }

  // ── 4.7: 回归验证辅助 ──

  /**
   * 验证 metrics sink 失败不回滚 Stage Event。
   * 用于测试——验证即使 metrics 抛出，业务路径仍正常完成。
   */
  static assertNoBusinessEventSideEffect(
    metricsFailure: boolean,
    stageEventPersisted: boolean,
    realtimeContinued: boolean,
  ): string[] {
    const errors: string[] = []
    if (metricsFailure && !stageEventPersisted) {
      errors.push('Metrics sink failure must not rollback Stage Event persistence')
    }
    if (metricsFailure && !realtimeContinued) {
      errors.push('Metrics sink failure must not stop realtime from continuing')
    }
    return errors
  }
}
