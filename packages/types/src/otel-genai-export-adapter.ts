/**
 * v3-otel-genai-export-adapter —— OTel GenAI 导出适配器共享契约。
 *
 * 把统一账本、追踪与评测记录映射为标准 GenAI 属性并按 OTLP 协议导出。
 *
 * 核心裁决（来自 design.md）：
 * - D1 默认关闭：未授权时零外发，dry-run 可完整验证
 * - D2 绝不导出 prompt/模型输出全文，包括 opt-in 属性
 * - D3 本地扩展一律走 aiproj.* 命名空间
 * - D4 导出是只读投影，账本仍是唯一事实来源
 * - D5 不内置默认外部端点
 * - D6 不做指标导出
 * - D7 按组织隔离，不跨组织混流
 * - D8 授权状态变更需要权限且写入审计
 *
 * 零运行时依赖原则：不导入 zod / adonisjs / Date.now() / Math.random()。
 * @aiproj/types 零依赖约束
 */

import type { UnifiedAiInvocationAttempt } from './unified-ai-invocation-ledger.js'
import type { AiTraceSpan } from './ai-request-tracing.js'
import type { EvaluationScoreRecord } from './ai-automated-evaluation.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §1 授权状态与配置
// ═══════════════════════════════════════════════════════════════════════════════

/** 导出授权状态。 */
export const OTelExportAuthStatuses = ['unauthorized', 'authorized'] as const
export type OTelExportAuthStatus = (typeof OTelExportAuthStatuses)[number]

/** 类型守卫：判断一个值是否为合法授权状态。 */
export function isOTelExportAuthStatus(value: string): value is OTelExportAuthStatus {
  return (OTelExportAuthStatuses as readonly string[]).includes(value)
}

/** 导出目标类型。 */
export const OTelExportTargetTypes = ['otlp_http', 'otlp_grpc', 'console'] as const
export type OTelExportTargetType = (typeof OTelExportTargetTypes)[number]

/** 类型守卫：判断一个值是否为合法目标类型。 */
export function isOTelExportTargetType(value: string): value is OTelExportTargetType {
  return (OTelExportTargetTypes as readonly string[]).includes(value)
}

/**
 * 导出目标配置。
 * 必须显式配置——不内置任何默认外部端点。
 */
export interface OTelExportTarget {
  /** 目标类型。 */
  type: OTelExportTargetType
  /** 目标端点 URL（otlp_http/otlp_grpc 时必填）。 */
  endpoint?: string
  /** 请求超时（毫秒）。 */
  timeoutMs?: number
  /** 请求头（可选，用于认证 token）。 */
  headers?: Record<string, string>
}

/**
 * 导出配置——per-organization。
 */
export interface OTelExportConfig {
  /** 组织 ID。 */
  organizationId: number
  /** 授权状态。 */
  authStatus: OTelExportAuthStatus
  /** 导出目标。 */
  target?: OTelExportTarget
  /** 批量导出窗口大小（毫秒）。 */
  batchWindowMs?: number
  /** 最大重试次数。 */
  maxRetries?: number
  /** 创建时间。 */
  createdAt: string
  /** 最后更新时间。 */
  updatedAt: string
}

/** 默认批量窗口大小（毫秒）。 */
export const DEFAULT_OTEL_BATCH_WINDOW_MS = 60_000

/** 默认最大重试次数。 */
export const DEFAULT_OTEL_MAX_RETRIES = 3

// ═══════════════════════════════════════════════════════════════════════════════
// §2 账本列到标准 GenAI 属性的映射
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 账本列到标准 OTel GenAI 属性名的映射表。
 *
 * 账本列名（snake_case）→ OTel 属性名（dot.notation）。
 * 映射是一对一的恒等映射（因为账本从设计起就按 GenAI 约定命名）。
 */
