// @aiproj/types — V3 AI 安全观测共享契约测试
//
// 覆盖：五类事件类型、严重度枚举一致、禁存约束、不记资源标识、不记注入原文、
// 聚合确定性、降级计数、不自动处置。
import { describe, it, expect } from 'vitest'

import {
  AI_SECURITY_EVENT_KINDS,
  AI_SECURITY_DISPOSITIONS,
  AI_SECURITY_CAPABILITY_SURFACES,
  isAiSecurityEventKind,
  isAiSecurityDisposition,
  isAiSecurityCapabilitySurface,
  validateEventRecordNoSensitivePayloads,
  validateEventNoResourceIdentifier,
  validateEventNoInjectionPayload,
  computeAggregateKeyString,
  buildAggregateResult,
  createEmptyDegradationCounter,
  incrementDegradationCounter,
  validateNoAutomaticEnforcement,
  type AiSecurityEventRecord,
  type AiSecurityEventSeverity,
} from './ai-security-observability.js'
import type { AuditLogSeverity } from './audit-log.js'
import {
  ALL_KIND_FIXTURES,
  ALL_FIXTURES_WITH_DEGRADED,
  FIXTURE_PERMISSION_DENIED_EVENT,
  FIXTURE_DLP_HIT_EVENT,
  FIXTURE_WATERMARK_INJECTION_EVENT,
  FIXTURE_INJECTION_BLOCK_EVENT,
  FIXTURE_CROSS_ORG_PROBE_EVENT,
  FIXTURE_DEGRADED_EVENT,
  FIXTURE_AGGREGATE_KEY,
  FIXTURE_EMPTY_DEGRADATION_COUNTER,
  FIXTURE_DEGRADATION_COUNTER_WITH_HITS,
  AI_SECURITY_SENSITIVE_SAMPLES,
  RESOURCE_IDENTIFIER_SAMPLES,
  INJECTION_PAYLOAD_SAMPLES,
} from './ai-security-observability-fixtures.js'

// =============================================================================
// §1 事件类型枚举
// =============================================================================

describe('AI security event kinds', () => {
  it('covers exactly five kinds', () => {
    expect(AI_SECURITY_EVENT_KINDS).toHaveLength(5)
    expect(AI_SECURITY_EVENT_KINDS).toEqual([
      'permission_denied',
      'dlp_hit',
      'watermark_injection',
      'injection_block',
      'cross_org_probe',
    ])
  })

  it('type guard accepts valid kinds', () => {
    expect(isAiSecurityEventKind('permission_denied')).toBe(true)
    expect(isAiSecurityEventKind('dlp_hit')).toBe(true)
    expect(isAiSecurityEventKind('watermark_injection')).toBe(true)
    expect(isAiSecurityEventKind('injection_block')).toBe(true)
    expect(isAiSecurityEventKind('cross_org_probe')).toBe(true)
  })

  it('type guard rejects invalid kinds', () => {
    expect(isAiSecurityEventKind('unknown_kind')).toBe(false)
    expect(isAiSecurityEventKind('')).toBe(false)
    expect(isAiSecurityEventKind('PERMISSION_DENIED')).toBe(false)
  })
})

// =============================================================================
// §2 严重度枚举与审计一致（D6）
// =============================================================================

describe('severity aligns with audit_logs', () => {
  it('AiSecurityEventSeverity is assignable from AuditLogSeverity', () => {
    const sev: AiSecurityEventSeverity = 'info'
    const auditSev: AuditLogSeverity = sev
    expect(auditSev).toBe('info')
  })

  it('each event fixture uses valid audit severity', () => {
    const validSeverities = new Set(['info', 'warning', 'error', 'critical'])
    for (const event of ALL_KIND_FIXTURES) {
      expect(validSeverities.has(event.severity)).toBe(true)
    }
  })
})

// =============================================================================
// §3 处置结果枚举
// =============================================================================

describe('dispositions', () => {
  it('covers exactly two dispositions', () => {
    expect(AI_SECURITY_DISPOSITIONS).toHaveLength(2)
    expect(AI_SECURITY_DISPOSITIONS).toEqual(['blocked', 'flagged'])
  })

  it('type guard accepts valid dispositions', () => {
    expect(isAiSecurityDisposition('blocked')).toBe(true)
    expect(isAiSecurityDisposition('flagged')).toBe(true)
  })

  it('type guard rejects invalid dispositions', () => {
    expect(isAiSecurityDisposition('unknown')).toBe(false)
    expect(isAiSecurityDisposition('')).toBe(false)
  })
})

// =============================================================================
// §4 能力面枚举
// =============================================================================

