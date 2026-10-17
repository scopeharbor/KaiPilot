/**
 * v3-otel-genai-export-adapter —— 共享契约测试。
 *
 * §2.3 覆盖每一列映射到预期的标准属性名。
 * §2.5 证明无任何本仓库自造维度出现在标准命名空间下。
 * §2.7 证明标准约定中 opt-in 的消息内容属性从不被启用。
 * §2.8 证明 token 值、secret、被拒资源标识与注入原文不出现在载荷中。
 * §6.2 证明载荷中无指标类型条目。
 * §6.4 证明账本仍是唯一事实来源（导出不产生第二份可查记录）。
 */

import { describe, it, expect } from 'vitest'

import {
  LEDGER_TO_GENAI_ATTRIBUTE_MAP,
  LEDGER_LOCAL_EXTENSION_COLUMNS,
  OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES,
  OTel_EXPORT_FORBIDDEN_METRIC_TYPES,
  OTel_EXPORT_SENSITIVE_SAMPLES,
  mapLedgerAttemptToOtelAttributes,
  mapTraceSpanToOtelAttributes,
  mapEvaluationToOtelAttributes,
  detectExportViolations,
  detectNamespaceViolations,
  localColumnToOtelAttribute,
  isOTelExportAuthStatus,
  isOTelExportTargetType,
} from './otel-genai-export-adapter.js'

import {
  orgALedgerAttemptFixture,
  orgBLedgerAttemptFixture,
  orgATraceSpanFixture,
  orgBTraceSpanFixture,
  orgAEvaluationRecordFixture,
  OTel_FIXTURE_ORG_A,
  OTel_FIXTURE_ORG_B,
} from './otel-genai-export-adapter-fixtures.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §2.3 每一列映射到预期的标准属性名
// ═══════════════════════════════════════════════════════════════════════════════