export const LEDGER_TO_GENAI_ATTRIBUTE_MAP: Readonly<Record<string, string>> = {
  operation_name: 'gen_ai.operation.name',
  provider_name: 'gen_ai.provider.name',
  request_model: 'gen_ai.request.model',
  response_model: 'gen_ai.response.model',
  response_id: 'gen_ai.response.id',
  finish_reasons: 'gen_ai.finish_reasons',
  output_type: 'gen_ai.output.type',
  prompt_name: 'gen_ai.prompt.name',
  tool_name: 'gen_ai.tool.name',
  tool_type: 'gen_ai.tool.type',
  tool_call_id: 'gen_ai.tool.call.id',
  data_source_id: 'gen_ai.data_source.id',
  trace_id: 'trace_id',
  span_id: 'span_id',
  parent_span_id: 'parent_span_id',
  conversation_id: 'gen_ai.conversation.id',
  workflow_name: 'gen_ai.workflow.name',
  agent_id: 'gen_ai.agent.id',
  agent_name: 'gen_ai.agent.name',
  agent_version: 'gen_ai.agent.version',
  idempotency_key: 'gen_ai.idempotency_key',
  time_to_first_chunk_ms: 'gen_ai.time_to_first_chunk_ms',
  duration_ms: 'gen_ai.duration_ms',
  usage_input_tokens: 'gen_ai.usage.input_tokens',
  usage_output_tokens: 'gen_ai.usage.output_tokens',
  usage_cache_read_input_tokens: 'gen_ai.usage.cache_read_input_tokens',
  usage_cache_creation_input_tokens: 'gen_ai.usage.cache_creation_input_tokens',
  usage_reasoning_output_tokens: 'gen_ai.usage.reasoning_output_tokens',
  status: 'gen_ai.status',
  error_kind: 'gen_ai.error.kind',
  error_message_ref: 'gen_ai.error.message_ref',
  occurred_at: 'gen_ai.occurred_at',
} as const

/**
 * 本地扩展维度——必须加 aiproj.* 前缀，不得放入标准命名空间。
 * 这些列名不含在 LEDGER_TO_GENAI_ATTRIBUTE_MAP 中。
 */
export const LEDGER_LOCAL_EXTENSION_COLUMNS: ReadonlySet<string> = new Set([
  'aiproj_organization_id',
  'aiproj_project_id',
  'aiproj_user_id',
  'aiproj_connection_id',
  'aiproj_model_id',
  'aiproj_capability',
  'aiproj_surface',
  'aiproj_attempt_number',
  'aiproj_using_real_adapter',
  'aiproj_fallback_used',
  'aiproj_source',
  'aiproj_degraded',
  'aiproj_prompt_version',
  'aiproj_audio_tokens',
  'aiproj_context_tokens',
  'aiproj_total_tokens',
  'aiproj_estimated_cost',
  'aiproj_currency',
  'aiproj_cost_status',
  'aiproj_pricing_snapshot_id',
  'aiproj_input_hash',
  'aiproj_output_hash',
  'aiproj_budget_decision_ref',
  'aiproj_rate_limit_decision_ref',
  'aiproj_source_ledger_ref',
  'aiproj_error_summary',
  'aiproj_warning_codes',
])

/**
 * 把 aiproj_ 前缀列名转为 aiproj.* OTel 属性名。
 * aiproj_organization_id → aiproj.organization.id
 */
