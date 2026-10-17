/**
 * v3-ai-request-tracing —— 追踪契约 Fixtures。
 *
 * 八态 fixtures：
 * 1. 单跳：一个模型调用
 * 2. 多跳：多层嵌套（检索 → 模型 → 工具 → 模型）
 * 3. 含非模型 span：检索/上下文装配等耗时步骤
 * 4. 孤儿 span：父 span 缺失
 * 5. 断链：跨 service 传播失败
 * 6. 被拒跳：预算或限流拒绝
 * 7. 会话聚合：同一会话多个 trace
 * 8. 编排聚合：同一编排多个 trace
 */

import type {
  AiTraceSpan,
  AiTraceSessionAggregation,
  AiTraceWorkflowAggregation,
} from './ai-request-tracing.js'

// ---------------------------------------------------------------------------
// 时间辅助
// ---------------------------------------------------------------------------

const BASE_TIME = '2026-08-17T10:00:00.000Z'

function msAfter(base: string, offsetMs: number): string {
  const d = new Date(base)
  d.setMilliseconds(d.getMilliseconds() + offsetMs)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// 1. 单跳：一个模型调用
// ---------------------------------------------------------------------------

export function singleHopTraceSpans(): AiTraceSpan[] {
  return [
    {
      span_id: 'span-single-001',
      trace_id: 'trace-single-001',
      parent_span_id: null,
      span_type: 'chat',
      started_at: BASE_TIME,
      ended_at: msAfter(BASE_TIME, 1200),
      duration_ms: 1200,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-001',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 1200,
      on_critical_path: true,
      estimated_cost: 0.003,
      input_tokens: 500,
      output_tokens: 200,
      metadata: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 2. 多跳：检索 → 模型 → 工具 → 模型
// ---------------------------------------------------------------------------

export function multiHopTraceSpans(): AiTraceSpan[] {
  return [
    // 根：意图分类
    {
      span_id: 'span-multi-001',
      trace_id: 'trace-multi-001',
      parent_span_id: null,
      span_type: 'chat',
      started_at: BASE_TIME,
      ended_at: msAfter(BASE_TIME, 3000),
      duration_ms: 3000,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-002',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 500,
      on_critical_path: true,
      estimated_cost: 0.01,
      input_tokens: 1000,
      output_tokens: 300,
      metadata: null,
    },
    // 子：检索
    {
      span_id: 'span-multi-002',
      trace_id: 'trace-multi-001',
      parent_span_id: 'span-multi-001',
      span_type: 'retrieval',
      started_at: msAfter(BASE_TIME, 100),
      ended_at: msAfter(BASE_TIME, 800),
      duration_ms: 700,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-002',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 700,
      on_critical_path: false,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: { sourceCount: 12 },
    },
    // 子：上下文装配后的模型调用
    {
      span_id: 'span-multi-003',
      trace_id: 'trace-multi-001',
      parent_span_id: 'span-multi-001',
      span_type: 'chat',
      started_at: msAfter(BASE_TIME, 900),
      ended_at: msAfter(BASE_TIME, 2200),
      duration_ms: 1300,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-002',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 300,
      on_critical_path: true,
      estimated_cost: 0.005,
      input_tokens: 800,
      output_tokens: 150,
      metadata: null,
    },
    // 孙：工具调用
    {
      span_id: 'span-multi-004',
      trace_id: 'trace-multi-001',
      parent_span_id: 'span-multi-003',
      span_type: 'execute_tool',
      started_at: msAfter(BASE_TIME, 1000),
      ended_at: msAfter(BASE_TIME, 1500),
      duration_ms: 500,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-002',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 500,
      on_critical_path: true,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: { toolName: 'search_projects' },
    },
    // 子：叙述模型调用
    {
      span_id: 'span-multi-005',
      trace_id: 'trace-multi-001',
      parent_span_id: 'span-multi-001',
      span_type: 'chat',
      started_at: msAfter(BASE_TIME, 2300),
      ended_at: msAfter(BASE_TIME, 3000),
      duration_ms: 700,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-002',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 700,
      on_critical_path: false,
      estimated_cost: 0.003,
      input_tokens: 600,
      output_tokens: 100,
      metadata: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 3. 含非模型 span
// ---------------------------------------------------------------------------

export function nonModelSpanTraceSpans(): AiTraceSpan[] {
  return [
    {
      span_id: 'span-nm-001',
      trace_id: 'trace-nm-001',
      parent_span_id: null,
      span_type: 'chat',
      started_at: BASE_TIME,
      ended_at: msAfter(BASE_TIME, 5000),
      duration_ms: 5000,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-003',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 1000,
      on_critical_path: true,
      estimated_cost: 0.02,
      input_tokens: 2000,
      output_tokens: 500,
      metadata: null,
    },
    // 上下文装配（非模型）
    {
      span_id: 'span-nm-002',
      trace_id: 'trace-nm-001',
      parent_span_id: 'span-nm-001',
      span_type: 'retrieval',
      started_at: msAfter(BASE_TIME, 100),
      ended_at: msAfter(BASE_TIME, 2000),
      duration_ms: 1900,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-003',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 1900,
      on_critical_path: true,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
    // Skill 激活（非模型）
    {
      span_id: 'span-nm-003',
      trace_id: 'trace-nm-001',
      parent_span_id: 'span-nm-001',
      span_type: 'invoke_agent',
      started_at: msAfter(BASE_TIME, 50),
      ended_at: msAfter(BASE_TIME, 300),
      duration_ms: 250,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-003',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 250,
      on_critical_path: false,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
    // 草案层 preview（非模型）
    {
      span_id: 'span-nm-004',
      trace_id: 'trace-nm-001',
      parent_span_id: 'span-nm-001',
      span_type: 'generate_content',
      started_at: msAfter(BASE_TIME, 2100),
      ended_at: msAfter(BASE_TIME, 3000),
      duration_ms: 900,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-003',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 900,
      on_critical_path: false,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 4. 孤儿 span
// ---------------------------------------------------------------------------

export function orphanSpanTraceSpans(): AiTraceSpan[] {
  return [
    {
      span_id: 'span-orphan-001',
      trace_id: 'trace-orphan-001',
      parent_span_id: null,
      span_type: 'chat',
      started_at: BASE_TIME,
      ended_at: msAfter(BASE_TIME, 1000),
      duration_ms: 1000,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-004',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 1000,
      on_critical_path: true,
      estimated_cost: 0.005,
      input_tokens: 500,
      output_tokens: 100,
      metadata: null,
    },
    // 孤儿 span：父 ID 不存在
    {
      span_id: 'span-orphan-002',
      trace_id: 'trace-orphan-001',
      parent_span_id: 'span-nonexistent-999',
      span_type: 'retrieval',
      started_at: msAfter(BASE_TIME, 200),
      ended_at: msAfter(BASE_TIME, 600),
      duration_ms: 400,
      status: 'orphaned',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-004',
      workflow_name: null,
      is_orphan: true,
      orphan_break_reason: 'parent_not_found',
      self_duration_ms: 400,
      on_critical_path: false,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 5. 断链：跨 service 传播失败
// ---------------------------------------------------------------------------

export function brokenLinkTraceSpans(): AiTraceSpan[] {
  return [
    {
      span_id: 'span-broken-001',
      trace_id: 'trace-broken-001',
      parent_span_id: null,
      span_type: 'invoke_workflow',
      started_at: BASE_TIME,
      ended_at: msAfter(BASE_TIME, 2000),
      duration_ms: 2000,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: null,
      workflow_name: 'compiler-pdm',
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 2000,
      on_critical_path: true,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
    // 跨 service 断链孤儿
    {
      span_id: 'span-broken-002',
      trace_id: 'trace-broken-001',
      parent_span_id: 'span-unknown-parent',
      span_type: 'chat',
      started_at: msAfter(BASE_TIME, 300),
      ended_at: msAfter(BASE_TIME, 1500),
      duration_ms: 1200,
      status: 'orphaned',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: null,
      workflow_name: 'compiler-pdm',
      is_orphan: true,
      orphan_break_reason: 'cross_service_boundary',
      self_duration_ms: 1200,
      on_critical_path: false,
      estimated_cost: 0.008,
      input_tokens: 600,
      output_tokens: 200,
      metadata: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 6. 被拒跳：预算或限流拒绝
// ---------------------------------------------------------------------------

export function refusedHopTraceSpans(): AiTraceSpan[] {
  return [
    {
      span_id: 'span-refuse-001',
      trace_id: 'trace-refuse-001',
      parent_span_id: null,
      span_type: 'chat',
      started_at: BASE_TIME,
      ended_at: msAfter(BASE_TIME, 500),
      duration_ms: 500,
      status: 'ok',
      error_kind: null,
      error_ref: null,
      organization_id: 1,
      conversation_id: 'conv-005',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 500,
      on_critical_path: true,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
    // 预算拒绝的子 span
    {
      span_id: 'span-refuse-002',
      trace_id: 'trace-refuse-001',
      parent_span_id: 'span-refuse-001',
      span_type: 'chat',
      started_at: msAfter(BASE_TIME, 200),
      ended_at: msAfter(BASE_TIME, 250),
      duration_ms: 50,
      status: 'cancelled',
      error_kind: 'capability_mismatch',
      error_ref: 'budget-exceeded-project-daily-limit',
      organization_id: 1,
      conversation_id: 'conv-005',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 50,
      on_critical_path: true,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
    // 限流拒绝的子 span
    {
      span_id: 'span-refuse-003',
      trace_id: 'trace-refuse-001',
      parent_span_id: 'span-refuse-001',
      span_type: 'chat',
      started_at: msAfter(BASE_TIME, 260),
      ended_at: msAfter(BASE_TIME, 310),
      duration_ms: 50,
      status: 'cancelled',
      error_kind: 'provider_rate_limit',
      error_ref: 'rpm-limit-exceeded',
      organization_id: 1,
      conversation_id: 'conv-005',
      workflow_name: null,
      is_orphan: false,
      orphan_break_reason: null,
      self_duration_ms: 50,
      on_critical_path: false,
      estimated_cost: null,
      input_tokens: null,
      output_tokens: null,
      metadata: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// 7. 会话聚合
// ---------------------------------------------------------------------------

export function sessionAggregationFixture(): AiTraceSessionAggregation {
  return {
    conversation_id: 'conv-002',
    trace_count: 3,
    total_spans: 15,
    total_duration_ms: 9000,
    total_estimated_cost: 0.05,
    avg_trace_duration_ms: 3000,
    slowest_trace_id: 'trace-multi-001',
    window_start: '2026-08-17T09:00:00.000Z',
    window_end: '2026-08-17T11:00:00.000Z',
  }
}

// ---------------------------------------------------------------------------
// 8. 编排聚合
// ---------------------------------------------------------------------------

export function workflowAggregationFixture(): AiTraceWorkflowAggregation {
  return {
    workflow_name: 'compiler-pdm',
    trace_count: 5,
    total_spans: 25,
    total_duration_ms: 15000,
    total_estimated_cost: 0.1,
    avg_trace_duration_ms: 3000,
    slowest_trace_id: 'trace-broken-001',
    window_start: '2026-08-17T09:00:00.000Z',
    window_end: '2026-08-17T11:00:00.000Z',
  }
}
