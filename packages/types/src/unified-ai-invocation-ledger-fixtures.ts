/**
 * v3-unified-ai-invocation-ledger —— 账本 attempt fixtures。
 *
 * 覆盖六态：成功 / 失败 / 降级 / 重试 / 中止 / 桥接。
 * 全部为低敏确定性数据；不包含 prompt/输出全文/密钥。
 */

import type { UnifiedAiInvocationAttempt } from './unified-ai-invocation-ledger.js'

export const LEDGER_FIXTURE_ORG_A = 101
export const LEDGER_FIXTURE_ORG_B = 202
export const LEDGER_FIXTURE_PROJECT = 7

const BASE_TIME = '2026-08-01T00:00:00.000Z'

export function unifiedAiInvocationAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return {
    aiproj_organization_id: LEDGER_FIXTURE_ORG_A,
    aiproj_project_id: LEDGER_FIXTURE_PROJECT,
    aiproj_user_id: 42,
    aiproj_connection_id: 3,
    aiproj_model_id: 5,
    aiproj_capability: 'draft',
    aiproj_surface: 'draft',
    aiproj_attempt_number: 1,
    aiproj_using_real_adapter: true,
    aiproj_fallback_used: false,
    aiproj_source: 'user',
    status: 'succeeded',
    error_kind: 'none',
    error_message_ref: null,
    aiproj_degraded: false,
    operation_name: 'chat',
    provider_name: 'openai',
    request_model: 'gpt-4o',
    response_model: 'gpt-4o-2024-08-06',
    response_id: 'resp_fixture_001',
    finish_reasons: ['stop'],
    output_type: 'text',
    prompt_name: null,
    aiproj_prompt_version: null,
    tool_name: null,
    tool_type: null,
    tool_call_id: null,
    data_source_id: null,
    trace_id: 'trace-fixture-001',
    span_id: 'span-fixture-001',
    parent_span_id: null,
    conversation_id: 'conv-fixture-001',
    workflow_name: null,
    agent_id: null,
    agent_name: null,
    agent_version: null,
    idempotency_key: 'ik-fixture-001',
    time_to_first_chunk_ms: 120,
    duration_ms: 850,
    usage_input_tokens: 500,
    usage_output_tokens: 200,
    usage_cache_read_input_tokens: 120,
    usage_cache_creation_input_tokens: 0,
    usage_reasoning_output_tokens: 0,
    aiproj_audio_tokens: null,
    aiproj_context_tokens: null,
    aiproj_total_tokens: 700,
    aiproj_estimated_cost: 0.005,
    aiproj_currency: 'USD',
    aiproj_cost_status: 'estimated',
    aiproj_pricing_snapshot_id: 'ps-fixture-001',
    aiproj_input_hash: 'a1b2c3d4e5f6',
    aiproj_output_hash: 'f6e5d4c3b2a1',
    aiproj_budget_decision_ref: null,
    aiproj_rate_limit_decision_ref: null,
    aiproj_source_ledger_ref: null,
    occurred_at: BASE_TIME,
    ...overrides,
  }
}

// ── 六态 fixtures ──

/** 成功态。 */
export function ledgerSuccessAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    status: 'succeeded',
    error_kind: 'none',
    aiproj_degraded: false,
    ...overrides,
  })
}

/** 失败态。 */
export function ledgerFailedAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    status: 'failed',
    error_kind: 'provider_timeout',
    error_message_ref: 'err:provider-timeout:fixture',
    usage_input_tokens: 400,
    usage_output_tokens: 0,
    aiproj_estimated_cost: 0,
    aiproj_cost_status: 'unavailable',
    aiproj_output_hash: null,
    ...overrides,
  })
}

/** 降级态：fallback 已用、结果非最优但未失败。 */
export function ledgerDegradedAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    status: 'degraded',
    aiproj_degraded: true,
    aiproj_fallback_used: true,
    aiproj_source: 'fallback',
    error_kind: 'capability_mismatch',
    error_message_ref: 'err:degraded-fallback:fixture',
    ...overrides,
  })
}

/** 重试态：同 idempotency_key 的第二次尝试。 */
export function ledgerRetryAttemptFixture(
  attemptNumber: number,
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    idempotency_key: 'ik-retry-fixture',
    aiproj_attempt_number: attemptNumber,
    ...(attemptNumber === 1
      ? {
          status: 'failed',
          error_kind: 'provider_unavailable',
          error_message_ref: 'err:retry-1:fixture',
          duration_ms: 300,
          usage_output_tokens: 0,
        }
      : {
          status: 'succeeded',
          error_kind: 'none',
          duration_ms: 900,
        }),
    ...overrides,
  })
}

/** 中止态：用户/调用方取消。 */
export function ledgerAbortedAttemptFixture(
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    status: 'aborted',
    error_kind: 'sse_interrupted',
    error_message_ref: 'err:aborted:fixture',
    usage_input_tokens: 180,
    usage_output_tokens: 15,
    aiproj_estimated_cost: 0,
    aiproj_cost_status: 'unavailable',
    aiproj_output_hash: null,
    ...overrides,
  })
}

/** 桥接态：同一调用同时存在于来源账本（OCR/Compiler）。 */
export function ledgerBridgedAttemptFixture(
  sourceRef: string,
  overrides?: Partial<UnifiedAiInvocationAttempt>,
): UnifiedAiInvocationAttempt {
  return unifiedAiInvocationAttemptFixture({
    aiproj_capability: 'ocr',
    aiproj_surface: 'ocr',
    operation_name: 'generate_content',
    provider_name: 'openai-compatible',
    request_model: 'gpt-4o',
    aiproj_source_ledger_ref: sourceRef,
    idempotency_key: `ik-bridged-${sourceRef.replace(/[^a-zA-Z0-9]/g, '-')}`,
    ...overrides,
  })
}

// ── 组合 fixture ──

/** 六态全集（用于聚合/去重/桥接测试）。 */
export function unifiedAiInvocationLedgerFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    ledgerSuccessAttemptFixture(),
    ledgerFailedAttemptFixture(),
    ledgerDegradedAttemptFixture(),
    ledgerRetryAttemptFixture(1),
    ledgerRetryAttemptFixture(2),
    ledgerAbortedAttemptFixture(),
    ledgerBridgedAttemptFixture('ocr:attempt:9001'),
  ]
}

/** 来源账本行（compiler cost_event / ocr provider_attempt 的简化表示，供去重测试）。 */
export function sourceLedgerRowFixture(overrides?: {
  idempotencyKey?: string | null
  sourceRef?: string | null
  cost?: number | null
}): { idempotencyKey: string | null; sourceRef: string | null; cost: number | null } {
  return {
    idempotencyKey: overrides?.idempotencyKey ?? 'ik-bridged-ocr-attempt-9001',
    sourceRef: overrides?.sourceRef ?? 'ocr:attempt:9001',
    cost: overrides?.cost ?? 0.005,
  }
}
