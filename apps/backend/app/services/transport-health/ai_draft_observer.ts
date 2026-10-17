/**
 * @aiproj/backend —— AI Draft SSE 生命周期观测器（tasks 3.1–3.7）。
 *
 * 在 AI Draft runner/session、SSE 事件、heartbeat、disconnect、
 * resume/replay、reset 和 cleanup 边界记录低敏 transport-health 指标。
 *
 * 所有 instrumentation 不修改业务事件、sequence、持久化状态或终态。
 * 不使用 draftId 作为 metric label。
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

export type AiDraftObserverOptions = {
  /** 默认使用 MemoryMetricsSink；测试时注入 TestMetricsSink。 */
  metricsPort?: MetricsPort
  /** 默认使用 MemoryMetricsSink 记录诊断。 */
  diagnosticPort?: MetricsPort
  /** Stream kind，固定为 ai-draft。 */
  streamKind?: StreamKind
  /** 传输协议，固定为 sse。 */
  transport?: Transport
}

/**
 * AI Draft 运行期观测器。
 *
 * 使用方式（伪代码）：
 *   const observer = new AiDraftObserver({ metricsPort, diagnosticPort })
 *   observer.recordSessionOpen('corr-123')
 *   observer.recordFirstEvent('corr-123', 150)
 *   observer.recordTerminal('corr-123', 'completed')
 *   observer.recordSessionClose('corr-123', 'completed')
 */
export class AiDraftObserver {
  readonly #metricsPort: MetricsPort
  readonly #diagnosticPort: MetricsPort
  readonly #streamKind: StreamKind
  readonly #transport: Transport

  constructor(options?: AiDraftObserverOptions) {
    this.#metricsPort = options?.metricsPort ?? new TestMetricsSink()
    this.#diagnosticPort = options?.diagnosticPort ?? new TestMetricsSink()
    this.#streamKind = options?.streamKind ?? 'ai-draft'
    this.#transport = options?.transport ?? 'sse'
  }

  /** 获取当前 metrics port（用于测试断言）。 */
  get metricsPort(): MetricsPort {
    return this.#metricsPort
  }

  /** 获取当前 diagnostic port（用于测试断言）。 */
  get diagnosticPort(): MetricsPort {
    return this.#diagnosticPort
  }

  // ── Label 辅助 ──

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

  // ── 3.1: Session 生命周期 ──

  /**
   * 记录 session 创建。
   * 不把 draftId 作为 metric label。
   */
  recordSessionOpen(correlationId: string): void {
    this.#metricsPort.incrementCounter('session_open', this.#labels('success'))
    this.#metricsPort.setGauge('active_sessions', this.#labels('success'), 1)
    this.#recordDiagnostic(correlationId, 'session_open', 'success', 'CONNECT_SUCCESS')
  }

  /**
   * 记录 session 关闭及结束原因。
   * 不在 label 中包含 draftId。
   */
  recordSessionClose(correlationId: string, reason?: ReasonCode): void {
    this.#metricsPort.incrementCounter('session_close', this.#labels('success'))
    this.#metricsPort.setGauge('active_sessions', this.#labels('success'), 0)
    this.#recordDiagnostic(correlationId, 'session_close', 'success', reason ?? 'CLEANUP_OK')
  }

  // ── 3.2: SSE 事件 ──

  /**
   * 记录 SSE 连接打开。
   */
  recordSseOpen(correlationId: string): void {
    this.#metricsPort.incrementCounter('sse_open', this.#labels('success'))
    this.#recordDiagnostic(correlationId, 'session_open', 'success', 'CONNECT_SUCCESS')
  }