describe('capability surfaces', () => {
  it('covers expected surfaces', () => {
    expect(AI_SECURITY_CAPABILITY_SURFACES.length).toBeGreaterThanOrEqual(5)
  })

  it('type guard accepts valid surfaces', () => {
    expect(isAiSecurityCapabilitySurface('context_assembly')).toBe(true)
    expect(isAiSecurityCapabilitySurface('provider_call')).toBe(true)
    expect(isAiSecurityCapabilitySurface('knowledge_retrieval')).toBe(true)
    expect(isAiSecurityCapabilitySurface('file_ocr')).toBe(true)
    expect(isAiSecurityCapabilitySurface('report_export')).toBe(true)
    expect(isAiSecurityCapabilitySurface('api_request')).toBe(true)
    expect(isAiSecurityCapabilitySurface('compiler_run')).toBe(true)
  })

  it('type guard rejects invalid surfaces', () => {
    expect(isAiSecurityCapabilitySurface('unknown')).toBe(false)
  })
})

// =============================================================================
// §5 禁存约束：不含 prompt、模型输出、token、secret（通用禁存）
// =============================================================================

describe('no sensitive payloads in event records', () => {
  it('all fixture records pass the sensitive payload check', () => {
    for (const event of ALL_FIXTURES_WITH_DEGRADED) {
      const result = validateEventRecordNoSensitivePayloads(event)
      expect(result.safe).toBe(true)
    }
  })

  it('rejects records with unknown fields', () => {
    const badRecord = {
      ...FIXTURE_PERMISSION_DENIED_EVENT,
      extraField: 'some value',
    }
    const result = validateEventRecordNoSensitivePayloads(badRecord)
    expect(result.safe).toBe(false)
    expect(result.violations.some((v) => v.includes('extraField'))).toBe(true)
  })

  it('rejects records containing prompt patterns', () => {
    const badRecord = {
      ...FIXTURE_DLP_HIT_EVENT,
      dlpRuleCategory: 'System prompt: you are a helpful assistant',
    }
    const result = validateEventRecordNoSensitivePayloads(badRecord)
    expect(result.safe).toBe(false)
  })

  it('rejects records containing token patterns', () => {
    const badRecord = {
      ...FIXTURE_DLP_HIT_EVENT,
      dlpRuleCategory: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234',
    }
    const result = validateEventRecordNoSensitivePayloads(badRecord)
    expect(result.safe).toBe(false)
  })

  it('rejects records containing model output markers', () => {
    const badRecord = {
      ...FIXTURE_DLP_HIT_EVENT,
      dlpRuleCategory: 'im_start system prompt',
    }
    const result = validateEventRecordNoSensitivePayloads(badRecord)
    expect(result.safe).toBe(false)
  })
})

// =============================================================================
// §6 负例测试：敏感样本不出现在任一字段
// =============================================================================

describe('sensitive samples absent from all event fields', () => {
  it('no fixture contains any sensitive sample value', () => {
    for (const event of ALL_FIXTURES_WITH_DEGRADED) {
      const json = JSON.stringify(event)
      for (const sample of AI_SECURITY_SENSITIVE_SAMPLES) {
        expect(json).not.toContain(sample)
      }
    }
  })
})

// =============================================================================
// §7 不成为泄露通道：不记资源标识（D1）
// =============================================================================

describe('events do not identify denied resources (D1)', () => {
  it('permission_denied event has no resource identifier fields', () => {
    const result = validateEventNoResourceIdentifier(FIXTURE_PERMISSION_DENIED_EVENT)
    expect(result.safe).toBe(true)
  })

  it('cross_org_probe event has no resource identifier fields', () => {
    const result = validateEventNoResourceIdentifier(FIXTURE_CROSS_ORG_PROBE_EVENT)
    expect(result.safe).toBe(true)
  })

  it('no fixture contains resource identifier samples', () => {
    for (const event of ALL_FIXTURES_WITH_DEGRADED) {
      const json = JSON.stringify(event)
      for (const sample of RESOURCE_IDENTIFIER_SAMPLES) {
        expect(json).not.toContain(sample)
      }
    }
  })

  it('repeated probing cannot reconstruct invisible resources', () => {
    // 模拟：多个越权事件记录，每个只记「访问了不可访问资源」
    const probingEvents: AiSecurityEventRecord[] = Array.from({ length: 10 }, (_, i) => ({
      eventId: `probe-${i}`,
      kind: 'permission_denied' as const,
      severity: 'warning' as const,
      occurredAt: new Date(Date.now() + i * 1000).toISOString(),
      organizationId: 1,
      capabilitySurface: 'api_request' as const,
      disposition: 'blocked' as const,
    }))

    // 所有事件的 JSON 中都不应包含任何资源标识
    for (const event of probingEvents) {
      const result = validateEventNoResourceIdentifier(event)
      expect(result.safe).toBe(true)
    }

    // 即使合并所有事件，也无法拼出不可见资源清单
    const allJson = JSON.stringify(probingEvents)
    for (const sample of RESOURCE_IDENTIFIER_SAMPLES) {
      expect(allJson).not.toContain(sample)
    }
  })

  it('two actors with one permission difference do not leak resource identity', () => {
    const actor1Event: AiSecurityEventRecord = {
      eventId: 'actor1-probe',
      kind: 'permission_denied',
      severity: 'warning',
      occurredAt: '2026-08-22T10:00:00.000Z',
      organizationId: 1,
      capabilitySurface: 'api_request',
      disposition: 'blocked',
      actorId: 100,
    }
    const actor2Event: AiSecurityEventRecord = {
      eventId: 'actor2-probe',
      kind: 'permission_denied',
      severity: 'warning',
      occurredAt: '2026-08-22T10:00:00.000Z',
      organizationId: 1,
      capabilitySurface: 'api_request',
      disposition: 'blocked',
      actorId: 200,
    }

    expect(validateEventNoResourceIdentifier(actor1Event).safe).toBe(true)
    expect(validateEventNoResourceIdentifier(actor2Event).safe).toBe(true)
  })
})

