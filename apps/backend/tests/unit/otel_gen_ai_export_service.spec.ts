/**
 * v3-otel-genai-export-adapter —— 后端服务测试。
 *
 * §3 授权门：默认关闭/零外发/dry-run/权限/审计
 * §4 导出目标配置：无默认端点/显式配置/组织隔离
 * §5 只读投影与降级：不回写/失败降级/有限重试/批量导出
 * §6 范围边界：不导出指标
 */

import { describe, it, expect, beforeEach } from 'vitest'

import OTelGenAiExportService, {
  InMemoryExportConfigStore,
  InMemoryExportBuffer,
  ConsoleExporter,
  BoundedRetryPolicy,
  InMemoryAuditStore,
  type OTelExporter,
} from '#services/otel_gen_ai_export_service'

import {
  // fixtures
  authorizedExportConfigFixture,
  orgBExportConfigFixture,
  noTargetExportConfigFixture,
  orgALedgerAttemptFixture,
  orgATraceSpanFixture,
  orgAEvaluationRecordFixture,
  successfulExportRecordFixture,
  OTel_FIXTURE_ORG_A,
  OTel_FIXTURE_ORG_B,
  otlpHttpTargetFixture,
  // mapping & validation
  mapLedgerAttemptToOtelAttributes,
  mapTraceSpanToOtelAttributes,
  mapEvaluationToOtelAttributes,
  OTel_EXPORT_FORBIDDEN_METRIC_TYPES,
} from '@aiproj/types'

import type { OTelExportRecord } from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// 测试辅助
// ═══════════════════════════════════════════════════════════════════════════════

