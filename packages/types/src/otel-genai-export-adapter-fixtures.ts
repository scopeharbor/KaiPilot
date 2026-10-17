/**
 * v3-otel-genai-export-adapter —— 导出适配器 fixtures。
 *
 * 覆盖四态：未授权 / 已授权 / 导出失败 / 跨组织。
 * 全部为低敏确定性数据；不包含 prompt/输出全文/密钥。
 */

import type {
  OTelExportConfig,
  OTelExportTarget,
  OTelExportRecord,
  OTelExportBatchPayload,
  OTelExportAuditRecord,
} from './otel-genai-export-adapter.js'

import type { UnifiedAiInvocationAttempt } from './unified-ai-invocation-ledger.js'
import type { AiTraceSpan } from './ai-request-tracing.js'
import type { EvaluationScoreRecord } from './ai-automated-evaluation.js'

import { unifiedAiInvocationAttemptFixture } from './unified-ai-invocation-ledger-fixtures.js'

// ── 组织 ID 常量 ──

export const OTel_FIXTURE_ORG_A = 101
export const OTel_FIXTURE_ORG_B = 202

const BASE_TIME = '2026-08-01T00:00:00.000Z'

// ── 目标配置 fixtures ──

/** OTLP HTTP 目标。 */
export function otlpHttpTargetFixture(overrides?: Partial<OTelExportTarget>): OTelExportTarget {
  return {
    type: 'otlp_http',
    endpoint: 'https://otel.example.com:4318/v1/traces',
    timeoutMs: 10_000,
    ...overrides,
  }
}

/** console 目标（dry-run 用）。 */
export function consoleTargetFixture(overrides?: Partial<OTelExportTarget>): OTelExportTarget {
  return {
    type: 'console',
    ...overrides,
  }
}

// ── 配置 fixtures ──

/** 未授权配置。 */
export function unauthorizedExportConfigFixture(
  overrides?: Partial<OTelExportConfig>,
): OTelExportConfig {
  return {
    organizationId: OTel_FIXTURE_ORG_A,
    authStatus: 'unauthorized',
    target: otlpHttpTargetFixture(),
    batchWindowMs: 60_000,
    maxRetries: 3,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  }
}

/** 已授权配置。 */
export function authorizedExportConfigFixture(
  overrides?: Partial<OTelExportConfig>,
): OTelExportConfig {
  return {
    organizationId: OTel_FIXTURE_ORG_A,
    authStatus: 'authorized',
    target: otlpHttpTargetFixture(),
    batchWindowMs: 60_000,
    maxRetries: 3,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  }
}

/** 跨组织配置（组织 B）。 */
export function orgBExportConfigFixture(overrides?: Partial<OTelExportConfig>): OTelExportConfig {
  return {
    organizationId: OTel_FIXTURE_ORG_B,
    authStatus: 'authorized',
    target: otlpHttpTargetFixture({
      endpoint: 'https://otel-org-b.example.com:4318/v1/traces',
    }),
    batchWindowMs: 60_000,
    maxRetries: 3,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  }
}

/** 无目标配置（未配置端点）。 */
export function noTargetExportConfigFixture(
  overrides?: Partial<OTelExportConfig>,
): OTelExportConfig {
  return {
    organizationId: OTel_FIXTURE_ORG_A,
    authStatus: 'authorized',
    // target 未设置
    batchWindowMs: 60_000,
    maxRetries: 3,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  }
}

// ── 账本 attempt fixtures ──

/** 组织 A 的账本 attempt。 */
export function orgALedgerAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    aiproj_organization_id: OTel_FIXTURE_ORG_A,
    ...overrides,
  })
}

/** 组织 B 的账本 attempt。 */
export function orgBLedgerAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    aiproj_organization_id: OTel_FIXTURE_ORG_B,
    trace_id: 'trace-fixture-002',
    span_id: 'span-fixture-002',
    ...overrides,
  })
}

// ── 追踪 span fixtures ──

/** 组织 A 的追踪 span。 */
export function orgATraceSpanFixture(overrides?: Partial<AiTraceSpan>): AiTraceSpan {
  return {
    span_id: 'span-fixture-001',
    trace_id: 'trace-fixture-001',
    parent_span_id: null,
    span_type: 'chat',
    started_at: BASE_TIME,
    ended_at: '2026-08-01T00:00:01.000Z',
    duration_ms: 1000,
    status: 'ok',
    error_kind: null,
    error_ref: null,
    organization_id: OTel_FIXTURE_ORG_A,
    conversation_id: 'conv-fixture-001',
    workflow_name: null,
    is_orphan: false,
    orphan_break_reason: null,
    self_duration_ms: 500,
    on_critical_path: true,
    estimated_cost: 0.005,
    input_tokens: 500,
    output_tokens: 200,
    metadata: null,
    ...overrides,
  }
}

