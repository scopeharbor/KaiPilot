/**
 * v3-unified-ai-invocation-ledger —— 统一 AI 调用账本共享契约。
 *
 * 跨全部 AI 能力面的 per-call 调用账本：
 * - 核心遥测字段按 OpenTelemetry GenAI 语义约定（semconv 1.44.0）命名（snake_case 对齐）；
 * - OTel 未覆盖的本地维度归入显式 `aiproj.*` 命名空间，不得冒充 `gen_ai.*` 标准键；
 * - attempt 生命周期：queued / in_flight / succeeded / failed / aborted / degraded，未知值拒绝；
 * - 低敏红线：默认不持久化 prompt/system instructions/模型输出全文/messages/tool 参数与结果/
 *   检索正文/原始 provider 载荷/token/secret/apiKey/Authorization；正文以 hash/ref/计数/状态表达；
 * - 提供确定性 hash、稳定排序、sanitizer、attempt 生命周期、去重与聚合纯函数，
 *   供后端 recorder 与只读聚合查询使用（本模块不依赖任何运行时/DB/OTel SDK）。
 */
import type { BudgetCostStatus } from './unified-ai-budget.js'

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// §2.2 operation_name —— 已发布枚举（OTel GenAI semconv 1.44.0）
// ---------------------------------------------------------------------------

export const LEDGER_OPERATION_NAMES = [
  'chat',
  'generate_content',
  'text_completion',
  'embeddings',
  'execute_tool',
  'retrieval',
  'invoke_agent',
  'invoke_workflow',
  'create_agent',
] as const
export type LedgerOperationName = (typeof LEDGER_OPERATION_NAMES)[number]

// ---------------------------------------------------------------------------
// §2.3 provider_name —— 已发布 provider 词汇 + 受控扩展
// ---------------------------------------------------------------------------

export const LEDGER_PROVIDER_NAMES = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'azure_openai',
  'aws_bedrock',
  'ollama',
  'mistral',
  'cohere',
  'mock',
  'openai-compatible',
  'anthropic-compatible',
  'unknown',
] as const
export type LedgerProviderName = (typeof LEDGER_PROVIDER_NAMES)[number]

/** 受控扩展：provider 不在已发布词汇时使用字符串形式（允许受控扩展）。 */
export type LedgerProviderNameOrExtension = LedgerProviderName | (string & {})

// ---------------------------------------------------------------------------
// §2.11 attempt 状态生命周期 —— 未知值拒绝
// ---------------------------------------------------------------------------

export const LEDGER_ATTEMPT_STATUSES = [
  'queued',
  'in_flight',
  'succeeded',
  'failed',
  'aborted',
  'degraded',
] as const
export type LedgerAttemptStatus = (typeof LEDGER_ATTEMPT_STATUSES)[number]

// ---------------------------------------------------------------------------
// §2.12 error_kind —— 复用 AiM0ErrorKind 语义并补充账本专用分类
// ---------------------------------------------------------------------------

/** 复用既有 AiM0ErrorKind 六类语义。 */
export const LEDGER_ERROR_KINDS_M0 = [
  'truncated',
  'malformed_json',
  'field_missing_or_type_error',
  'token_limit_exceeded',
  'sse_interrupted',
  'model_refusal_or_empty',
  'repetition_loop',
] as const

/** 账本/桥接专用补充分类。 */
export const LEDGER_ERROR_KINDS_EXTENDED = [
  'provider_auth',
  'provider_timeout',
  'provider_rate_limit',
  'provider_unavailable',
  'malformed_response',
  'capability_mismatch',
  'serialization_error',
  'storage_error',
  'unknown',
] as const

export const LEDGER_ERROR_KINDS = [
  ...LEDGER_ERROR_KINDS_M0,
  ...LEDGER_ERROR_KINDS_EXTENDED,
] as const
export type LedgerErrorKind = (typeof LEDGER_ERROR_KINDS)[number]

// ---------------------------------------------------------------------------
// §2.13/§2.14 低敏 sanitizer —— 禁存键与自由元数据 allowlist
// ---------------------------------------------------------------------------