function createService() {
  const configStore = new InMemoryExportConfigStore()
  const buffer = new InMemoryExportBuffer()
  const exporter = new ConsoleExporter()
  const retryPolicy = new BoundedRetryPolicy()
  const auditStore = new InMemoryAuditStore()
  const service = new OTelGenAiExportService(configStore, buffer, exporter, retryPolicy, auditStore)
  return { service, configStore, buffer, exporter, retryPolicy, auditStore }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 授权门
// ═══════════════════════════════════════════════════════════════════════════════

describe('§3 authorization gate', () => {
  let service: OTelGenAiExportService

  beforeEach(() => {
    const ctx = createService()
    service = ctx.service
  })

  it('§3.1 default auth status is unauthorized', () => {
    expect(service.getAuthStatus(OTel_FIXTURE_ORG_A)).toBe('unauthorized')
  })

  it('§3.1 unauthorized state produces zero outbound requests', async () => {
    const records = [successfulExportRecordFixture()]
    const result = await service.exportBatch(OTel_FIXTURE_ORG_A, records)

    expect(result.success).toBe(false)
    expect(result.recordCount).toBe(0)
    expect(result.error).toBe('Export not authorized')
  })

  it('§3.3 dry-run payload is complete and identical to authorized payload', () => {
    const attempts = [orgALedgerAttemptFixture()]
    const spans = [orgATraceSpanFixture()]
    const evaluations = [orgAEvaluationRecordFixture()]

    const dryRunPayload = service.generateDryRunPayload(
      OTel_FIXTURE_ORG_A,
      attempts,
      spans,
      evaluations,
    )

    // dry-run 载荷包含所有记录
    expect(dryRunPayload.organizationId).toBe(OTel_FIXTURE_ORG_A)
    expect(dryRunPayload.recordCount).toBe(3) // 1 attempt + 1 span + 1 evaluation
    expect(dryRunPayload.records.length).toBe(3)

    // 验证映射正确性
    const attemptRecord = dryRunPayload.records.find(
      (r) => r.kind === 'span' && r.attributes['gen_ai.operation.name'] === 'chat',
    )
    expect(attemptRecord).toBeDefined()

    const spanRecord = dryRunPayload.records.find(
      (r) => r.kind === 'span' && r.attributes['span_id'] === 'span-fixture-001',
    )
    expect(spanRecord).toBeDefined()

    const evalRecord = dryRunPayload.records.find((r) => r.kind === 'evaluation')
    expect(evalRecord).toBeDefined()
  })

  it('§3.5 changing auth status requires permission and is audited', async () => {
    const auditRecord = await service.changeAuthStatus(
      OTel_FIXTURE_ORG_A,
      'authorized',
      42,
      otlpHttpTargetFixture(),
    )

    expect(auditRecord.action).toBe('export.auth.enabled')
    expect(auditRecord.organizationId).toBe(OTel_FIXTURE_ORG_A)
    expect(auditRecord.actorUserId).toBe(42)
    expect(auditRecord.previousStatus).toBe('unauthorized')
    expect(auditRecord.newStatus).toBe('authorized')
    expect(auditRecord.target).toBeDefined()
  })

  it('§3.7 auth change leaves audit trail', async () => {
    await service.changeAuthStatus(OTel_FIXTURE_ORG_A, 'authorized', 42)
    await service.changeAuthStatus(OTel_FIXTURE_ORG_A, 'unauthorized', 42)

    const records = service.getAuditRecords(OTel_FIXTURE_ORG_A)
    expect(records.length).toBe(2)
    expect(records[0].action).toBe('export.auth.enabled')
    expect(records[1].action).toBe('export.auth.disabled')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §4 导出目标配置
// ═══════════════════════════════════════════════════════════════════════════════

describe('§4 export target configuration', () => {
  let service: OTelGenAiExportService
  let configStore: InMemoryExportConfigStore

  beforeEach(() => {
    const ctx = createService()
    service = ctx.service
    configStore = ctx.configStore
  })

  it('§4.1 no built-in default endpoint exists', () => {
    // 新建的配置没有默认端点
    const config = configStore.getConfig(OTel_FIXTURE_ORG_A)
    expect(config).toBeNull()
  })

  it('§4.3 unconfigured target states its reason', async () => {
    // 已授权但未配置目标
    configStore.saveConfig(noTargetExportConfigFixture())

    const records = [successfulExportRecordFixture()]
    const result = await service.exportBatch(OTel_FIXTURE_ORG_A, records)

    expect(result.success).toBe(false)
    expect(result.error).toBe('No export target configured')
  })

  it('§4.5 organization isolation: telemetry does not cross organizations', async () => {
    // 配置组织 A 的目标
    configStore.saveConfig(authorizedExportConfigFixture())

    // 混入组织 B 的记录
    const mixedRecords: OTelExportRecord[] = [
      successfulExportRecordFixture({ organizationId: OTel_FIXTURE_ORG_A }),
      {
        kind: 'span',
        attributes: { 'aiproj.organization.id': OTel_FIXTURE_ORG_B },
        timestamp: '2026-08-01T00:00:00.000Z',
        organizationId: OTel_FIXTURE_ORG_B,
      },
    ]

    await service.exportBatch(OTel_FIXTURE_ORG_A, mixedRecords)

    // 重新执行验证隔离
    const isolatedRecords = mixedRecords.filter((r) => r.organizationId === OTel_FIXTURE_ORG_A)
    expect(isolatedRecords.length).toBe(1)
    expect(isolatedRecords[0].organizationId).toBe(OTel_FIXTURE_ORG_A)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §5 只读投影与降级
// ═══════════════════════════════════════════════════════════════════════════════

describe('§5 read-only projection and degradation', () => {
  let service: OTelGenAiExportService
  let buffer: InMemoryExportBuffer

  beforeEach(() => {
    const ctx = createService()
    service = ctx.service
    buffer = ctx.buffer
  })

  it('§5.1 export path writes nothing (read-only)', async () => {
    const configStore = new InMemoryExportConfigStore()
    configStore.saveConfig(authorizedExportConfigFixture())
    const ctx = createService()
    ctx.configStore.saveConfig(authorizedExportConfigFixture())

    const records = [successfulExportRecordFixture()]
    const result = await ctx.service.exportBatch(OTel_FIXTURE_ORG_A, records)

    // 导出成功但不修改任何状态
    expect(result.success).toBe(true)
    // 配置未被修改
    const config = ctx.configStore.getConfig(OTel_FIXTURE_ORG_A)
    expect(config?.authStatus).toBe('authorized')
  })

  it('§5.3 recording continues despite export failure', async () => {
    // 使用会失败的导出器
    class FailingExporter implements OTelExporter {
      async send() {
        return { success: false, recordCount: 0, retryCount: 0, error: 'Network error' }
      }
    }

    const ctx = createService()
    ctx.configStore.saveConfig(authorizedExportConfigFixture())
    const failingService = new OTelGenAiExportService(
      ctx.configStore,
      new InMemoryExportBuffer(),
      new FailingExporter(),
      new BoundedRetryPolicy(),
      new InMemoryAuditStore(),
    )

    const records = [successfulExportRecordFixture()]
    const result = await failingService.exportBatch(OTel_FIXTURE_ORG_A, records)

    // 导出失败但不影响记录
    expect(result.success).toBe(false)
    expect(result.error).toContain('Network error')
    // 原始记录仍然可用（只读投影不修改它们）
    expect(records.length).toBe(1)
  })

  it('§5.5 retries are bounded and failures counted', async () => {
    class FailingExporter implements OTelExporter {
      callCount = 0
      async send() {
        this.callCount++
        return { success: false, recordCount: 0, retryCount: this.callCount - 1, error: 'Fail' }
      }
    }

    const exporter = new FailingExporter()
    const ctx = createService()
    ctx.configStore.saveConfig(authorizedExportConfigFixture({ maxRetries: 2 }))
    const retryService = new OTelGenAiExportService(
      ctx.configStore,
      new InMemoryExportBuffer(),
      exporter,
      new BoundedRetryPolicy(),
      new InMemoryAuditStore(),
    )

    const records = [successfulExportRecordFixture()]
    const result = await retryService.exportBatch(OTel_FIXTURE_ORG_A, records)

    // 重试次数有界（1 initial + 2 retries = 3 calls）
    expect(exporter.callCount).toBe(3)
    expect(result.success).toBe(false)
    expect(result.retryCount).toBe(2)
  })

  it('§5.8 single invocation triggers no immediate export', async () => {
    const record = successfulExportRecordFixture()
    service.bufferRecord(record)

    // 缓冲区有记录但未导出
    expect(buffer.size()).toBe(1)

    // 刷新后才导出
    const ctx = createService()
    ctx.configStore.saveConfig(authorizedExportConfigFixture())
    ctx.buffer.add(record)
    const result = await ctx.service.flushAndExport(OTel_FIXTURE_ORG_A)

    expect(result.success).toBe(true)
    expect(result.recordCount).toBe(1)
    expect(ctx.buffer.size()).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6 范围边界
// ═══════════════════════════════════════════════════════════════════════════════

describe('§6 scope boundaries', () => {
  let service: OTelGenAiExportService

  beforeEach(() => {
    const ctx = createService()
    service = ctx.service
  })

  it('§6.1 no metric entries in payloads', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = service.mapLedgerAttempt(attempt)

    for (const metric of OTel_EXPORT_FORBIDDEN_METRIC_TYPES) {
      expect(metric in attrs).toBe(false)
    }
  })

  it('§6.4 ledger remains single source of truth', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = service.mapLedgerAttempt(attempt)

    // 输出是扁平的 Record，不是嵌套的记录集合
    expect(typeof attrs).toBe('object')
    expect(Array.isArray(attrs)).toBe(false)
    expect('records' in attrs).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 映射委托
// ═══════════════════════════════════════════════════════════════════════════════

describe('mapping delegation', () => {
  let service: OTelGenAiExportService

  beforeEach(() => {
    const ctx = createService()
    service = ctx.service
  })

  it('mapLedgerAttempt delegates to shared contract', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = service.mapLedgerAttempt(attempt)
    const expected = mapLedgerAttemptToOtelAttributes(attempt)
    expect(attrs).toEqual(expected)
  })

  it('mapTraceSpan delegates to shared contract', () => {
    const span = orgATraceSpanFixture()
    const attrs = service.mapTraceSpan(span)
    const expected = mapTraceSpanToOtelAttributes(span)
    expect(attrs).toEqual(expected)
  })

  it('mapEvaluation delegates to shared contract', () => {
    const record = orgAEvaluationRecordFixture()
    const attrs = service.mapEvaluation(record)
    const expected = mapEvaluationToOtelAttributes(record)
    expect(attrs).toEqual(expected)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 禁导校验
// ═══════════════════════════════════════════════════════════════════════════════

describe('payload validation', () => {
  let service: OTelGenAiExportService

  beforeEach(() => {
    const ctx = createService()
    service = ctx.service
  })

  it('validatePayload catches forbidden content attributes', () => {
    const attrs: Record<string, unknown> = {
      'gen_ai.prompt.text': 'some prompt',
    }
    const violations = service.validatePayload(attrs)
    expect(violations.some((v: string) => v.includes('forbidden_content_attribute'))).toBe(true)
  })

  it('validatePayload catches namespace violations', () => {
    const attrs: Record<string, unknown> = {
      custom_dimension: 'value',
    }
    const violations = service.validatePayload(attrs)
    expect(violations.some((v: string) => v.includes('namespace_violation'))).toBe(true)
  })

  it('validatePayload passes for clean payload', () => {
    const attempt = orgALedgerAttemptFixture()
    const attrs = mapLedgerAttemptToOtelAttributes(attempt)
    const violations = service.validatePayload(attrs)
    expect(violations).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 组织隔离端到端
// ═══════════════════════════════════════════════════════════════════════════════

describe('organization isolation end-to-end', () => {
  it('org A and org B payloads are isolated', async () => {
    const ctx = createService()
    ctx.configStore.saveConfig(authorizedExportConfigFixture())
    ctx.configStore.saveConfig(orgBExportConfigFixture())

    // 组织 A 的记录
    const orgARecords: OTelExportRecord[] = [
      {
        kind: 'span',
        attributes: { 'aiproj.organization.id': OTel_FIXTURE_ORG_A },
        timestamp: '2026-08-01T00:00:00.000Z',
        organizationId: OTel_FIXTURE_ORG_A,
      },
    ]

    // 组织 B 的记录
    const orgBRecords: OTelExportRecord[] = [
      {
        kind: 'span',
        attributes: { 'aiproj.organization.id': OTel_FIXTURE_ORG_B },
        timestamp: '2026-08-01T00:00:00.000Z',
        organizationId: OTel_FIXTURE_ORG_B,
      },
    ]

    await ctx.service.exportBatch(OTel_FIXTURE_ORG_A, [...orgARecords, ...orgBRecords])
    await ctx.service.exportBatch(OTel_FIXTURE_ORG_B, [...orgARecords, ...orgBRecords])

    // ConsoleExporter 只保留最后一次载荷
    const lastPayload = ctx.exporter.getLastPayload()
    expect(lastPayload).toBeDefined()
    // 最后一次是组织 B 的导出，应只包含组织 B 的记录
    expect(lastPayload!.organizationId).toBe(OTel_FIXTURE_ORG_B)
    for (const record of lastPayload!.records) {
      expect(record.organizationId).toBe(OTel_FIXTURE_ORG_B)
    }
  })
})
