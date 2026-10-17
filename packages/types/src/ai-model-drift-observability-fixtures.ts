/**
 * v3-ai-model-drift-observability —— 漂移观测 fixtures。
 *
 * 覆盖五态：无漂移 / 首次漂移 / 多次漂移 / response_model 缺失 / 跨连接同名模型。
 * 全部为低敏确定性数据；不包含 prompt/输出全文/密钥。
 */

import type { UnifiedAiInvocationAttempt } from './unified-ai-invocation-ledger.js'
import type { DriftEvent, DriftCorrelatedImpact } from './ai-model-drift-observability.js'

export const DRIFT_FIXTURE_ORG = 101
export const DRIFT_FIXTURE_CONN_A = 3
export const DRIFT_FIXTURE_CONN_B = 7

// ── 基础 attempt factory ──────────────────────────────────────────────────

function baseAttempt(
  overrides: Partial<UnifiedAiInvocationAttempt> & { occurred_at: string },
): UnifiedAiInvocationAttempt {
  return {
    aiproj_organization_id: DRIFT_FIXTURE_ORG,
    aiproj_project_id: 1,
    aiproj_user_id: 1,
    aiproj_connection_id: DRIFT_FIXTURE_CONN_A,
    aiproj_model_id: 1,
    aiproj_capability: 'draft',
    aiproj_surface: 'copilot',
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
    request_model: 'gpt-4',
    response_model: 'gpt-4-0613',
    response_id: null,
    finish_reasons: ['stop'],
    output_type: 'text',
    prompt_name: null,
    aiproj_prompt_version: null,
    tool_name: null,
    tool_type: null,
    tool_call_id: null,
    data_source_id: null,
    trace_id: null,
    span_id: null,
    parent_span_id: null,
    conversation_id: null,
    workflow_name: null,
    agent_id: null,
    agent_name: null,
    agent_version: null,
    idempotency_key: null,
    time_to_first_chunk_ms: 100,
    duration_ms: 500,
    usage_input_tokens: 100,
    usage_output_tokens: 50,
    usage_cache_read_input_tokens: null,
    usage_cache_creation_input_tokens: null,
    usage_reasoning_output_tokens: null,
    aiproj_audio_tokens: null,
    aiproj_context_tokens: null,
    aiproj_total_tokens: 150,
    aiproj_estimated_cost: 0.001,
    aiproj_currency: 'USD',
    aiproj_cost_status: 'estimated',
    aiproj_pricing_snapshot_id: null,
    aiproj_input_hash: null,
    aiproj_output_hash: null,
    aiproj_budget_decision_ref: null,
    aiproj_rate_limit_decision_ref: null,
    aiproj_source_ledger_ref: null,
    ...overrides,
  }
}

// ── 五态 fixtures ─────────────────────────────────────────────────────────

/** 无漂移：同 (连接, request_model) 下 response_model 全部相同。 */
export function driftNoDriftFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({ occurred_at: '2026-08-01T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-02T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-03T00:00:00.000Z', response_model: 'gpt-4-0613' }),
  ]
}

/** 首次漂移：response_model 从 gpt-4-0613 变为 gpt-4-1106。 */
export function driftFirstDriftFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({ occurred_at: '2026-08-01T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-02T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-03T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-10T00:00:00.000Z', response_model: 'gpt-4-1106' }),
    baseAttempt({ occurred_at: '2026-08-11T00:00:00.000Z', response_model: 'gpt-4-1106' }),
  ]
}

/** 多次漂移：response_model 经历多次变化。 */
export function driftMultipleDriftFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({ occurred_at: '2026-08-01T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-05T00:00:00.000Z', response_model: 'gpt-4-1106' }),
    baseAttempt({ occurred_at: '2026-08-10T00:00:00.000Z', response_model: 'gpt-4o-2024-05-13' }),
  ]
}

/** response_model 缺失：部分记录的 response_model 为 null。 */
export function driftMissingResponseModelFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({ occurred_at: '2026-08-01T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-02T00:00:00.000Z', response_model: null }),
    baseAttempt({ occurred_at: '2026-08-03T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-04T00:00:00.000Z', response_model: 'unknown' }),
  ]
}

/** 跨连接同名模型：两个连接用同一 request_model，但 response_model 不同——不产生假漂移。 */
export function driftCrossConnectionFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    // 连接 A
    baseAttempt({
      occurred_at: '2026-08-01T00:00:00.000Z',
      response_model: 'gpt-4-0613',
      aiproj_connection_id: DRIFT_FIXTURE_CONN_A,
    }),
    baseAttempt({
      occurred_at: '2026-08-02T00:00:00.000Z',
      response_model: 'gpt-4-0613',
      aiproj_connection_id: DRIFT_FIXTURE_CONN_A,
    }),
    // 连接 B（不同 provider 部署）
    baseAttempt({
      occurred_at: '2026-08-01T00:00:00.000Z',
      response_model: 'gpt-4-1106',
      aiproj_connection_id: DRIFT_FIXTURE_CONN_B,
    }),
    baseAttempt({
      occurred_at: '2026-08-02T00:00:00.000Z',
      response_model: 'gpt-4-1106',
      aiproj_connection_id: DRIFT_FIXTURE_CONN_B,
    }),
  ]
}

/** 跨组织事件不可见：不同 organizationId 的记录。 */
export function driftCrossOrganizationFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({
      occurred_at: '2026-08-01T00:00:00.000Z',
      response_model: 'gpt-4-0613',
      aiproj_organization_id: DRIFT_FIXTURE_ORG,
    }),
    baseAttempt({
      occurred_at: '2026-08-02T00:00:00.000Z',
      response_model: 'gpt-4-1106',
      aiproj_organization_id: DRIFT_FIXTURE_ORG,
    }),
    // 另一个组织
    baseAttempt({
      occurred_at: '2026-08-01T00:00:00.000Z',
      response_model: 'claude-3-opus',
      aiproj_organization_id: 999,
      aiproj_connection_id: 99,
    }),
  ]
}