/** 禁止键类别（sanitizer 拒绝/红act 分类）。 */
export const LEDGER_FORBIDDEN_KEY_CATEGORIES = [
  'prompt',
  'system_instruction',
  'completion',
  'messages',
  'tool_arguments',
  'tool_results',
  'retrieval_body',
  'provider_payload',
  'api_key',
  'authorization',
  'token',
  'secret',
] as const
export type LedgerForbiddenKeyCategory = (typeof LEDGER_FORBIDDEN_KEY_CATEGORIES)[number]

/**
 * 结构化 DTO 允许键集合（白名单）。
 *
 * 目的：`prompt_name` / `usage_input_tokens` 等标准字段名含 "prompt"/"token" 子串，
 * 不能被字符串子串式禁止键规则误伤——禁止键规则面向**自由形式元数据/内容载荷**；
 * 而结构化 DTO 只能携带本白名单内的低敏字段，任何白名单之外的键（如 promptText /
 * completionText / apiKey）一律拒绝，从结构上封死内容落盘路径。
 */
export const LEDGER_DTO_ALLOWED_KEYS: ReadonlySet<string> = new Set([
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
  'status',
  'error_kind',
  'error_message_ref',
  'aiproj_degraded',
  'operation_name',
  'provider_name',
  'request_model',
  'response_model',
  'response_id',
  'finish_reasons',
  'output_type',
  'prompt_name',
  'aiproj_prompt_version',
  'tool_name',
  'tool_type',
  'tool_call_id',
  'data_source_id',
  'trace_id',
  'span_id',
  'parent_span_id',
  'conversation_id',
  'workflow_name',
  'agent_id',
  'agent_name',
  'agent_version',
  'idempotency_key',
  'time_to_first_chunk_ms',
  'duration_ms',
  'usage_input_tokens',
  'usage_output_tokens',
  'usage_cache_read_input_tokens',
  'usage_cache_creation_input_tokens',
  'usage_reasoning_output_tokens',
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
  'occurred_at',
  'aiproj_error_summary',
  'aiproj_warning_codes',
])

/** 找出结构化 DTO 中白名单之外的键（→ 内容型载荷嫌疑，拒绝落盘）。 */
export function ledgerFindDisallowedKeys(attempt: unknown): string[] {
  if (!attempt || typeof attempt !== 'object') return []
  const keys = Object.keys(attempt as Record<string, unknown>)
  return keys.filter((key) => !LEDGER_DTO_ALLOWED_KEYS.has(key))
}

/**
 * 禁止键正则表。任何元数据键命中任一模式即整个对象被拒绝/过滤。
 * 采用安全拒绝（子串近似）而非精确匹配：宁可多拒也不放行内容型键。
 * 注意：本 sanitizer 用于**自由形式元数据/内容载荷**，不用于结构化 DTO——
 * 结构化 DTO 的 `prompt_name`/`usage_*_tokens` 等标准字段是类型安全且低敏的，不走本过滤器。
 * 自由形式元数据一律按 allowlist 过滤（ref / hash / tokenCount / errorCode / status / id）。
 */
export const LEDGER_FORBIDDEN_KEY_PATTERNS: ReadonlyArray<{
  category: LedgerForbiddenKeyCategory
  pattern: RegExp
}> = [
  { category: 'prompt', pattern: /prompt/i },
  { category: 'system_instruction', pattern: /(system[-_.]?instruction|sys[-_.]?prompt)/i },
  {
    category: 'completion',
    pattern: /((^|[-_.])completion|completionText|outputText|responseText|(^|[-_.])content)/i,
  },
  { category: 'messages', pattern: /(^|[-_.])messages?($|[-_.])/i },
  { category: 'tool_arguments', pattern: /tool[-_.]?(args?|arguments|input|parameters)/i },
  { category: 'tool_results', pattern: /tool[-_.]?(result|results|output|response|body)/i },
  { category: 'retrieval_body', pattern: /retriev(al|ed)[-_.]?(body|document|content|text)/i },
  {
    category: 'provider_payload',
    pattern: /(raw[-_.]?(body|payload)|provider[-_.]?(body|payload|response))/i,
  },
  { category: 'api_key', pattern: /api[-_.]?key/i },
  { category: 'authorization', pattern: /(authorization|auth[-_.]?header)/i },
  { category: 'token', pattern: /token/i },
  { category: 'secret', pattern: /(secret|password|passphrase)/i },
]