describe('§2.3 ledger columns map to standard GenAI attributes', () => {
  const attempt = orgALedgerAttemptFixture()
  const attrs = mapLedgerAttemptToOtelAttributes(attempt)

  for (const [ledgerCol, expectedOtelAttr] of Object.entries(LEDGER_TO_GENAI_ATTRIBUTE_MAP)) {
    it(`maps ${ledgerCol} → ${expectedOtelAttr}`, () => {
      const value = (attempt as unknown as Record<string, unknown>)[ledgerCol]
      if (value !== undefined && value !== null) {
        expect(attrs[expectedOtelAttr]).toBe(value)
      }
    })
  }

  it('standard attributes are present in output', () => {
    expect(attrs['gen_ai.operation.name']).toBeDefined()
    expect(attrs['gen_ai.provider.name']).toBeDefined()
    expect(attrs['gen_ai.request.model']).toBeDefined()
    expect(attrs['gen_ai.usage.input_tokens']).toBeDefined()
    expect(attrs['gen_ai.usage.output_tokens']).toBeDefined()
    expect(attrs['gen_ai.duration_ms']).toBeDefined()
    expect(attrs['gen_ai.status']).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2.4 本地扩展一律加本地前缀
// ═══════════════════════════════════════════════════════════════════════════════

describe('§2.4 local extensions use local prefix', () => {
  it('localColumnToOtelAttribute converts correctly', () => {
    expect(localColumnToOtelAttribute('aiproj_organization_id')).toBe('aiproj.organization.id')
    expect(localColumnToOtelAttribute('aiproj_project_id')).toBe('aiproj.project.id')
    expect(localColumnToOtelAttribute('aiproj_capability')).toBe('aiproj.capability')
    expect(localColumnToOtelAttribute('aiproj_estimated_cost')).toBe('aiproj.estimated.cost')
    expect(localColumnToOtelAttribute('aiproj_prompt_version')).toBe('aiproj.prompt.version')
  })

  it('non-prefixed columns pass through', () => {
    expect(localColumnToOtelAttribute('operation_name')).toBe('operation_name')
  })

  it('all local extensions appear under aiproj.* namespace', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)

    for (const col of LEDGER_LOCAL_EXTENSION_COLUMNS) {
      const value = (attempt as unknown as Record<string, unknown>)[col]
      if (value !== undefined && value !== null) {
        const otelAttr = localColumnToOtelAttribute(col)
        expect(otelAttr.startsWith('aiproj.')).toBe(true)
        expect(attrs[otelAttr]).toBe(value)
      }
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2.5 无任何本仓库自造维度出现在标准命名空间下
// ═══════════════════════════════════════════════════════════════════════════════

describe('§2.5 no local dimension appears under standard namespace', () => {
  it('ledger attempt output has no namespace violations', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)
    expect(detectNamespaceViolations(attrs)).toEqual([])
  })

  it('trace span output has no namespace violations', () => {
    const span = orgATraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)
    expect(detectNamespaceViolations(attrs)).toEqual([])
  })

  it('evaluation output has no namespace violations', () => {
    const record = orgAEvaluationRecordFixture()
    const attrs = mapEvaluationToOtelAttributes(record)
    expect(detectNamespaceViolations(attrs)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2.7 opt-in 的消息内容属性从不被启用
// ═══════════════════════════════════════════════════════════════════════════════

describe('§2.7 opt-in content attributes are never enabled', () => {
  it('ledger mapping never produces forbidden content attributes', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)

    for (const forbidden of OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES) {
      expect(forbidden in attrs).toBe(false)
    }
  })

  it('trace mapping never produces forbidden content attributes', () => {
    const span = orgATraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)

    for (const forbidden of OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES) {
      expect(forbidden in attrs).toBe(false)
    }
  })

  it('evaluation mapping never produces forbidden content attributes', () => {
    const record = orgAEvaluationRecordFixture()
    const attrs = mapEvaluationToOtelAttributes(record)

    for (const forbidden of OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES) {
      expect(forbidden in attrs).toBe(false)
    }
  })

  it('LEDGER_TO_GENAI_ATTRIBUTE_MAP contains no content attributes', () => {
    for (const otelAttr of Object.values(LEDGER_TO_GENAI_ATTRIBUTE_MAP)) {
      expect(OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES.has(otelAttr)).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §2.8 token/secret/denied/injection 不出现在载荷中
// ═══════════════════════════════════════════════════════════════════════════════

describe('§2.8 sensitive samples are absent from payloads', () => {
  it('ledger payload contains no sensitive samples', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)
    const violations = detectExportViolations(attrs)
    const sensitiveViolations = violations.filter((v) => v.startsWith('sensitive_sample:'))
    expect(sensitiveViolations).toEqual([])
  })

  it('trace payload contains no sensitive samples', () => {
    const span = orgATraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)
    const violations = detectExportViolations(attrs)
    const sensitiveViolations = violations.filter((v) => v.startsWith('sensitive_sample:'))
    expect(sensitiveViolations).toEqual([])
  })

  it('evaluation payload contains no sensitive samples', () => {
    const record = orgAEvaluationRecordFixture()
    const attrs = mapEvaluationToOtelAttributes(record)
    const violations = detectExportViolations(attrs)
    const sensitiveViolations = violations.filter((v) => v.startsWith('sensitive_sample:'))
    expect(sensitiveViolations).toEqual([])
  })

  it('detectExportViolations catches sensitive values injected into attributes', () => {
    const maliciousAttrs: Record<string, unknown> = {
      'gen_ai.operation.name': 'chat',
      some_field: OTel_EXPORT_SENSITIVE_SAMPLES.tokenValue,
    }
    const violations = detectExportViolations(maliciousAttrs)
    expect(violations.some((v) => v.includes('sensitive_sample:tokenValue'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.2 载荷中无指标类型条目
// ═══════════════════════════════════════════════════════════════════════════════

describe('§6.2 payloads contain no metric entries', () => {
  it('ledger mapping produces no metric types', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)

    for (const metric of OTel_EXPORT_FORBIDDEN_METRIC_TYPES) {
      expect(metric in attrs).toBe(false)
    }
  })

  it('detectExportViolations catches metric entries', () => {
    const attrs: Record<string, unknown> = {
      'gen_ai.client.token.usage': 100,
    }
    const violations = detectExportViolations(attrs)
    expect(violations.some((v) => v.startsWith('forbidden_metric:'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.4 账本仍是唯一事实来源
// ═══════════════════════════════════════════════════════════════════════════════

describe('§6.4 ledger remains single source of truth', () => {
  it('mapping produces a flat attribute record, not a separate record set', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)

    expect(typeof attrs).toBe('object')
    expect(Array.isArray(attrs)).toBe(false)
    expect('records' in attrs).toBe(false)
    expect('events' in attrs).toBe(false)
    expect('logs' in attrs).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 追踪 span 映射
// ═══════════════════════════════════════════════════════════════════════════════

describe('trace span mapping', () => {
  it('maps standard span fields correctly', () => {
    const span = orgATraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)

    expect(attrs['span_id']).toBe('span-fixture-001')
    expect(attrs['trace_id']).toBe('trace-fixture-001')
    expect(attrs['gen_ai.operation.name']).toBe('chat')
    expect(attrs['gen_ai.span.status']).toBe('ok')
    expect(attrs['gen_ai.duration_ms']).toBe(1000)
    expect(attrs['gen_ai.usage.input_tokens']).toBe(500)
    expect(attrs['gen_ai.usage.output_tokens']).toBe(200)
  })

  it('maps local extension fields to aiproj.* namespace', () => {
    const span = orgATraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)

    expect(attrs['aiproj.organization.id']).toBe(OTel_FIXTURE_ORG_A)
    expect(attrs['aiproj.span.is_orphan']).toBe(false)
    expect(attrs['aiproj.span.on_critical_path']).toBe(true)
  })

  it('omits null/undefined values', () => {
    const span = orgATraceSpanFixture({ parent_span_id: null, error_kind: null })
    const attrs = mapTraceSpanToOtelAttributes(span)

    // null values are omitted
    expect(attrs['parent_span_id']).toBeUndefined()
    expect(attrs['gen_ai.error.kind']).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 评测记录映射
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluation record mapping', () => {
  it('maps evaluation fields correctly', () => {
    const record = orgAEvaluationRecordFixture()
    const attrs = mapEvaluationToOtelAttributes(record)

    expect(attrs['gen_ai.evaluation.name']).toBe('draft_structural_compliance')
    expect(attrs['gen_ai.evaluation.score.value']).toBe(1)
    expect(attrs['gen_ai.evaluation.score.label']).toBe('pass')
    expect(attrs['gen_ai.evaluation.evaluator.kind']).toBe('deterministic')
    expect(attrs['gen_ai.evaluation.evaluator.name']).toBe('draft_structural_compliance')
    expect(attrs['gen_ai.evaluation.idempotency_key']).toBe('eval-ik-fixture-001')
    expect(attrs['aiproj.organization.id']).toBe(OTel_FIXTURE_ORG_A)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 组织隔离
// ═══════════════════════════════════════════════════════════════════════════════

describe('organization isolation', () => {
  it('org A attempt maps to org A attributes only', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)

    expect(attrs['aiproj.organization.id']).toBe(OTel_FIXTURE_ORG_A)
    expect(attrs['aiproj.organization.id']).not.toBe(OTel_FIXTURE_ORG_B)
  })

  it('org B attempt maps to org B attributes only', () => {
    const attempt = orgBLedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)

    expect(attrs['aiproj.organization.id']).toBe(OTel_FIXTURE_ORG_B)
    expect(attrs['aiproj.organization.id']).not.toBe(OTel_FIXTURE_ORG_A)
  })

  it('org A trace span maps to org A attributes only', () => {
    const span = orgATraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)

    expect(attrs['aiproj.organization.id']).toBe(OTel_FIXTURE_ORG_A)
  })

  it('org B trace span maps to org B attributes only', () => {
    const span = orgBTraceSpanFixture()
    const attrs = mapTraceSpanToOtelAttributes(span)

    expect(attrs['aiproj.organization.id']).toBe(OTel_FIXTURE_ORG_B)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 类型守卫
// ═══════════════════════════════════════════════════════════════════════════════

describe('type guards', () => {
  it('isOTelExportAuthStatus validates correctly', () => {
    expect(isOTelExportAuthStatus('unauthorized')).toBe(true)
    expect(isOTelExportAuthStatus('authorized')).toBe(true)
    expect(isOTelExportAuthStatus('invalid')).toBe(false)
    expect(isOTelExportAuthStatus('')).toBe(false)
  })

  it('isOTelExportTargetType validates correctly', () => {
    expect(isOTelExportTargetType('otlp_http')).toBe(true)
    expect(isOTelExportTargetType('otlp_grpc')).toBe(true)
    expect(isOTelExportTargetType('console')).toBe(true)
    expect(isOTelExportTargetType('invalid')).toBe(false)
  })
})