/** 组织 B 的追踪 span。 */
export function orgBTraceSpanFixture(overrides?: Partial<AiTraceSpan>): AiTraceSpan {
  return {
    span_id: 'span-fixture-002',
    trace_id: 'trace-fixture-002',
    parent_span_id: null,
    span_type: 'generate_content',
    started_at: BASE_TIME,
    ended_at: '2026-08-01T00:00:02.000Z',
    duration_ms: 2000,
    status: 'ok',
    error_kind: null,
    error_ref: null,
    organization_id: OTel_FIXTURE_ORG_B,
    conversation_id: 'conv-fixture-002',
    workflow_name: null,
    is_orphan: false,
    orphan_break_reason: null,
    self_duration_ms: 1000,
    on_critical_path: false,
    estimated_cost: 0.01,
    input_tokens: 1000,
    output_tokens: 500,
    metadata: null,
    ...overrides,
  }
}

// ── 评测记录 fixtures ──

/** 组织 A 的评测记录。 */
export function orgAEvaluationRecordFixture(
  overrides?: Partial<EvaluationScoreRecord>,
): EvaluationScoreRecord {
  return {
    organizationId: OTel_FIXTURE_ORG_A,
    dimension: 'draft_structural_compliance',
    scoreValue: 1,
    scoreLabel: 'pass',
    explanation: 'Draft structure meets all compliance requirements.',
    evaluatedArtifact: {
      artifactKind: 'ledger_attempt',
      artifactRef: 'attempt-fixture-001',
      contentHash: 'a1b2c3d4e5f6',
    },
    evaluator: {
      kind: 'deterministic',
      name: 'draft_structural_compliance',
      version: '1.0.0',
    },
    samplingDecision: {
      declaration: {
        strategy: 'all',
        ratio: 1,
        lowConfidenceAlwaysEvaluate: false,
      },
      decision: 'evaluated',
    },
    idempotencyKey: 'eval-ik-fixture-001',
    createdAt: BASE_TIME,
    ...overrides,
  }
}

// ── 导出记录 fixtures ──

/** 成功的导出记录。 */
export function successfulExportRecordFixture(
  overrides?: Partial<OTelExportRecord>,
): OTelExportRecord {
  return {
    kind: 'span',
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': 'openai',
      'gen_ai.request.model': 'gpt-4o',
    },
    timestamp: BASE_TIME,
    organizationId: OTel_FIXTURE_ORG_A,
    ...overrides,
  }
}

/** 失败的导出载荷（跨组织）。 */
export function crossOrgBatchPayloadFixture(): OTelExportBatchPayload {
  return {
    organizationId: OTel_FIXTURE_ORG_A,
    records: [
      successfulExportRecordFixture(),
      // 故意混入组织 B 的记录
      {
        kind: 'span',
        attributes: {
          'aiproj.organization.id': OTel_FIXTURE_ORG_B,
        },
        timestamp: BASE_TIME,
        organizationId: OTel_FIXTURE_ORG_B,
      },
    ],
    batchCreatedAt: BASE_TIME,
    recordCount: 2,
  }
}

// ── 审计记录 fixtures ──

/** 授权启用审计记录。 */
export function authEnabledAuditRecordFixture(
  overrides?: Partial<OTelExportAuditRecord>,
): OTelExportAuditRecord {
  return {
    action: 'export.auth.enabled',
    organizationId: OTel_FIXTURE_ORG_A,
    actorUserId: 42,
    previousStatus: 'unauthorized',
    newStatus: 'authorized',
    timestamp: BASE_TIME,
    target: otlpHttpTargetFixture(),
    ...overrides,
  }
}

/** 授权禁用审计记录。 */
export function authDisabledAuditRecordFixture(
  overrides?: Partial<OTelExportAuditRecord>,
): OTelExportAuditRecord {
  return {
    action: 'export.auth.disabled',
    organizationId: OTel_FIXTURE_ORG_A,
    actorUserId: 42,
    previousStatus: 'authorized',
    newStatus: 'unauthorized',
    timestamp: BASE_TIME,
    ...overrides,
  }
}