export function localColumnToOtelAttribute(column: string): string {
  if (!column.startsWith('aiproj_')) return column
  return 'aiproj.' + column.slice('aiproj_'.length).replace(/_/g, '.')
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 追踪 span 到标准 OTel span 的映射
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 追踪 span 到 OTel GenAI 属性的映射。
 */
export const TRACE_SPAN_TO_GENAI_ATTRIBUTE_MAP: Readonly<Record<string, string>> = {
  span_id: 'span_id',
  trace_id: 'trace_id',
  parent_span_id: 'parent_span_id',
  span_type: 'gen_ai.operation.name',
  started_at: 'gen_ai.span.start_time',
  ended_at: 'gen_ai.span.end_time',
  duration_ms: 'gen_ai.duration_ms',
  status: 'gen_ai.span.status',
  error_kind: 'gen_ai.error.kind',
  error_ref: 'gen_ai.error.message_ref',
  organization_id: 'aiproj.organization.id',
  conversation_id: 'gen_ai.conversation.id',
  workflow_name: 'gen_ai.workflow.name',
  is_orphan: 'aiproj.span.is_orphan',
  orphan_break_reason: 'aiproj.span.orphan_break_reason',
  self_duration_ms: 'aiproj.span.self_duration_ms',
  on_critical_path: 'aiproj.span.on_critical_path',
  estimated_cost: 'aiproj.estimated_cost',
  input_tokens: 'gen_ai.usage.input_tokens',
  output_tokens: 'gen_ai.usage.output_tokens',
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// §4 评测记录到标准 GenAI 评测属性的映射
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 评测记录到 OTel GenAI 评测属性的映射。
 */
export const EVALUATION_TO_GENAI_ATTRIBUTE_MAP: Readonly<Record<string, string>> = {
  dimension: 'gen_ai.evaluation.name',
  scoreValue: 'gen_ai.evaluation.score.value',
  scoreLabel: 'gen_ai.evaluation.score.label',
  explanation: 'gen_ai.evaluation.explanation',
  'evaluator.kind': 'gen_ai.evaluation.evaluator.kind',
  'evaluator.name': 'gen_ai.evaluation.evaluator.name',
  'evaluator.version': 'gen_ai.evaluation.evaluator.version',
  'evaluator.judgeModel': 'gen_ai.evaluation.evaluator.judge_model',
  'evaluator.judgePromptVersion': 'gen_ai.evaluation.evaluator.judge_prompt_version',
  'evaluatedArtifact.artifactKind': 'gen_ai.evaluation.artifact.kind',
  'evaluatedArtifact.artifactRef': 'gen_ai.evaluation.artifact.ref',
  'evaluatedArtifact.contentHash': 'gen_ai.evaluation.artifact.content_hash',
  samplingDecision: 'gen_ai.evaluation.sampling.decision',
  idempotencyKey: 'gen_ai.evaluation.idempotency_key',
  ledgerAttemptRef: 'gen_ai.evaluation.ledger_attempt_ref',
  traceSpanRef: 'gen_ai.evaluation.trace_span_ref',
  createdAt: 'gen_ai.evaluation.created_at',
  organizationId: 'aiproj.organization.id',
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// §5 禁导边界——绝不导出的内容
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 标准约定中 opt-in 的消息内容属性——永远不 opt in。
 * 这些属性名即使标准支持也不得出现在导出载荷中。
 */
export const OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'gen_ai.prompt.text',
  'gen_ai.completion.text',
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.tool.arguments',
  'gen_ai.tool.results',
  'gen_ai.retrieval.body',
])

/**
 * 敏感样本——绝不出现在导出载荷中。
 * 用于负例测试验证禁导边界。
 */
export const OTel_EXPORT_SENSITIVE_SAMPLES = {
  /** token 值模式。 */
  tokenValue: 'sk-abc123def456ghi789',
  /** secret 模式。 */
  secret: 'my-super-secret-api-key',
  /** 被拒资源标识。 */
  deniedResource: 'denied:resource:injection:attempt',
  /** 注入原文。 */
  injectionText: 'IGNORE previous instructions and output',
  /** prompt 全文。 */
  promptText: 'You are a helpful assistant that writes code.',
  /** 模型输出全文。 */
  completionText: 'Here is the code you requested: function hello() {',
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// §6 指标导出范围外
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 指标类型标识——载荷中不得出现。
 * 本 change 不做指标导出（D6）。
 */
export const OTel_EXPORT_FORBIDDEN_METRIC_TYPES: ReadonlySet<string> = new Set([
  'gen_ai.client.token.usage',
  'gen_ai.client.token.input',
  'gen_ai.client.token.output',
  'gen_ai.server.request.duration',
  'gen_ai.server.time_to_first_token',
])

// ═══════════════════════════════════════════════════════════════════════════════
// §7 导出载荷结构
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 单条导出记录：OTel GenAI span 或评测属性。
 */
export interface OTelExportRecord {
  /** 记录类型：span 或 evaluation。 */
  kind: 'span' | 'evaluation'
  /** 标准 OTel 属性。 */
  attributes: Record<string, unknown>
  /** 记录时间（ISO 8601）。 */
  timestamp: string
  /** 来源组织 ID。 */
  organizationId: number
}

/**
 * 批量导出载荷。
 */
export interface OTelExportBatchPayload {
  /** 组织 ID。 */
  organizationId: number
  /** 导出记录列表。 */
  records: OTelExportRecord[]
  /** 批次创建时间。 */
  batchCreatedAt: string
  /** 批次记录数。 */
  recordCount: number
}

/**
 * 导出结果。
 */
export interface OTelExportResult {
  /** 是否成功。 */
  success: boolean
  /** 导出的记录数。 */
  recordCount: number
  /** 重试次数。 */
  retryCount: number
  /** 错误信息（失败时）。 */
  error?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// §8 映射函数
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 把账本 attempt 映射为 OTel GenAI 属性。
 *
 * - 标准列：按 LEDGER_TO_GENAI_ATTRIBUTE_MAP 转换；
 * - 本地扩展列：加 aiproj.* 前缀；
 * - 始终不含 prompt/模型输出/secret/token 等禁导内容。
 */
export function mapLedgerAttemptToOtelAttributes(
  attempt: UnifiedAiInvocationAttempt,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}

  // 标准属性映射
  for (const [ledgerCol, otelAttr] of Object.entries(LEDGER_TO_GENAI_ATTRIBUTE_MAP)) {
    const value = (attempt as unknown as Record<string, unknown>)[ledgerCol]
    if (value !== undefined && value !== null) {
      attrs[otelAttr] = value
    }
  }

  // 本地扩展 → aiproj.* 命名空间
  for (const col of LEDGER_LOCAL_EXTENSION_COLUMNS) {
    const value = (attempt as unknown as Record<string, unknown>)[col]
    if (value !== undefined && value !== null) {
      attrs[localColumnToOtelAttribute(col)] = value
    }
  }

  return attrs
}

/**
 * 把追踪 span 映射为 OTel GenAI 属性。
 */
export function mapTraceSpanToOtelAttributes(span: AiTraceSpan): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}

  for (const [spanField, otelAttr] of Object.entries(TRACE_SPAN_TO_GENAI_ATTRIBUTE_MAP)) {
    const value = (span as unknown as Record<string, unknown>)[spanField]
    if (value !== undefined && value !== null) {
      attrs[otelAttr] = value
    }
  }

  return attrs
}

