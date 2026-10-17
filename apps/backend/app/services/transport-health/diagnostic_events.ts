/**
 * @aiproj/backend —— 低敏诊断事件服务（tasks 5.1–5.6）。
 *
 * 提供诊断事件的创建、序列化、安全过滤功能。
 * 诊断事件只包含低敏结构化字段，不含业务 payload、stack trace、token 等。
 *
 * @aiproj/backend
 */

import {
  type DiagnosticEvent,
  type StreamKind,
  type Transport,
  type Operation,
  type Outcome,
  type ReasonCode,
  DIAGNOSTIC_FORBIDDEN_FIELDS,
  toDurationBucketMs,
} from '@aiproj/types/streaming-observability'

// ── 诊断事件创建 ──

export interface DiagnosticEventOptions {
  streamKind: StreamKind
  transport: Transport
  operation: Operation
  outcome: Outcome
  reasonCode: ReasonCode
  correlationId: string
  durationMs?: number
  safeCount?: number
  errorCode?: string
  occurredAt?: string
}

/**
 * 创建低敏诊断事件。
 * 自动将 durationMs 转换为标准桶，并确保所有字段均通过 allowlist。
 */
export function createDiagnosticEvent(options: DiagnosticEventOptions): DiagnosticEvent {
  const event: DiagnosticEvent = {
    timestamp: options.occurredAt ?? new Date().toISOString(),
    streamKind: options.streamKind,
    transport: options.transport,
    correlationId: options.correlationId,
    operation: options.operation,
    outcome: options.outcome,
    reasonCode: options.reasonCode,
    durationBucketMs:
      options.durationMs !== undefined ? toDurationBucketMs(options.durationMs) : undefined,
    safeCount: options.safeCount,
    errorCode: options.errorCode,
  }
  return event
}

// ── 诊断序列化安全守卫 ──

/**
 * 序列化诊断事件，确保只输出 allowlist 中的字段。
 * 禁止输出完整 metadata 对象、prompt、output、token 等。
 */
export function serializeDiagnosticEvent(event: DiagnosticEvent): Record<string, unknown> {
  const allowed: Record<string, unknown> = {
    timestamp: event.timestamp,
    streamKind: event.streamKind,
    transport: event.transport,
    correlationId: event.correlationId,
    operation: event.operation,
    outcome: event.outcome,
    reasonCode: event.reasonCode,
  }

  if (event.durationBucketMs !== undefined) {
    allowed.durationBucketMs = event.durationBucketMs
  }
  if (event.safeCount !== undefined) {
    allowed.safeCount = event.safeCount
  }
  if (event.errorCode !== undefined) {
    allowed.errorCode = event.errorCode
  }

  return allowed
}

/**
 * 检查任意对象中是否含有诊断禁止字段。
 * 用于 serializer 防御性检查。
 */
export function containsForbiddenDiagnosticFields(
  obj: Record<string, unknown>,
  depth = 0,
): { found: boolean; keyPath?: string } {
  if (depth > 3) return { found: false }

  for (const key of Object.keys(obj)) {
    if ((DIAGNOSTIC_FORBIDDEN_FIELDS as readonly string[]).includes(key)) {
      return { found: true, keyPath: key }
    }

    const value = obj[key]
    if (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const nested = containsForbiddenDiagnosticFields(value as Record<string, unknown>, depth + 1)
      if (nested.found) {
        return { found: true, keyPath: `${key}.${nested.keyPath}` }
      }
    }
  }

  return { found: false }
}

/**
 * 生成稳定的 correlationId。
 * 格式：`{prefix}_{timestamp}_{counter}`。
 */
let correlationCounter = 0

export function generateCorrelationId(prefix: string): string {
  correlationCounter++
  const ts = Date.now().toString(36)
  return `${prefix}_${ts}_${correlationCounter.toString(36)}`
}

/**
 * 重置 correlationId 计数器（用于测试）。
 */
export function resetCorrelationCounter(): void {
  correlationCounter = 0
}