/** 自由元数据 allowlist：只允许低敏键存活。 */
export const LEDGER_METADATA_ALLOWLIST = [
  'ref',
  'hash',
  'tokenCount',
  'errorCode',
  'status',
  'id',
  'attemptNumber',
  'sourceLedgerRef',
] as const
export type LedgerMetadataAllowKey = (typeof LEDGER_METADATA_ALLOWLIST)[number]

/** 校验一个键是否命中禁止类别；未命中返回 null。 */
export function ledgerForbiddenCategory(key: string): LedgerForbiddenKeyCategory | null {
  for (const entry of LEDGER_FORBIDDEN_KEY_PATTERNS) {
    if (entry.pattern.test(key)) return entry.category
  }
  return null
}

/**
 * 自由形式元数据脱敏：allowlist 过滤，只保留允许的低敏键。
 * 返回新对象，绝不修改入参。
 */
export function sanitizeLedgerMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) return null
  const allowed = new Set<string>(LEDGER_METADATA_ALLOWLIST)
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (allowed.has(key)) safe[key] = value
  }
  return safe
}

/**
 * 深度扫描任意记录中的禁止内容键，返回命中类别列表（去重、稳定排序）。
 * 用于 recorder 输入的整体体检：任何命中都应在落盘前拒绝或过滤。
 */
export function ledgerDetectForbiddenKeys(
  input: Record<string, unknown> | null | undefined,
): LedgerForbiddenKeyCategory[] {
  if (!input) return []
  const found = new Set<LedgerForbiddenKeyCategory>()
  const walk = (value: unknown, keyPrefix: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, keyPrefix)
      return
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const fullKey = keyPrefix ? `${keyPrefix}.${k}` : k
        const category = ledgerForbiddenCategory(fullKey)
        if (category) found.add(category)
        walk(v, fullKey)
      }
    }
  }
  walk(input, '')
  return [...found].sort()
}

/** 断言无禁止内容；返回布尔（不抛错），供 guard 使用。 */
export function ledgerHasForbiddenKeys(input: Record<string, unknown> | null | undefined): boolean {
  return ledgerDetectForbiddenKeys(input).length > 0
}