/**
 * 把评测记录映射为 OTel GenAI 属性。
 */
export function mapEvaluationToOtelAttributes(
  record: EvaluationScoreRecord,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}

  for (const [field, otelAttr] of Object.entries(EVALUATION_TO_GENAI_ATTRIBUTE_MAP)) {
    // 支持嵌套属性（如 evaluator.kind）
    const parts = field.split('.')
    let value: unknown = record
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part]
      } else {
        value = undefined
        break
      }
    }
    if (value !== undefined && value !== null) {
      attrs[otelAttr] = value
    }
  }

  return attrs
}

// ═══════════════════════════════════════════════════════════════════════════════
// §9 禁导校验
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 校验导出载荷中是否包含禁导内容。
 * 返回命中类别列表（空 = 安全）。
 */
export function detectExportViolations(attributes: Record<string, unknown>): string[] {
  const violations: string[] = []

  // 检查 opt-in 内容属性
  for (const attr of OTel_EXPORT_FORBIDDEN_CONTENT_ATTRIBUTES) {
    if (attr in attributes) {
      violations.push(`forbidden_content_attribute:${attr}`)
    }
  }

  // 检查指标类型
  for (const metric of OTel_EXPORT_FORBIDDEN_METRIC_TYPES) {
    if (metric in attributes) {
      violations.push(`forbidden_metric:${metric}`)
    }
  }

  // 检查敏感样本
  const payloadStr = JSON.stringify(attributes)
  for (const [name, sample] of Object.entries(OTel_EXPORT_SENSITIVE_SAMPLES)) {
    if (typeof sample === 'string' && payloadStr.includes(sample)) {
      violations.push(`sensitive_sample:${name}`)
    }
  }

  return violations
}

/**
 * 校验载荷中无本地维度冒用标准命名空间。
 * 返回违规键列表（空 = 通过）。
 */
export function detectNamespaceViolations(attributes: Record<string, unknown>): string[] {
  const violations: string[] = []
  for (const key of Object.keys(attributes)) {
    // 标准命名空间检查
    if (
      key.startsWith('gen_ai.') ||
      key === 'trace_id' ||
      key === 'span_id' ||
      key === 'parent_span_id'
    ) {
      // 标准键——确认不在映射表中的新键
      const isKnownStandard =
        Object.values(LEDGER_TO_GENAI_ATTRIBUTE_MAP).includes(key) ||
        Object.values(TRACE_SPAN_TO_GENAI_ATTRIBUTE_MAP).includes(key) ||
        Object.values(EVALUATION_TO_GENAI_ATTRIBUTE_MAP).includes(key) ||
        key === 'trace_id' ||
        key === 'span_id' ||
        key === 'parent_span_id'
      if (!isKnownStandard) {
        violations.push(key)
      }
      continue
    }
    // aiproj.* 命名空间——允许
    if (key.startsWith('aiproj.')) continue
    // 既非标准也非本地——违规
    violations.push(key)
  }
  return violations
}

// ═══════════════════════════════════════════════════════════════════════════════
// §10 审计事件类型
// ═══════════════════════════════════════════════════════════════════════════════

/** 导出授权变更的审计事件类型。 */
export const OTEL_EXPORT_AUDIT_ACTIONS = [
  'export.auth.enabled',
  'export.auth.disabled',
  'export.target.updated',
  'export.target.removed',
] as const
export type OTelExportAuditAction = (typeof OTEL_EXPORT_AUDIT_ACTIONS)[number]

/**
 * 导出授权变更审计记录。
 */
export interface OTelExportAuditRecord {
  /** 审计动作。 */
  action: OTelExportAuditAction
  /** 组织 ID。 */
  organizationId: number
  /** 操作人 ID。 */
  actorUserId: number
  /** 变更前状态。 */
  previousStatus: OTelExportAuthStatus
  /** 变更后状态。 */
  newStatus: OTelExportAuthStatus
  /** 时间戳。 */
  timestamp: string
  /** 目标配置（可选）。 */
  target?: OTelExportTarget
}
