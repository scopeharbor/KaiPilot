/**
 * @aiproj/backend —— Transport-health metrics port（tasks 2.1–2.7）。
 *
 * 定义 MetricsPort 接口与三个实现：
 * - MemoryMetricsSink：进程内聚合，用于健康摘要
 * - NoopMetricsSink：完全关闭观测
 * - TestMetricsSink：确定性测试 sink
 *
 * 所有实现都遵守低基数 label 约束。
 * 禁止 organizationId/userId/draftId/runId 等作为 label 键。
 *
 * @aiproj/backend
 */

import {
  type DiagnosticEvent,
  FORBIDDEN_METRIC_LABELS,
  ALLOWED_METRIC_LABEL_KEYS,
  MAX_SERIES_PER_WINDOW,
  type StreamKind,
  type Transport,
  type Outcome,
} from '@aiproj/types/streaming-observability'
import type {
  MetricLabels,
  MetricsPort,
  MetricsSnapshot,
} from '@aiproj/types/streaming-observability'

// ── Helpers ──

/** 安全地将 MetricLabels 的指定键值提取为 Record。 */
function labelsToRecord(labels: MetricLabels): Record<string, unknown> {
  return { ...labels } as unknown as Record<string, unknown>
}

/** 将 MetricLabels 序列化为 series key，用于计数器/duration/gauge 存储。 */
function seriesKey(name: string, labels: MetricLabels): string {
  const parts = [name]
  const record = labelsToRecord(labels)
  for (const key of ALLOWED_METRIC_LABEL_KEYS) {
    const val = record[key]
    if (val !== undefined && val !== null) {
      parts.push(`${key}=${String(val)}`)
    }
  }
  return parts.join('|')
}

/** 检查 labels 中是否含有禁止字段。返回第一个发现的禁止键名。 */
function findForbiddenLabel(labels: Record<string, unknown>): string | null {
  for (const key of Object.keys(labels)) {
    if ((FORBIDDEN_METRIC_LABELS as readonly string[]).includes(key)) {
      return key
    }
  }
  return null
}

// ── Instrumentation Error ──

export class InstrumentationError extends Error {
  readonly code: string = 'INSTRUMENTATION_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'InstrumentationError'
  }
}

// ── No-op Sink ──

export class NoopMetricsSink implements MetricsPort {
  readonly sinkType = 'noop' as const

  incrementCounter(_name: string, _labels: MetricLabels, _value?: number): void {
    // no-op
  }

  recordDuration(_name: string, _labels: MetricLabels, _durationMs: number): void {
    // no-op
  }

  setGauge(_name: string, _labels: MetricLabels, _value: number): void {
    // no-op
  }

  recordDiagnostic(_event: DiagnosticEvent): void {
    // no-op
  }

  snapshot(): MetricsSnapshot {
    return { counters: {}, durations: {}, gauges: {}, diagnostics: [], seriesCount: 0 }
  }

  reset(): void {
    // no-op
  }
}

// ── Memory Sink（生产默认） ──

export interface MemorySinkOptions {
  /** 当检测到禁止 label 时的行为，默认 'warn'。 */
  onForbiddenLabel?: 'warn' | 'error' | 'strip'
  /** 是否记录诊断事件，默认 true。 */
  recordDiagnostics?: boolean
  /** 最大诊断事件数，默认 1000。 */
  maxDiagnostics?: number
}

export class MemoryMetricsSink implements MetricsPort {
  readonly sinkType = 'memory' as const

  readonly #counters = new Map<string, number>()
  readonly #durations = new Map<string, number[]>()
  readonly #gauges = new Map<string, number>()
  readonly #diagnostics: DiagnosticEvent[] = []
  readonly #options: Required<MemorySinkOptions>