  /**
   * 记录首事件（time-to-first-event）。
   * durationMs 是 SSE 打开到第一个合法事件的时间。
   */
  recordFirstEvent(correlationId: string, durationMs: number): void {
    const isSlow = durationMs > 5000
    const outcome: Outcome = isSlow ? 'stale' : 'success'
    const reasonCode: ReasonCode = isSlow ? 'FIRST_EVENT_SLOW' : 'FIRST_EVENT_OK'

    this.#metricsPort.recordDuration(
      'first_event_latency',
      this.#labels(outcome, reasonCode),
      durationMs,
    )
    this.#metricsPort.incrementCounter('first_event', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'first_event', outcome, reasonCode, { durationMs })
  }

  /**
   * 记录语义进度事件（progress/checkpoint）。
   */
  recordSemanticProgress(correlationId: string): void {
    this.#metricsPort.incrementCounter('semantic_progress', this.#labels('success'))
    this.#recordDiagnostic(correlationId, 'semantic_progress', 'success', 'HEARTBEAT_OK')
  }

  // ── 3.3: Heartbeat、断开、恢复 ──

  /**
   * 记录 heartbeat 事件。
   * gapMs 是上次 heartbeat 到本次 heartbeat 的间隔。
   */
  recordHeartbeat(correlationId: string, gapMs?: number): void {
    if (gapMs !== undefined) {
      const isStale = gapMs > 60000
      const outcome: Outcome = isStale ? 'stale' : 'success'
      const reasonCode: ReasonCode = isStale ? 'HEARTBEAT_STALE' : 'HEARTBEAT_OK'
      this.#metricsPort.recordDuration('heartbeat_gap', this.#labels(outcome, reasonCode), gapMs)
      this.#metricsPort.incrementCounter('heartbeat', this.#labels(outcome, reasonCode))
      this.#recordDiagnostic(correlationId, 'heartbeat', outcome, reasonCode, { durationMs: gapMs })
    } else {
      this.#metricsPort.incrementCounter('heartbeat', this.#labels('success', 'HEARTBEAT_OK'))
    }
  }

  /**
   * 记录断线。
   */
  recordDisconnect(correlationId: string, isAbnormal: boolean): void {
    const outcome: Outcome = isAbnormal ? 'failure' : 'success'
    const reasonCode: ReasonCode = isAbnormal ? 'DISCONNECT_ABNORMAL' : 'DISCONNECT_CLEAN'
    this.#metricsPort.incrementCounter('disconnect', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'disconnect', outcome, reasonCode)
  }

  /**
   * 记录恢复。
   */
  recordResume(correlationId: string, cursorExpired?: boolean): void {
    const outcome: Outcome = cursorExpired ? 'expired' : 'success'
    const reasonCode: ReasonCode = cursorExpired ? 'RESUME_CURSOR_EXPIRED' : 'RESUME_OK'
    this.#metricsPort.incrementCounter('resume', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'resume', outcome, reasonCode)
  }

  /**
   * 记录 replay 事件。
   */
  recordReplay(correlationId: string, outcome: Outcome, reasonCode: ReasonCode): void {
    this.#metricsPort.incrementCounter('replay', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'replay_request', outcome, reasonCode)
  }

  /**
   * 记录 reset 要求。
   */
  recordResetRequired(correlationId: string, reason: ReasonCode): void {
    this.#metricsPort.incrementCounter('reset', this.#labels('failure', reason))
    this.#recordDiagnostic(correlationId, 'reset', 'failure', reason)
  }

  // ── 3.3: 清理 ──

  /**
   * 记录清理事件。
   */
  recordCleanup(correlationId: string, timedOut: boolean): void {
    const outcome: Outcome = timedOut ? 'timeout' : 'success'
    const reasonCode: ReasonCode = timedOut ? 'CLEANUP_TIMEOUT' : 'CLEANUP_OK'
    this.#metricsPort.incrementCounter('cleanup', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'cleanup', outcome, reasonCode)
  }

  /**
   * 记录孤儿会话。
   */
  recordOrphanSession(correlationId: string): void {
    this.#metricsPort.incrementCounter('orphan_session', this.#labels('failure', 'ORPHAN_SESSION'))
    this.#recordDiagnostic(correlationId, 'cleanup_timeout', 'failure', 'ORPHAN_SESSION')
  }

  // ── 3.2: 终态 ──

  /**
   * 记录终态投递（completed/failed/cancelled）。
   * terminated 指 AI 是否自然结束（非断线/超时中断）。
   */
  recordTerminal(correlationId: string, eventType: string): void {
    const isSuccess = eventType === 'completed'
    const outcome: Outcome = isSuccess ? 'success' : 'failure'
    const reasonCode: ReasonCode = isSuccess ? 'TERMINAL_DELIVERED' : 'TERMINAL_MISSING'
    this.#metricsPort.incrementCounter('terminal_delivery', this.#labels(outcome, reasonCode))
    this.#recordDiagnostic(correlationId, 'terminal_delivery', outcome, reasonCode)
  }

  /**
   * 记录生成失败。
   */
  recordGenerationFailed(correlationId: string, errorCode?: string): void {
    this.#metricsPort.incrementCounter(
      'generation_failed',
      this.#labels('failure', 'PUBLISH_FAILED'),
    )
    this.#recordDiagnostic(correlationId, 'session_close', 'failure', 'PUBLISH_FAILED', {
      errorCode,
    })
  }

  // ── 3.6: 验证辅助 ──

  /**
   * 验证 AI Draft 诊断负载不含敏感字段。
   * 用于回归测试（task 3.6/3.7）。
   */
  static assertNoSensitiveFields(diagnostics: Record<string, unknown>[]): string[] {
    const errors: string[] = []
    const sensitivePatterns = [
      'prompt',
      'rawOutput',
      'token',
      'secret',
      'moduleContent',
      'organizationId',
      'userId',
    ]
    for (const d of diagnostics) {
      for (const pattern of sensitivePatterns) {
        if (d[pattern] !== undefined) {
          errors.push(`Sensitive field found in diagnostic: ${pattern}`)
        }
      }
    }
    return errors
  }
}
