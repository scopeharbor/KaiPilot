/**
 * @aiproj/backend —— 流式传输健康摘要服务（tasks 6.1–6.7）。
 *
 * 按 streamKind 和固定窗口聚合 transport-health 指标，生成只读健康摘要。
 * 摘要不暴露单一 stream 身份，不含业务字段。
 *
 * 进程重启后窗口清空，摘要必须显式显示 windowStartedAt 和 resetReason。
 *
 * @aiproj/backend
 */

import type {
  MetricsPort,
  MetricsSnapshot,
  StreamKind,
  StreamingHealthState as HealthState,
  StreamHealthSummary,
  HealthSummary,
  LatencyStats,
  AlertState,
  ReasonCode,
} from '@aiproj/types/streaming-observability'

export interface HealthSummaryServiceOptions {
  /** 聚合窗口大小（毫秒），默认 300000（5 分钟）。 */
  windowSizeMs?: number
  /** 重置原因，默认 null（正常窗口滚动）。 */
  resetReason?: ReasonCode | null
}

/**
 * Transport-health 摘要聚合服务。
 * 基于 MetricsPort snapshot 聚合运行健康指标。
 */
export class HealthSummaryService {
  readonly #windowStartedAt: string
  readonly #resetReason: ReasonCode | null

  constructor(options?: HealthSummaryServiceOptions) {
    this.#windowStartedAt = new Date().toISOString()
    this.#resetReason = options?.resetReason ?? null
  }

  /** 当前窗口开始时间。 */
  get windowStartedAt(): string {
    return this.#windowStartedAt
  }

  /** 从 MetricsPort snapshot 聚合健康摘要。 */
  aggregate(memorySink: MetricsPort, testSink?: MetricsPort): HealthSummary {
    const snapshot = memorySink.snapshot()
    const testSnapshot = testSink?.snapshot()
    const allDiagnostics = [...snapshot.diagnostics, ...(testSnapshot?.diagnostics ?? [])]

    const aiDraftSummary = this.#aggregateStreamKind('ai-draft', snapshot, allDiagnostics)
    const compilerSummary = this.#aggregateStreamKind('compiler', snapshot, allDiagnostics)

    return {
      summaries: [aiDraftSummary, compilerSummary].filter(Boolean) as StreamHealthSummary[],
      aggregatedAt: new Date().toISOString(),
    }
  }

  #aggregateStreamKind(
    streamKind: StreamKind,
    snapshot: MetricsSnapshot,
    allDiagnostics: import('@aiproj/types/streaming-observability').DiagnosticEvent[],
  ): StreamHealthSummary {
    const streamDiags = allDiagnostics.filter((d) => d.streamKind === streamKind)

    // ── 首事件延迟 ──
    const firstEventLatencies = this.#extractDurations(snapshot, `first_event_latency`, streamKind)

    // ── Heartbeat gap ──
    const heartbeatGaps = this.#extractDurations(snapshot, 'heartbeat_gap', streamKind)

    // ── Replay 统计 ──
    const replayRequests = streamDiags.filter((d) => d.operation.startsWith('replay_')).length
    const replaySuccesses = streamDiags.filter((d) => d.operation === 'replay_success').length
    const replayFailures = streamDiags.filter((d) => d.operation === 'replay_failure').length
    const replayResets = streamDiags.filter((d) => d.operation === 'replay_reset').length

    // ── Reset 计数 ──
    const resetCount = streamDiags.filter(
      (d) =>
        d.operation === 'reset' ||
        d.operation === 'cursor_expired' ||
        d.reasonCode === 'REPLAY_RESET_REQUIRED',
    ).length

    // ── 终态投递 ──
    const terminalDeliveries = streamDiags.filter(
      (d) => d.operation === 'terminal_delivery' && d.outcome === 'success',
    ).length

    // ── 活跃会话数 ──
    const activeSessionGauge = snapshot.gauges[`active_sessions|streamKind=${streamKind}`]

    // ── 清理统计 ──
    const cleanupTotal = streamDiags.filter((d) => d.operation === 'cleanup').length
    const cleanupTimeouts = streamDiags.filter((d) => d.operation === 'cleanup_timeout').length
    const orphancount = streamDiags.filter((d) => d.reasonCode === 'ORPHAN_SESSION').length

    // ── 告警状态 ──
    const alertStates = this.#computeAlertStates(streamDiags)

    // ── 健康状态 ──
    const healthState = this.#computeHealthState(alertStates)

    // ── 最后事件时间 ──
    const lastEventAt =
      streamDiags.length > 0
        ? (streamDiags
            .map((d) => d.timestamp)
            .sort()
            .reverse()[0] ?? null)
        : null

    return {
      streamKind,
      windowStartedAt: this.#windowStartedAt,
      lastEventAt,
      resetReason: this.#resetReason,
      healthState,
      firstEventLatencyMs: this.#computeLatencyStats(firstEventLatencies),
      heartbeatGapMs: this.#computeLatencyStats(heartbeatGaps),
      replaySummary:
        replayRequests > 0
          ? {
              requestCount: replayRequests,
              successCount: replaySuccesses,
              failureCount: replayFailures,
              resetCount: replayResets,
            }
          : null,
      resetCount,
      terminalDeliveryCount: terminalDeliveries,
      activeSessionCount: activeSessionGauge ?? 0,
      cleanupSummary:
        cleanupTotal > 0
          ? { totalCount: cleanupTotal, timeoutCount: cleanupTimeouts, orphanCount: orphancount }
          : null,
      alerts: alertStates,
    }
  }

  #extractDurations(
    snapshot: MetricsSnapshot,
    metricName: string,
    streamKind: StreamKind,
  ): number[] {
    const keys = Object.keys(snapshot.durations).filter(
      (k) => k.startsWith(metricName) && k.includes(`streamKind=${streamKind}`),
    )
    const latencies: number[] = []
    for (const key of keys) {
      const vals = snapshot.durations[key]
      if (vals) latencies.push(...vals)
    }
    return latencies
  }

  #computeLatencyStats(values: number[]): LatencyStats | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    return {
      avgMs: Math.round(sum / sorted.length),
      p50Ms: this.#percentile(sorted, 0.5),
      p95Ms: this.#percentile(sorted, 0.95),
      maxMs: sorted[sorted.length - 1] ?? 0,
      sampleCount: sorted.length,
    }
  }

  #percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil(p * sorted.length) - 1
    return sorted[Math.max(0, index)] ?? 0
  }

  #computeAlertStates(
    diags: import('@aiproj/types/streaming-observability').DiagnosticEvent[],
  ): AlertState[] {
    const alertMap = new Map<string, AlertState>()

    for (const d of diags) {
      if (d.outcome !== 'success' && d.outcome !== 'skipped') {
        const existing = alertMap.get(d.reasonCode)
        if (existing) {
          existing.count++
          existing.lastTriggeredAt = d.timestamp
        } else {
          alertMap.set(d.reasonCode, {
            reasonCode: d.reasonCode,
            level: d.outcome === 'failure' ? 'critical' : 'warning',
            message: `${d.operation}: ${d.outcome} (${d.reasonCode})`,
            firstTriggeredAt: d.timestamp,
            lastTriggeredAt: d.timestamp,
            count: 1,
            runbookRef: `#${d.reasonCode.toLowerCase()}`,
          })
        }
      }
    }

    return Array.from(alertMap.values()).slice(0, 20)
  }

  #computeHealthState(alerts: AlertState[]): HealthState {
    if (alerts.some((a) => a.level === 'critical')) return 'critical'
    if (alerts.length > 0) return 'warning'
    return 'healthy'
  }
}