// =============================================================================
// §8 不成为泄露通道：注入拦截只记类别不记原文（D2）
// =============================================================================

describe('injection blocks record category and count, not text (D2)', () => {
  it('injection event has categories and count, no payload', () => {
    const result = validateEventNoInjectionPayload(FIXTURE_INJECTION_BLOCK_EVENT)
    expect(result.safe).toBe(true)
    expect(FIXTURE_INJECTION_BLOCK_EVENT.injectionCategories!.length).toBeGreaterThan(0)
    expect(FIXTURE_INJECTION_BLOCK_EVENT.injectionHitCount).toBeGreaterThan(0)
  })

  it('no fixture contains injection payload samples', () => {
    for (const event of ALL_FIXTURES_WITH_DEGRADED) {
      const json = JSON.stringify(event)
      for (const sample of INJECTION_PAYLOAD_SAMPLES) {
        expect(json).not.toContain(sample)
      }
    }
  })

  it('records are safe for downstream rendering', () => {
    for (const event of ALL_FIXTURES_WITH_DEGRADED) {
      const result = validateEventNoInjectionPayload(event)
      expect(result.safe).toBe(true)
    }
  })
})

// =============================================================================
// §9 聚合确定性（D7）
// =============================================================================

describe('aggregation is deterministic (D7)', () => {
  it('same event snapshot produces same aggregate key string', () => {
    const key1 = computeAggregateKeyString(FIXTURE_AGGREGATE_KEY)
    const key2 = computeAggregateKeyString(FIXTURE_AGGREGATE_KEY)
    expect(key1).toBe(key2)
  })

  it('different keys produce different strings', () => {
    const key1 = computeAggregateKeyString(FIXTURE_AGGREGATE_KEY)
    const key2 = computeAggregateKeyString({
      ...FIXTURE_AGGREGATE_KEY,
      kind: 'dlp_hit',
    })
    expect(key1).not.toBe(key2)
  })

  it('same events produce same aggregate result', () => {
    const events = [FIXTURE_PERMISSION_DENIED_EVENT]
    const result1 = buildAggregateResult(events, FIXTURE_AGGREGATE_KEY)
    const result2 = buildAggregateResult(events, FIXTURE_AGGREGATE_KEY)
    expect(result1).toEqual(result2)
  })

  it('aggregate result matches fixture', () => {
    const events = [FIXTURE_PERMISSION_DENIED_EVENT]
    const result = buildAggregateResult(events, FIXTURE_AGGREGATE_KEY)
    expect(result.totalCount).toBe(1)
    expect(result.bySeverity.warning).toBe(1)
    expect(result.byDisposition.blocked).toBe(1)
    expect(result.degradedCount).toBe(0)
  })

  it('aggregate counts degraded events', () => {
    const events = [FIXTURE_PERMISSION_DENIED_EVENT, FIXTURE_DEGRADED_EVENT]
    const result = buildAggregateResult(events, FIXTURE_AGGREGATE_KEY)
    expect(result.totalCount).toBe(2)
    expect(result.degradedCount).toBe(1)
  })
})

// =============================================================================
// §10 降级计数（D4）
// =============================================================================

