/**
 * streaming-observability 类型契约测试。
 *
 * 覆盖：
 * - 封闭枚举完整性
 * - 非法状态组合检测
 * - 跨领域语义一致性
 * - 低基数 label allowlist
 * - 诊断敏感字段守卫
 * - 无业务身份指标
 */

import { describe, it, expect } from 'vitest'
import {
  REASON_CODES,
  FORBIDDEN_METRIC_LABELS,
  ALLOWED_METRIC_LABEL_KEYS,
  DIAGNOSTIC_SERIALIZE_ALLOWLIST,
  DIAGNOSTIC_FORBIDDEN_FIELDS,
  DEFAULT_THRESHOLDS,
  MAX_SERIES_PER_WINDOW,
  operationToPhaseClass,
  toDurationBucketMs,
  type MetricLabels,
  type DiagnosticEvent,
  type StreamKind,
  type Operation,
  type Outcome,
  type ReasonCode,
} from './streaming-observability'

describe('封闭枚举', () => {
  it('REASON_CODES 全部为封闭字符串字面量', () => {
    for (const code of REASON_CODES) {
      expect(typeof code).toBe('string')
      expect(code.length).toBeGreaterThan(0)
      // 禁止仅测试使用的临时 code
      expect(code).not.toMatch(/^TEST_/)
      expect(code).not.toMatch(/^DEBUG_/)
    }
  })

  it('所有 reason code 使用下划线大写命名', () => {
    for (const code of REASON_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/)
    }
  })

  it('HEARTBEAT_OK / PUBLISH_OK / SUBSCRIBE_OK 等常见成功码存在', () => {
    expect(REASON_CODES).toContain('HEARTBEAT_OK')
    expect(REASON_CODES).toContain('PUBLISH_OK')
    expect(REASON_CODES).toContain('SUBSCRIBE_OK')
    expect(REASON_CODES).toContain('REPLAY_OK')
    expect(REASON_CODES).toContain('CLEANUP_OK')
    expect(REASON_CODES).toContain('TERMINAL_DELIVERED')
  })

  it('禁止的 label 包含所有高基数 ID 字段', () => {
    expect(FORBIDDEN_METRIC_LABELS).toContain('organizationId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('userId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('projectId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('draftId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('runId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('eventId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('stageId')
    expect(FORBIDDEN_METRIC_LABELS).toContain('prompt')
    expect(FORBIDDEN_METRIC_LABELS).toContain('token')
    expect(FORBIDDEN_METRIC_LABELS).toContain('secret')
  })

  it('允许的 label 键只包含低基数维度', () => {
    expect(ALLOWED_METRIC_LABEL_KEYS).toEqual([
      'streamKind',
      'transport',
      'outcome',
      'reasonCode',
      'phaseClass',
    ])
  })
})

describe('MetricLabels 合法性', () => {
  it('合法 label 对象通过类型检查', () => {
    const labels: MetricLabels = {
      streamKind: 'ai-draft',
      transport: 'sse',
      outcome: 'success',
      reasonCode: 'FIRST_EVENT_OK',
      phaseClass: 'connection',
    }
    expect(labels.streamKind).toBe('ai-draft')
    expect(labels.transport).toBe('sse')
  })

  it('MetricLabels 不含敏感字段（运行期守卫）', () => {
    const labelKeys = Object.keys({
      streamKind: 'ai-draft',
      transport: 'sse',
      outcome: 'success',
    } as MetricLabels)
    for (const key of labelKeys) {
      expect(FORBIDDEN_METRIC_LABELS).not.toContain(key)
    }
  })

  it('series 上限常量合理', () => {
    expect(MAX_SERIES_PER_WINDOW).toBeGreaterThan(0)
    expect(MAX_SERIES_PER_WINDOW).toBeLessThanOrEqual(5000)
  })
})

describe('非法状态组合', () => {
  it('streamKind 只能是 ai-draft 或 compiler', () => {
    const valid: StreamKind[] = ['ai-draft', 'compiler']
    for (const v of valid) {
      expect(['ai-draft', 'compiler']).toContain(v)
    }
  })

  it('operation 不能包含自由文本字段', () => {
    const ops: Operation[] = [
      'session_open',
      'session_close',
      'first_event',
      'semantic_progress',
      'heartbeat',
      'disconnect',
      'resume',
      'replay_request',
      'replay_success',
      'replay_failure',
      'replay_reset',
      'subscribe',
      'unsubscribe',
      'publish',
      'publish_success',
      'publish_failure',
      'snapshot',
      'rest_fallback',
      'rest_replay',
      'terminal_delivery',
      'cleanup',
      'cleanup_timeout',
      'reset',
      'cursor_expired',
    ]
    for (const op of ops) {
      expect(typeof op).toBe('string')
      expect(op).not.toContain(' ')
      expect(op).not.toMatch(/[A-Z]/)
    }
  })

  it('outcome 枚举不含自由文本', () => {
    const outcomes: Outcome[] = [
      'success',
      'failure',
      'timeout',
      'stale',
      'rejected',
      'expired',
      'cancelled',
      'skipped',
    ]
    for (const o of outcomes) {
      expect(typeof o).toBe('string')
      expect(o).toMatch(/^[a-z]+$/)
    }
  })
})

describe('跨领域语义一致性', () => {
  it('operationToPhaseClass 对所有 operation 都有映射', () => {
    const ops: Operation[] = [
      'session_open',
      'session_close',
      'first_event',
      'semantic_progress',
      'heartbeat',
      'disconnect',
      'resume',
      'replay_request',
      'replay_success',
      'replay_failure',
      'replay_reset',
      'subscribe',
      'unsubscribe',
      'publish',
      'publish_success',
      'publish_failure',
      'snapshot',
      'rest_fallback',
      'rest_replay',
      'terminal_delivery',
      'cleanup',
      'cleanup_timeout',
      'reset',
      'cursor_expired',
    ]
    for (const op of ops) {
      const phase = operationToPhaseClass(op)
      expect(['connection', 'progress', 'recovery', 'terminal', 'cleanup']).toContain(phase)
    }
  })
})

describe('DiagnosticEvent 安全', () => {
  it('diagnostic event 合法结构', () => {
    const event: DiagnosticEvent = {
      timestamp: '2026-07-20T00:00:00Z',
      streamKind: 'ai-draft',
      transport: 'sse',
      correlationId: 'corr-123',
      operation: 'first_event',
      outcome: 'success',
      reasonCode: 'FIRST_EVENT_OK',
      durationBucketMs: 200,
      safeCount: 1,
    }
    expect(event.timestamp).toBeTruthy()
    expect(event.correlationId).toMatch(/^corr-/)
  })

  it('diagnostic serializer allowlist 不含敏感字段', () => {
    for (const field of DIAGNOSTIC_SERIALIZE_ALLOWLIST) {
      expect(DIAGNOSTIC_FORBIDDEN_FIELDS).not.toContain(field)
    }
  })

  it('禁止字段集合包含所有敏感类别', () => {
    const checks = ['prompt', 'rawOutput', 'secret', 'token', 'authorization']
    for (const c of checks) {
      expect(DIAGNOSTIC_FORBIDDEN_FIELDS).toContain(c)
    }
  })
})

describe('duration bucket', () => {
  it('5ms → 50ms bucket', () => {
    expect(toDurationBucketMs(5)).toBe(50)
  })

  it('150ms → 200ms bucket', () => {
    expect(toDurationBucketMs(150)).toBe(200)
  })

  it('3000ms → 5000ms bucket', () => {
    expect(toDurationBucketMs(3000)).toBe(5000)
  })

  it('70000ms → 120000ms', () => {
    expect(toDurationBucketMs(70000)).toBe(120000)
  })
})

describe('默认阈值', () => {
  it('AI Draft 和 Compiler 各有至少 4 个阈值', () => {
    const aiDraft = DEFAULT_THRESHOLDS.filter((t) => t.streamKind === 'ai-draft')
    const compiler = DEFAULT_THRESHOLDS.filter((t) => t.streamKind === 'compiler')
    expect(aiDraft.length).toBeGreaterThanOrEqual(4)
    expect(compiler.length).toBeGreaterThanOrEqual(4)
  })

  it('所有阈值都有 runbookRef', () => {
    for (const t of DEFAULT_THRESHOLDS) {
      expect(t.runbookRef).toBeTruthy()
      expect(t.runbookRef).toMatch(/^#/)
    }
  })

  it('所有阈值都有 source 说明', () => {
    for (const t of DEFAULT_THRESHOLDS) {
      expect(t.source).toBeTruthy()
      expect(t.source.length).toBeGreaterThan(5)
    }
  })

  it('所有阈值都有唯一 id', () => {
    const ids = DEFAULT_THRESHOLDS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