/** 金丝雀式部分流量换版：少量记录用新 response_model。 */
export function driftCanaryFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({ occurred_at: '2026-08-01T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-02T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-03T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    // 金丝雀：1/4 流量切到新版本
    baseAttempt({ occurred_at: '2026-08-03T01:00:00.000Z', response_model: 'gpt-4-1106' }),
    baseAttempt({ occurred_at: '2026-08-04T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-04T01:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-04T02:00:00.000Z', response_model: 'gpt-4-0613' }),
  ]
}

/** 确定性测试用：同一快照两次检测应产出相同结果。 */
export function driftDeterministicFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({
      occurred_at: '2026-08-01T10:00:00.000Z',
      response_model: 'gpt-4-0613',
      aiproj_attempt_number: 1,
    }),
    baseAttempt({
      occurred_at: '2026-08-01T10:00:00.000Z',
      response_model: 'gpt-4-1106',
      aiproj_attempt_number: 2,
    }),
    baseAttempt({
      occurred_at: '2026-08-02T10:00:00.000Z',
      response_model: 'gpt-4-1106',
      aiproj_attempt_number: 1,
    }),
  ]
}

/** 缺失率测试用：不同 provider 有不同缺失率。 */
export function driftMissingRateFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    // openai: 2/5 缺失（40%）
    baseAttempt({
      occurred_at: '2026-08-01T00:00:00.000Z',
      response_model: 'gpt-4-0613',
      provider_name: 'openai',
    }),
    baseAttempt({
      occurred_at: '2026-08-02T00:00:00.000Z',
      response_model: null,
      provider_name: 'openai',
    }),
    baseAttempt({
      occurred_at: '2026-08-03T00:00:00.000Z',
      response_model: 'gpt-4-0613',
      provider_name: 'openai',
    }),
    baseAttempt({
      occurred_at: '2026-08-04T00:00:00.000Z',
      response_model: null,
      provider_name: 'openai',
    }),
    baseAttempt({
      occurred_at: '2026-08-05T00:00:00.000Z',
      response_model: 'gpt-4-0613',
      provider_name: 'openai',
    }),
    // anthropic: 0/3 缺失（0%）
    baseAttempt({
      occurred_at: '2026-08-01T00:00:00.000Z',
      response_model: 'claude-3-opus',
      provider_name: 'anthropic',
    }),
    baseAttempt({
      occurred_at: '2026-08-02T00:00:00.000Z',
      response_model: 'claude-3-opus',
      provider_name: 'anthropic',
    }),
    baseAttempt({
      occurred_at: '2026-08-03T00:00:00.000Z',
      response_model: 'claude-3-opus',
      provider_name: 'anthropic',
    }),
  ]
}

/** 金丝雀式部分流量换版 fixture（用于 §3.4 测试）。 */
export function driftPartialTrafficRolloutFixtures(): UnifiedAiInvocationAttempt[] {
  const attempts: UnifiedAiInvocationAttempt[] = []
  // 9 条 gpt-4-0613 + 1 条 gpt-4-1106（10% 金丝雀）
  for (let i = 0; i < 9; i++) {
    attempts.push(
      baseAttempt({
        occurred_at: `2026-08-0${i + 1}T00:00:00.000Z`,
        response_model: 'gpt-4-0613',
      }),
    )
  }
  attempts.push(
    baseAttempt({
      occurred_at: '2026-08-05T01:00:00.000Z',
      response_model: 'gpt-4-1106',
    }),
  )
  return attempts
}

/** 低样本测试用：窗口内样本不足时标注。 */
export function driftInsufficientSamplesFixtures(): UnifiedAiInvocationAttempt[] {
  return [
    baseAttempt({ occurred_at: '2026-08-01T00:00:00.000Z', response_model: 'gpt-4-0613' }),
    baseAttempt({ occurred_at: '2026-08-10T00:00:00.000Z', response_model: 'gpt-4-1106' }),
  ]
}

/** 预构造的漂移事件 fixture。 */
export function driftEventFixture(overrides?: Partial<DriftEvent>): DriftEvent {
  return {
    eventId: 'drift:3:gpt-4:gpt-4-1106:2026-08-10T00:00:00.000Z',
    organizationId: DRIFT_FIXTURE_ORG,
    connectionId: DRIFT_FIXTURE_CONN_A,
    requestModel: 'gpt-4',
    newResponseModel: 'gpt-4-1106',
    previousResponseModel: 'gpt-4-0613',
    firstOccurrenceAt: '2026-08-10T00:00:00.000Z',
    correlatedImpact: driftCorrelatedImpactFixture(),
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

/** 预构造的关联影响 fixture。 */
export function driftCorrelatedImpactFixture(
  overrides?: Partial<DriftCorrelatedImpact>,
): DriftCorrelatedImpact {
  return {
    quality: {
      beforeMean: 0.85,
      afterMean: 0.72,
      delta: -0.13,
      beforeSampleCount: 10,
      afterSampleCount: 8,
      sufficientSamples: true,
    },
    cost: {
      beforeMean: 0.005,
      afterMean: 0.007,
      delta: 0.002,
      beforeSampleCount: 10,
      afterSampleCount: 8,
      sufficientSamples: true,
    },
    latency: {
      beforeMean: 500,
      afterMean: 650,
      delta: 150,
      beforeSampleCount: 10,
      afterSampleCount: 8,
      sufficientSamples: true,
    },
    windowDays: 7,
    ...overrides,
  }
}