describe('degradation is counted, not silent (D4)', () => {
  it('empty counter has zero totals', () => {
    const counter = createEmptyDegradationCounter()
    expect(counter.totalDegraded).toBe(0)
    expect(counter.lastDegradedAt).toBeNull()
    expect(counter.byKind.permission_denied).toBe(0)
    expect(counter.byKind.dlp_hit).toBe(0)
    expect(counter.byKind.watermark_injection).toBe(0)
    expect(counter.byKind.injection_block).toBe(0)
    expect(counter.byKind.cross_org_probe).toBe(0)
  })

  it('increment adds to counter', () => {
    const counter = incrementDegradationCounter(
      FIXTURE_EMPTY_DEGRADATION_COUNTER,
      'permission_denied',
      '2026-08-22T10:00:00.000Z',
    )
    expect(counter.totalDegraded).toBe(1)
    expect(counter.byKind.permission_denied).toBe(1)
    expect(counter.lastDegradedAt).toBe('2026-08-22T10:00:00.000Z')
  })

  it('multiple increments accumulate correctly', () => {
    let counter = createEmptyDegradationCounter()
    counter = incrementDegradationCounter(counter, 'permission_denied', '2026-08-22T10:00:00.000Z')
    counter = incrementDegradationCounter(counter, 'injection_block', '2026-08-22T10:01:00.000Z')
    counter = incrementDegradationCounter(counter, 'injection_block', '2026-08-22T10:02:00.000Z')
    expect(counter.totalDegraded).toBe(3)
    expect(counter.byKind.permission_denied).toBe(1)
    expect(counter.byKind.injection_block).toBe(2)
    expect(counter.lastDegradedAt).toBe('2026-08-22T10:02:00.000Z')
  })

  it('fixture counter matches expected values', () => {
    expect(FIXTURE_DEGRADATION_COUNTER_WITH_HITS.totalDegraded).toBe(3)
    expect(FIXTURE_DEGRADATION_COUNTER_WITH_HITS.byKind.permission_denied).toBe(1)
    expect(FIXTURE_DEGRADATION_COUNTER_WITH_HITS.byKind.injection_block).toBe(2)
  })
})

// =============================================================================
// §11 不自动处置（D5）
// =============================================================================

describe('no automatic enforcement (D5)', () => {
  it('event path has no enforcement dependencies', () => {
    const result = validateNoAutomaticEnforcement()
    expect(result.safe).toBe(true)
    expect(result.enforcedOperations).toEqual([])
  })
})

// =============================================================================
// §12 Fixtures 覆盖五类事件
// =============================================================================

describe('fixtures cover all five event kinds', () => {
  it('each kind has at least one fixture', () => {
    const coveredKinds = new Set(ALL_KIND_FIXTURES.map((e) => e.kind))
    for (const kind of AI_SECURITY_EVENT_KINDS) {
      expect(coveredKinds.has(kind)).toBe(true)
    }
  })

  it('fixture counts match', () => {
    expect(ALL_KIND_FIXTURES).toHaveLength(5)
    expect(ALL_FIXTURES_WITH_DEGRADED).toHaveLength(6)
  })
})

// =============================================================================
// §13 基本字段结构
// =============================================================================

describe('event record structure', () => {
  it('each fixture has required base fields', () => {
    for (const event of ALL_KIND_FIXTURES) {
      expect(typeof event.eventId === 'string' && event.eventId.length > 0).toBe(true)
      expect(isAiSecurityEventKind(event.kind)).toBe(true)
      expect(typeof event.severity).toBe('string')
      expect(typeof event.occurredAt).toBe('string')
      expect(typeof event.organizationId).toBe('number')
      expect(isAiSecurityCapabilitySurface(event.capabilitySurface)).toBe(true)
      expect(isAiSecurityDisposition(event.disposition)).toBe(true)
    }
  })

  it('permission_denied has no resource identifier', () => {
    const keys = Object.keys(FIXTURE_PERMISSION_DENIED_EVENT)
    expect(keys).not.toContain('resourceId')
    expect(keys).not.toContain('resourceType')
    expect(keys).not.toContain('targetId')
    expect(keys).not.toContain('deniedResource')
  })

  it('injection_block has categories and count', () => {
    expect(Array.isArray(FIXTURE_INJECTION_BLOCK_EVENT.injectionCategories)).toBe(true)
    expect(FIXTURE_INJECTION_BLOCK_EVENT.injectionHitCount).toBeGreaterThan(0)
  })

  it('dlp_hit has rule category', () => {
    expect(typeof FIXTURE_DLP_HIT_EVENT.dlpRuleCategory).toBe('string')
  })

  it('watermark_injection has format', () => {
    expect(typeof FIXTURE_WATERMARK_INJECTION_EVENT.watermarkFormat).toBe('string')
  })
})