// ---------------------------------------------------------------------------
// §2.22 确定性 hash 与稳定排序 helpers
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit 十六进制（确定性、可复现）。 */
export function ledgerFnv1aHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** 稳定排序：对任意对象键做递归稳定排序后 JSON 序列化。 */
export function ledgerStableSerialize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => ledgerStableSerialize(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const parts = keys.map((k) => `${JSON.stringify(k)}:${ledgerStableSerialize(record[k])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

/** 内容指纹（input_hash / output_hash 用）：sha256 前 12 hex。 */
export function computeLedgerContentHash(content: unknown, salt?: string | null): string {
  const raw = salt ? `${salt}::${ledgerStableSerialize(content)}` : ledgerStableSerialize(content)
  return createHash('sha256').update(raw).digest('hex').slice(0, 12)
}

/** 与既有 OCR 账本保持同源语义：输入/输出 hash 前缀稳定。 */
export function computeLedgerInputHash(input: unknown): string {
  return computeLedgerContentHash(input, 'ledger:input')
}

export function computeLedgerOutputHash(output: unknown): string {
  return computeLedgerContentHash(output, 'ledger:output')
}

// ---------------------------------------------------------------------------
// §2.4/2.5/2.6/2.7/2.8/2.9 核心尝试记录 DTO
// ---------------------------------------------------------------------------

/**
 * 一次模型调用 attempt 的低敏记录（统一账本行）。
 *
 * 字段命名规则：
 * - 标准字段：按 OTel GenAI semconv 对齐（`usage_input_tokens`、`request_model`…）；
 * - 本地扩展字段：一律带 `aiproj_` 前缀（对应 `aiproj.*` 命名空间），
 *   任何本地扩展都不得以 `gen_ai.*` 键名输出（见 `serializeLedgerAttributes` 与测试）。
 *
 * 红线：不存 prompt、system instructions、模型输出全文、messages、tool 参数/结果、
 * 检索正文、原始 provider 载荷、token、secret、apiKey、Authorization。
 */
export interface UnifiedAiInvocationAttempt {
  // ── 归属与身份（本地扩展命名空间） ──
  aiproj_organization_id: number
  aiproj_project_id: number | null
  aiproj_user_id: number | null
  aiproj_connection_id: number | null
  aiproj_model_id: number | null
  /** 能力面：draft / risk / prediction / recommendation / report / triz / pmo / ocr / resources / health / compiler / knowledge / skill-eval / general */
  aiproj_capability: string
  /** 面：copilot / compiler / ocr / draft / risk / prediction / recommendation / report / triz / pmo / knowledge / skill-eval / general */
  aiproj_surface: string
  aiproj_attempt_number: number
  aiproj_using_real_adapter: boolean
  aiproj_fallback_used: boolean
  aiproj_source: 'user' | 'fallback' | 'mock' | 'unknown'

  // ── 生命周期 ──
  status: LedgerAttemptStatus
  error_kind: LedgerErrorKind | 'none'
  error_message_ref: string | null
  aiproj_degraded: boolean

  // ── 标准遥测字段（gen_ai.* 对齐名） ──
  operation_name: LedgerOperationName
  provider_name: LedgerProviderNameOrExtension
  request_model: string
  response_model: string | null
  response_id: string | null
  finish_reasons: string[]
  output_type: 'text' | 'json' | 'tool_call' | 'embedding' | 'audio' | 'image' | 'unknown' | null
  prompt_name: string | null
  /** prompt 版本（本地扩展，对齐 aiproj_ 命名空间）。null = 未注册。 */
  aiproj_prompt_version: string | null
  tool_name: string | null
  tool_type: string | null
  tool_call_id: string | null
  data_source_id: string | null
  trace_id: string | null
  span_id: string | null
  parent_span_id: string | null
  conversation_id: string | null
  workflow_name: string | null
  agent_id: string | null
  agent_name: string | null
  agent_version: string | null
  idempotency_key: string | null

  // ── 延迟与用量 ──
  time_to_first_chunk_ms: number | null
  duration_ms: number | null
  usage_input_tokens: number | null
  usage_output_tokens: number | null
  usage_cache_read_input_tokens: number | null
  usage_cache_creation_input_tokens: number | null
  usage_reasoning_output_tokens: number | null
  /** 本地扩展（OCR 对账用）：音频/上下文/总 token。 */
  aiproj_audio_tokens: number | null
  aiproj_context_tokens: number | null
  aiproj_total_tokens: number | null

  // ── 成本估算（本地扩展命名空间） ──
  aiproj_estimated_cost: number | null
  aiproj_currency: string | null
  aiproj_cost_status: BudgetCostStatus | null
  aiproj_pricing_snapshot_id: string | null

  // ── 内容指纹与决策引用 ──
  aiproj_input_hash: string | null
  aiproj_output_hash: string | null
  aiproj_budget_decision_ref: string | null
  aiproj_rate_limit_decision_ref: string | null

  // ── 桥接（§5） ──
  /** 标记记录是否同时存在于 Compiler 或 OCR 账本；如 compiler:cost_event:artifact:x / ocr:attempt:123 / null。 */
  aiproj_source_ledger_ref: string | null

  // ── 时间 ──
  occurred_at: string
}

/** 用于「缺失上下文时显式 unknown 标记」的常量。 */
export const LEDGER_UNKNOWN_MARKER = 'unknown'

export const LEDGER_MISSING_ATTRIBUTE: string | null = null

// ---------------------------------------------------------------------------
// §2.10 本地扩展命名空间守卫
// ---------------------------------------------------------------------------

/** 本地扩展前缀（对应 `aiproj.*` 命名空间）。 */
export const LEDGER_LOCAL_ATTRIBUTE_PREFIX = 'aiproj_'

/** 标准键前缀（gen_ai.* 对齐名；本契约里不直接存 `gen_ai.` 前缀，落库用裸名）。 */
export const LEDGER_STANDARD_ATTRIBUTE_KEYS = [
  'operation_name',
  'provider_name',
  'request_model',
  'response_model',
  'response_id',
  'finish_reasons',
  'output_type',
  'prompt_name',
  'tool_name',
  'tool_type',
  'tool_call_id',
  'data_source_id',
  'trace_id',
  'span_id',
  'parent_span_id',
  'conversation_id',
  'workflow_name',
  'agent_id',
  'agent_name',
  'agent_version',
  'idempotency_key',
  'time_to_first_chunk_ms',
  'duration_ms',
  'usage_input_tokens',
  'usage_output_tokens',
  'usage_cache_read_input_tokens',
  'usage_cache_creation_input_tokens',
  'usage_reasoning_output_tokens',
  'status',
  'error_kind',
  'error_message_ref',
  'occurred_at',
] as const

/**
 * 把 attempt 记录序列化为扁平 attribute map（key → value）。
 *
 * - 标准键：裸名输出（与 OTel 属性名对齐，去掉 `gen_ai.` 前缀，落库列名直接用）；
 * - 本地扩展键：保留 `aiproj_` 前缀（`aiproj.*` 命名空间）；
 * - 任何本地扩展都不得被改写成 `gen_ai.*` 键名（测试强制）。
 */
export function serializeLedgerAttributes(
  attempt: UnifiedAiInvocationAttempt,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of LEDGER_STANDARD_ATTRIBUTE_KEYS) {
    if (key in attempt) {
      const value = (attempt as unknown as Record<string, unknown>)[key]
      if (value !== undefined) out[key] = value
    }
  }
  for (const [key, value] of Object.entries(attempt)) {
    if (
      LEDGER_STANDARD_ATTRIBUTE_KEYS.includes(
        key as (typeof LEDGER_STANDARD_ATTRIBUTE_KEYS)[number],
      )
    )
      continue
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * 校验本地扩展命名空间：任何本地扩展键必须以 `aiproj_` 开头，
 * 任何本地扩展都不得以 `gen_ai.` 键名输出。返回违规键列表（空 = 通过）。
 */
export function ledgerFindNamespacingViolations(attributes: Record<string, unknown>): string[] {
  const violations: string[] = []
  for (const key of Object.keys(attributes)) {
    if (key.startsWith('gen_ai.')) {
      // 若是标准键的 OTel 直写形式，也仅允许映射表内的裸名（不允许发明新键）。
      violations.push(key)
      continue
    }
    if (
      key.startsWith('aiproj_') ||
      LEDGER_STANDARD_ATTRIBUTE_KEYS.includes(
        key as (typeof LEDGER_STANDARD_ATTRIBUTE_KEYS)[number],
      )
    )
      continue
    violations.push(key)
  }
  return violations
}

// ---------------------------------------------------------------------------
// §2.11 状态守卫 —— 未知状态拒绝
// ---------------------------------------------------------------------------

export function isLedgerAttemptStatus(value: string): value is LedgerAttemptStatus {
  return LEDGER_ATTEMPT_STATUSES.includes(value as LedgerAttemptStatus)
}

export function assertLedgerAttemptStatus(value: string): LedgerAttemptStatus {
  if (!isLedgerAttemptStatus(value)) {
    throw new Error(`未知 attempt 状态：${value}（允许值：${LEDGER_ATTEMPT_STATUSES.join(', ')}）`)
  }
  return value
}

export function isLedgerOperationName(value: string): value is LedgerOperationName {
  return LEDGER_OPERATION_NAMES.includes(value as LedgerOperationName)
}

export function assertLedgerOperationName(value: string): LedgerOperationName {
  if (!isLedgerOperationName(value)) {
    throw new Error(`未知 operation_name：${value}`)
  }
  return value
}

export function isLedgerErrorKind(value: string): value is LedgerErrorKind {
  return LEDGER_ERROR_KINDS.includes(value as LedgerErrorKind)
}

/** 把 provider 错误分类归一为账本 error_kind（复用 OCR normalize 语义）。 */
export function normalizeLedgerErrorKind(
  value: string | null | undefined,
): LedgerErrorKind | 'none' {
  if (!value || value === 'none') return 'none'
  const lower = value.toLowerCase()
  if (lower.includes('repetition')) return 'repetition_loop'
  if (lower.includes('auth')) return 'provider_auth'
  if (lower.includes('timeout') || lower.includes('stall')) return 'provider_timeout'
  if (lower.includes('rate')) return 'provider_rate_limit'
  if (lower.includes('unavailable') || lower.includes('unreachable')) return 'provider_unavailable'
  if (lower.includes('malformed') || lower.includes('parse')) return 'malformed_response'
  if (lower.includes('capability') || lower.includes('mismatch')) return 'capability_mismatch'
  if (lower.includes('truncat')) return 'truncated'
  if (lower.includes('token')) return 'token_limit_exceeded'
  if (lower.includes('interrupt') || lower.includes('sse')) return 'sse_interrupted'
  if (lower.includes('refus') || lower.includes('empty')) return 'model_refusal_or_empty'
  if (lower.includes('serial')) return 'serialization_error'
  if (lower.includes('storage') || lower.includes('db')) return 'storage_error'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// §4.6 attempt 重试分组语义
// ---------------------------------------------------------------------------

/** 重试分组：同一逻辑调用（同 idempotency_key）按 attempt_number 升序。 */
export function groupLedgerAttemptsByRetry(
  attempts: UnifiedAiInvocationAttempt[],
): Map<string, UnifiedAiInvocationAttempt[]> {
  const groups = new Map<string, UnifiedAiInvocationAttempt[]>()
  for (const attempt of attempts) {
    const key =
      attempt.idempotency_key ?? `no-ik:${attempt.occurred_at}:${attempt.aiproj_attempt_number}`
    const list = groups.get(key) ?? []
    list.push(attempt)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.aiproj_attempt_number ?? 0) - (b.aiproj_attempt_number ?? 0))
  }
  return groups
}

// ---------------------------------------------------------------------------
// §5.1 source_ledger_ref 语义 + §5.3 聚合去重
// ---------------------------------------------------------------------------

/** 来源账本类型。 */
export type LedgerSourceKind = 'compiler' | 'ocr' | 'none'

export function parseSourceLedgerRef(ref: string | null): {
  kind: LedgerSourceKind
  id: string | null
} {
  if (!ref) return { kind: 'none', id: null }
  if (ref.startsWith('compiler:')) return { kind: 'compiler', id: ref.slice('compiler:'.length) }
  if (ref.startsWith('ocr:')) return { kind: 'ocr', id: ref.slice('ocr:'.length) }
  return { kind: 'none', id: ref }
}

/**
 * 去重语义：同一逻辑调用在统一账本与来源账本（Compiler/OCR）各有记录时只计一次。
 * 输入为统一账本行 + 来源账本行；按 idempotency_key 去重（无 key 时按 source_ledger_ref 去重）。
 */
export function dedupeLedgerAndSourceRows(
  unifiedRows: UnifiedAiInvocationAttempt[],
  sourceRows: Array<{
    idempotencyKey: string | null
    sourceRef: string | null
    cost: number | null
  }>,
): { unifiedCount: number; sourceCount: number; dedupedTotal: number; totalCost: number } {
  const unifiedKeys = new Set<string>()
  for (const row of unifiedRows) {
    if (row.idempotency_key) unifiedKeys.add(row.idempotency_key)
    else if (row.aiproj_source_ledger_ref) unifiedKeys.add(`ref:${row.aiproj_source_ledger_ref}`)
  }
  let sourceCount = 0
  let overhead = 0
  let totalCost = 0
  for (const row of sourceRows) {
    sourceCount++
    const dedupeKey = row.idempotencyKey
      ? row.idempotencyKey
      : row.sourceRef
        ? `ref:${row.sourceRef}`
        : null
    if (dedupeKey && unifiedKeys.has(dedupeKey)) {
      // 已在统一账本中计了一次；来源行不重复计。
      overhead++
    }
    totalCost += row.cost ?? 0
  }
  for (const row of unifiedRows) {
    totalCost += row.aiproj_estimated_cost ?? 0
  }
  return {
    unifiedCount: unifiedRows.length,
    sourceCount,
    dedupedTotal: unifiedRows.length + (sourceCount - overhead),
    totalCost,
  }
}

// ---------------------------------------------------------------------------
// §6.1/6.2/6.9 只读聚合纯函数（聚合 service 复用）
// ---------------------------------------------------------------------------

export type LedgerAggregationDimension =
  'organization' | 'project' | 'user' | 'capability' | 'model'

export interface LedgerAggregationBucket {
  dimension: LedgerAggregationDimension
  groupKey: string
  attemptCount: number
  succeededCount: number
  failedCount: number
  degradedCount: number
  abortedCount: number
  retriedLogicalCalls: number
  failureRate: number | null
  degradationRate: number | null
  totalLatencyMs: number
  avgLatencyMs: number | null
  totalInputTokens: number | null
  totalOutputTokens: number | null
  totalTokens: number | null
  estimatedCost: number | null
  currency: string | null
  costStatus: 'estimated' | 'cost_unknown' | 'unavailable' | 'zero' | 'unknown'
}

export interface LedgerAggregationResult {
  dimension: LedgerAggregationDimension
  buckets: LedgerAggregationBucket[]
  /** 有界窗口 [start, end]，ISO 字符串。 */
  windowStart: string
  windowEnd: string
  empty: boolean
  /** 成本为估算而非计费金额。 */
  costLabel: 'estimate'
}

/** 每个维度从 attempt 行提取分组键。 */
export function ledgerGroupKeyForDimension(
  dimension: LedgerAggregationDimension,
  attempt: UnifiedAiInvocationAttempt,
): string {
  switch (dimension) {
    case 'organization':
      return String(attempt.aiproj_organization_id)
    case 'project':
      return attempt.aiproj_project_id != null
        ? String(attempt.aiproj_project_id)
        : LEDGER_UNKNOWN_MARKER
    case 'user':
      return attempt.aiproj_user_id != null ? String(attempt.aiproj_user_id) : LEDGER_UNKNOWN_MARKER
    case 'capability':
      return attempt.aiproj_capability || LEDGER_UNKNOWN_MARKER
    case 'model':
      return attempt.request_model || LEDGER_UNKNOWN_MARKER
  }
}

/** 有界窗口：默认最近 N 天，禁止无界扫描。 */
export function defaultLedgerWindowBounds(
  days: number = 30,
  now: Date = new Date(),
): { startIso: string; endIso: string } {
  const end = new Date(now.getTime())
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

/**
 * 只读聚合：按维度 rollup 成本/token/延迟/失败率/降级率。
 * 纯函数，无 DB 依赖；空窗口返回显式 empty=true（而不是零故障假象）。
 */
export function aggregateLedgerAttempts(
  attempts: UnifiedAiInvocationAttempt[],
  dimension: LedgerAggregationDimension,
  window: { startIso: string; endIso: string },
): LedgerAggregationResult {
  const inWindow = attempts.filter(
    (a) => a.occurred_at >= window.startIso && a.occurred_at <= window.endIso,
  )
  const bucketsMap = new Map<string, LedgerAggregationBucket>()

  const retryGroups = groupLedgerAttemptsByRetry(inWindow)
  const retriedGroupKeys = new Map<string, number>()
  for (const group of retryGroups.values()) {
    if (group.length > 1) {
      const groupKey = ledgerGroupKeyForDimension(dimension, group[0]!)
      retriedGroupKeys.set(groupKey, (retriedGroupKeys.get(groupKey) ?? 0) + 1)
    }
  }

  for (const attempt of inWindow) {
    const groupKey = ledgerGroupKeyForDimension(dimension, attempt)
    let bucket = bucketsMap.get(groupKey)
    if (!bucket) {
      bucket = {
        dimension,
        groupKey,
        attemptCount: 0,
        succeededCount: 0,
        failedCount: 0,
        degradedCount: 0,
        abortedCount: 0,
        retriedLogicalCalls: retriedGroupKeys.get(groupKey) ?? 0,
        failureRate: null,
        degradationRate: null,
        totalLatencyMs: 0,
        avgLatencyMs: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        estimatedCost: null,
        currency: null,
        costStatus: 'unknown',
      }
      bucketsMap.set(groupKey, bucket)
    }
    bucket.attemptCount++
    if (attempt.status === 'succeeded') bucket.succeededCount++
    if (attempt.status === 'failed') bucket.failedCount++
    if (attempt.status === 'degraded' || attempt.aiproj_degraded) bucket.degradedCount++
    if (attempt.status === 'aborted') bucket.abortedCount++
    bucket.totalLatencyMs += attempt.duration_ms ?? 0
    bucket.totalInputTokens = (bucket.totalInputTokens ?? 0) + (attempt.usage_input_tokens ?? 0)
    bucket.totalOutputTokens = (bucket.totalOutputTokens ?? 0) + (attempt.usage_output_tokens ?? 0)
    bucket.totalTokens =
      (bucket.totalTokens ?? 0) +
      (attempt.aiproj_total_tokens ?? attempt.usage_input_tokens ?? 0) +
      (attempt.usage_output_tokens ?? 0)
    if (attempt.aiproj_estimated_cost != null) {
      bucket.estimatedCost = (bucket.estimatedCost ?? 0) + attempt.aiproj_estimated_cost
    }
    bucket.currency = attempt.aiproj_currency ?? bucket.currency
    const costStatus = attempt.aiproj_cost_status
    if (costStatus && costStatus !== 'unknown') {
      bucket.costStatus = costStatus as LedgerAggregationBucket['costStatus']
    }
  }

  const buckets = [...bucketsMap.values()].sort((a, b) => a.groupKey.localeCompare(b.groupKey))
  for (const bucket of buckets) {
    bucket.failureRate =
      bucket.attemptCount > 0 ? round3(bucket.failedCount / bucket.attemptCount) : null
    bucket.degradationRate =
      bucket.attemptCount > 0 ? round3(bucket.degradedCount / bucket.attemptCount) : null
    bucket.avgLatencyMs =
      bucket.attemptCount > 0 ? Math.round(bucket.totalLatencyMs / bucket.attemptCount) : null
    if (bucket.estimatedCost == null) bucket.costStatus = 'unavailable'
  }

  return {
    dimension,
    buckets,
    windowStart: window.startIso,
    windowEnd: window.endIso,
    empty: inWindow.length === 0,
    costLabel: 'estimate',
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

// ---------------------------------------------------------------------------
// §5.5 OCR 场景窗口计数（与 ocr_rate_limit_guard 现有计数一致）
// ---------------------------------------------------------------------------

/**
 * 从统一账本行计算窗口内 RPM/TPM（与 ocr_rate_limit_guard 的计数口径一致：
 * 排除 budget_blocked / skipped / queued / in_flight / aborted 状态）。
 */
export function computeLedgerWindowCounts(
  attempts: UnifiedAiInvocationAttempt[],
  windowStartIso: string,
): { rpm: number; tpm: number } {
  let rpm = 0
  let tpm = 0
  for (const a of attempts) {
    if (a.occurred_at < windowStartIso) continue
    if (['queued', 'in_flight', 'aborted'].includes(a.status)) continue
    rpm++
    tpm += a.usage_input_tokens ?? 0
    tpm += a.usage_output_tokens ?? 0
  }
  return { rpm, tpm }
}