  constructor(options?: MemorySinkOptions) {
    this.#options = {
      onForbiddenLabel: options?.onForbiddenLabel ?? 'warn',
      recordDiagnostics: options?.recordDiagnostics ?? true,
      maxDiagnostics: options?.maxDiagnostics ?? 1000,
    }
  }

  #sanitizeLabels(labels: MetricLabels): MetricLabels {
    const asRecord = labelsToRecord(labels)
    const forbidden = findForbiddenLabel(asRecord)
    if (forbidden) {
      const msg = `Forbidden metric label: ${forbidden}`
      if (this.#options.onForbiddenLabel === 'error') {
        throw new InstrumentationError(msg)
      }
      // strip: remove the forbidden key
      if (this.#options.onForbiddenLabel === 'strip') {
        const { [forbidden]: forbiddenValue, ...rest } = asRecord
        void forbiddenValue
        return rest as unknown as MetricLabels
      }
      // warn: log but still include
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`[MetricsSink] ${msg}`)
      }
    }
    return labels
  }

  #trackSeries(): void {
    const totalSeries =
      this.#counters.size + this.#durations.size + this.#gauges.size + this.#diagnostics.length
    if (totalSeries > MAX_SERIES_PER_WINDOW && this.#options.onForbiddenLabel !== 'strip') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          `[MetricsSink] Series count ${totalSeries} exceeds MAX_SERIES_PER_WINDOW (${MAX_SERIES_PER_WINDOW})`,
        )
      }
    }
  }

  incrementCounter(name: string, labels: MetricLabels, value = 1): void {
    const safeLabels = this.#sanitizeLabels(labels)
    const key = seriesKey(name, safeLabels)
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + value)
    this.#trackSeries()
  }

  recordDuration(name: string, labels: MetricLabels, durationMs: number): void {
    const safeLabels = this.#sanitizeLabels(labels)
    const key = seriesKey(name, safeLabels)
    const existing = this.#durations.get(key) ?? []
    existing.push(durationMs)
    // 限制每个 series 的样本数，防止无限增长
    if (existing.length > 10000) {
      existing.shift()
    }
    this.#durations.set(key, existing)
    this.#trackSeries()
  }

  setGauge(name: string, labels: MetricLabels, value: number): void {
    const safeLabels = this.#sanitizeLabels(labels)
    const key = seriesKey(name, safeLabels)
    this.#gauges.set(key, value)
    this.#trackSeries()
  }

  recordDiagnostic(event: DiagnosticEvent): void {
    if (!this.#options.recordDiagnostics) return
    if (this.#diagnostics.length >= this.#options.maxDiagnostics) {
      this.#diagnostics.shift()
    }
    this.#diagnostics.push(event)
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.#counters),
      durations: Object.fromEntries(this.#durations),
      gauges: Object.fromEntries(this.#gauges),
      diagnostics: [...this.#diagnostics],
      seriesCount: this.#counters.size + this.#durations.size + this.#gauges.size,
    }
  }

  reset(): void {
    this.#counters.clear()
    this.#durations.clear()
    this.#gauges.clear()
    this.#diagnostics.length = 0
  }
}

// ── Test Sink（确定性模拟） ──

export interface TestSinkRecord {
  type: 'counter' | 'duration' | 'gauge' | 'diagnostic'
  name?: string
  labels?: MetricLabels
  value?: number
  durationMs?: number
  diagnostic?: DiagnosticEvent
  timestamp: number
}

export class TestMetricsSink implements MetricsPort {
  readonly sinkType = 'test' as const
  readonly records: TestSinkRecord[] = []

  incrementCounter(name: string, labels: MetricLabels, value = 1): void {
    this.records.push({ type: 'counter', name, labels, value, timestamp: Date.now() })
  }

  recordDuration(name: string, labels: MetricLabels, durationMs: number): void {
    this.records.push({ type: 'duration', name, labels, durationMs, timestamp: Date.now() })
  }

  setGauge(name: string, labels: MetricLabels, value: number): void {
    this.records.push({ type: 'gauge', name, labels, value, timestamp: Date.now() })
  }

  recordDiagnostic(event: DiagnosticEvent): void {
    this.records.push({ type: 'diagnostic', diagnostic: event, timestamp: Date.now() })
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: {},
      durations: {},
      gauges: {},
      diagnostics: this.records.filter((r) => r.type === 'diagnostic').map((r) => r.diagnostic!),
      seriesCount: new Set(this.records.map((r) => r.name)).size,
    }
  }

  reset(): void {
    this.records.length = 0
  }

  /** 按 type 过滤记录。 */
  findByType(type: TestSinkRecord['type']): TestSinkRecord[] {
    return this.records.filter((r) => r.type === type)
  }

  /** 按 name 和 labels 查找 counter 记录的值总和。 */
  counterTotal(name: string, labels?: Partial<MetricLabels>): number {
    let matching = this.records.filter((r) => r.type === 'counter' && r.name === name)
    if (labels) {
      matching = matching.filter((r) => {
        if (!r.labels) return false
        const rLabels = r.labels as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(labels)) {
          if (rLabels[k] !== v) return false
        }
        return true
      })
    }
    return matching.reduce((sum, r) => sum + (r.value ?? 1), 0)
  }

  /** 按 name 和 labels 查找 duration 记录。 */
  findDurations(name: string, labels?: Partial<MetricLabels>): number[] {
    let matching = this.records.filter((r) => r.type === 'duration' && r.name === name)
    if (labels) {
      matching = matching.filter((r) => {
        if (!r.labels) return false
        const rLabels = r.labels as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(labels)) {
          if (rLabels[k] !== v) return false
        }
        return true
      })
    }
    return matching.map((r) => r.durationMs!)
  }

  /** 清除记录。 */
  clear(): void {
    this.records.length = 0
  }
}

// ── 共享便利函数 ──

/** 创建默认的 metric labels。 */
export function makeLabels(
  streamKind: StreamKind,
  transport: Transport,
  outcome: Outcome,
  overrides?: Partial<MetricLabels>,
): MetricLabels {
  return {
    streamKind,
    transport,
    outcome,
    ...overrides,
  }
}
