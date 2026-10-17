/**
 * ai-structured-output-poc / M0 —— AIGateway + Adapter 抽象。
 *
 * 依据 spec「M0 通过判定必须以完整链路为前提」+ design D3「Adapter 一层抽象封装 Provider 差异」：
 *   - Provider 切换只换 Adapter 实现，`AIGateway` / schema / 校验 / 恢复层不变；
 *   - 三种 Schema 约束策略（P/N/T）由本层选择 Prompt 与 SDK 调用方式；
 *   - SSE 流式作为一等公民：Adapter 必须能返回 AsyncIterable，非流式端点内部聚合即可。
 *
 * 未实装的 Provider（本次只落 OpenAI + Mock）通过实现 `Adapter` 接口接入，
 * 网关层不感知 SDK 细节；MockAdapter 用于无 key 联调，spec 禁用其结果作为 M0 判定依据。
 */

import type { AiM0Strategy, AiM0ErrorKind, AiProjectDraft, OcrProviderUsage } from '@aiproj/types'
import { normalizeLedgerErrorKind, type UnifiedAiInvocationAttempt } from '@aiproj/types'

/** 账本 recorder 依赖接口（由 resolver 接线注入；测试可免数据库）。 */
export interface LedgerAttemptRecorder {
  record(attempt: UnifiedAiInvocationAttempt): Promise<string | null>
}

/**
 * 调用上下文（§4.4）：组织/项目/用户/能力面/面/会话/追踪标识。
 * 缺失时以显式 unknown 值落账而非静默丢弃。
 */
export interface LedgerRecordContext {
  organizationId?: number | null
  projectId?: number | null
  userId?: number | null
  connectionId?: number | null
  modelId?: number | null
  capability?: string | null
  surface?: string | null
  conversationId?: string | null
  traceId?: string | null
  spanId?: string | null
  parentSpanId?: string | null
  workflowName?: string | null
  idempotencyKey?: string | null
  attemptNumber?: number
  operationName?: UnifiedAiInvocationAttempt['operation_name']
  source?: 'user' | 'fallback' | 'mock' | 'unknown'
  sourceLedgerRef?: string | null
  /**
   * TPM preflight 产出的限流决策标识（v3-copilot-live-submission-channel §8.7）。
   *
   * 此前 `aiproj_rate_limit_decision_ref` 硬编码 null，导致账本记录与限流决策
   * 无法互相追溯，postflight 也拿不到 decisionId 去结算——预估与实际的偏差因此
   * 从来没有被记下来过。这里把 preflight 的 decisionId 一路带到落账点。
   */
  rateLimitDecisionId?: string | null
}

/**
 * 限流结算依赖接口（§8.7）。
 *
 * 用**既有** `RateLimitGuard.postflight` 结算，把偏差写回既有
 * `rate_limit_decisions` 表——不新建偏差表（tasks 8.7 明确要求）。
 * 定义成窄接口是为了让 gateway 不依赖具体守卫实现，测试可免数据库。
 */
export interface RateLimitTokenSettler {
  postflight(input: { decisionId: string; actualTokens: number }): Promise<unknown>
}

/** 一次生成的输入契约。 */
export interface GenerateOptions {
  /** 一句话简体中文项目描述，来自评测集或前端表单。 */
  sentence: string
  /** Product-specific prompt override. When omitted, adapters build the legacy M0 prompt. */
  promptSet?: {
    systemPrompt: string
    userPrompt: string
  }
  /** Schema 约束策略（P/N/T）——由本层决定 Prompt 拼装与 SDK 调用形态。 */
  strategy: AiM0Strategy
  /** 可选：温度、最大 token、请求超时（若未设，走 env 默认值）。 */
  temperature?: number
  maxOutputTokens?: number
  requestTimeoutMs?: number
  /** 结构化 schema 的 JSON Schema 形式（策略 N 需要），可选。 */
  jsonSchema?: Record<string, unknown>
  /** 用户可传的 abort signal，允许前端 UI 中止生成。 */
  signal?: AbortSignal
  /** 账本：本次调用在同一逻辑请求内的尝试序号（1 起，重试递增）；缺省取调用上下文。 */
  attemptNumber?: number
  /** 账本：低敏 prompt 类别（如 `draft.wbs_tasks.branch`），用于统计哪类 prompt 易出问题。 */
  promptName?: string
  /** 可选：generate() 聚合时逐块回传模型原始输出（实时输出面板用）；回调抛错不影响本次调用。 */
  onText?: (text: string) => void
  /** 可选：推理模型的思考过程（reasoning_content / thinking）逐块回传，仅供实时面板展示。 */
  onReasoning?: (text: string) => void
}

/** 单个流片段。同时承载业务观测所需元数据：首 token 到达时刻、错误恢复等。
 * `text` 段是模型 raw 输出（策略 P 为 JSON 文本，策略 N/T 由 Adapter 已解 tool_call 后的 JSON 字符串）。
 * `done` 段可携带 `usage` 汇总信息（来自 stream_options.include_usage）。
 */
export interface StreamChunk {
  /** reasoning = 推理模型的思考过程（不计入 rawText，只供实时面板展示）。 */
  kind: 'text' | 'reasoning' | 'done' | 'error'
  text?: string
  errorKind?: AiM0ErrorKind
  errorMessage?: string
  /** 最终汇总的 token 使用量（仅 done 事件携带）。 */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    /** v3-unified-ai-invocation-ledger §4.2：采集 finish_reasons（adapter 有则填）。 */
    finishReasons?: string[]
    /** v3-unified-ai-invocation-ledger §4.2：采集 response_id（adapter 有则填）。 */
    responseId?: string
    /** Provider 响应实际报告的模型标识；与请求模型分开落账。 */
    responseModel?: string
    /** 推理 token（completion_tokens_details.reasoning_tokens，已计入 outputTokens）。 */
    reasoningTokens?: number
  }
  /** SSE 断点续传语义：Adapter 侧的服务器事件 id（openai 无原生，本 POC 自造递增序号）。 */
  eventId?: string
}

/** Lightweight provider reachability check. Must not use product-generation prompts. */
export interface AdapterPingResult {
  ok: boolean
  errorKind?: string
  errorMessage?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

export interface OcrPreviewOptions {
  imageDataUrl: string
  promptHint?: string | null
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface AdapterOcrPreviewResult {
  ok: boolean
  extractedText?: string
  errorKind?: string
  errorMessage?: string
  usage?: OcrProviderUsage
}

/** 完整结果（供非流式端点直接返回）。 */
export interface GenerateResult {
  /** 拼装后的原始文本；策略 N/T 已是纯 JSON 字符串。 */
  rawText: string
  /** 触发的错误分类（未触发即空数组）。 */
  triggeredErrors: AiM0ErrorKind[]
  /**
   * 对应的原始错误说明。分类是个只有六个取值的闭集，`malformed_json` 更是所有
   * 未识别 SDK 异常的兜底桶——只把分类往上抛，调用方与用户都无从判断到底出了什么事。
   */
  triggeredErrorMessages?: string[]
  /** 输出 token 估算（若 Provider 返回 usage，则用真实值；否则 null）。 */
  outputTokens: number | null
  /** 首 token 到达延迟（ms）。 */
  firstTokenMs: number
  /** 完整生成延迟（ms）。 */
  totalMs: number
  /** 是否真实 Adapter（false 时 spec 禁止入判定）。 */
  usingRealAdapter: boolean
}

/**
 * 原生工具调用（function calling / tool use）的请求形态。
 *
 * - `openai_chat`：Chat Completions，`tools: [{ type: 'function', function: { name, description, parameters } }]`，
 *   结果在 `choices[0].message.tool_calls[].function.{name, arguments}`；
 * - `openai_responses`：Responses API，扁平 `tools: [{ type: 'function', name, description, parameters, strict }]`，
 *   结果为 `output[]` 中 `type: 'function_call'` 的项（`call_id` / `name` / `arguments`）；
 * - `anthropic_messages`：Claude Messages API，`tools: [{ name, description, input_schema }]`，
 *   结果为 `content[]` 中 `type: 'tool_use'` 的块（`id` / `name` / `input`）。
 */
export type NativeToolApi = 'openai_chat' | 'openai_responses' | 'anthropic_messages'

export interface NativeToolDefinition {
  name: string
  description: string
  /** JSON Schema（object）。 */
  parameters: Record<string, unknown>
}

export interface ToolCallOptions {
  api: NativeToolApi
  systemPrompt: string
  userPrompt: string
  tools: readonly NativeToolDefinition[]
  temperature?: number
  maxOutputTokens?: number
  signal?: AbortSignal
  /** 账本：低敏 prompt 类别。 */
  promptName?: string
}

export interface NativeToolCall {
  /** 供应商给的调用 ID（call_id / tool_use id）。 */
  id: string
  name: string
  /** 已解析的参数；供应商返回的参数不是合法 JSON 时为 null。 */
  arguments: Record<string, unknown> | null
}

export interface ToolCallResult {
  /** 模型同时输出的文字（说明 / 追问）。 */
  text: string
  toolCalls: NativeToolCall[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    finishReasons?: string[]
    responseId?: string
    responseModel?: string
  }
}

/** 适配器不支持该原生工具调用形态（如协议不符）。 */
export class NativeToolCallingUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativeToolCallingUnsupportedError'
  }
}

/** 把供应商返回的参数（字符串或对象）解析成对象；不合法返回 null。 */
export function parseToolArguments(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || raw.trim() === '') return raw === '' ? {} : null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** Adapter 通用契约。Provider 切换只改本接口的实现。 */
export interface Adapter {
  readonly providerName: string
  readonly modelName: string
  readonly isReal: boolean

  /**
   * Lightweight connection test. Implementations must send a minimal provider-native ping instead
   * of reusing `stream()` / `buildStrategyPrompt()`, otherwise settings-page tests can spend real
   * tokens generating full project drafts.
   */
  ping(options?: { signal?: AbortSignal }): Promise<AdapterPingResult>

  /**
   * 流式生成：Adapter 需负责首 token 计时、SSE 中断分类、token 超限识别。
   * Consumer 侧负责聚合 → 结构化校验 → 三档判定。
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>

  /** Optional multimodal OCR preview support. Non-vision adapters may omit it. */
  ocrPreview?(options: OcrPreviewOptions): Promise<AdapterOcrPreviewResult>

  /**
   * 原生工具调用（非流式，一次请求）。协议不支持所请求的 `api` 时抛
   * `NativeToolCallingUnsupportedError`；供应商报错原样抛出，由调用方决定是否回退。
   */
  callTools?(options: ToolCallOptions): Promise<ToolCallResult>
}

/**
 * AIGateway —— 唯一对外入口。
 *
 * 只暴露一个 `generate` 方法与一个 `stream` 方法：
 * - controller/service 层不引用 Adapter 具体实现；
 * - 三档判定、AIMarker 覆盖率、错误恢复由 gateway 上层（judge/recovery）负责。
 *
 * v3-unified-ai-invocation-ledger §4.2/4.3：本层是统一写入点。
 * 当注入 recorder（由 resolver 接线）时，`generate`/`stream` 自动采集
 * `time_to_first_chunk_ms`、`duration_ms`、token 用量、`finish_reasons`、
 * `response_id` 与 `using_real_adapter` 并落账；缺失调用上下文以显式 unknown 值落账。
 * instrumentation 失败隔离：recorder 抛错绝不改变业务结果（§4.8）。
 */
/** 出错时的 finish_reasons：循环中止单独标出，便于按 loop 统计。 */
function errorFinishReasons(errors: readonly AiM0ErrorKind[]): string[] {
  return errors.includes('repetition_loop') ? ['repetition_loop'] : ['error']
}

export class AIGateway {
  readonly #adapter: Adapter
  readonly #recorder: LedgerAttemptRecorder | null
  readonly #recordContext: LedgerRecordContext | null
  readonly #rateLimitSettler: RateLimitTokenSettler | null

  constructor(
    adapter: Adapter,
    options?: {
      recorder?: LedgerAttemptRecorder | null
      recordContext?: LedgerRecordContext | null
      /** §8.7：TPM 预估与实际偏差的结算出口（缺省不结算）。 */
      rateLimitSettler?: RateLimitTokenSettler | null
    },
  ) {
    this.#adapter = adapter
    this.#recorder = options?.recorder ?? null
    this.#recordContext = options?.recordContext ?? null
    this.#rateLimitSettler = options?.rateLimitSettler ?? null
  }

  get provider() {
    return this.#adapter.providerName
  }
  get model() {
    return this.#adapter.modelName
  }
  get usingRealAdapter() {
    return this.#adapter.isReal
  }

  /** 流式：直接把 Adapter 的 AsyncIterable 透传出去（带统一账本采集包装）。 */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const raw = this.#adapter.stream(options)
    if (!this.#recorder) return raw
    return this.#recordedStream(raw, options)
  }

  /** 原生工具调用（带统一账本采集）。适配器未实现时抛 `NativeToolCallingUnsupportedError`。 */
  async callTools(options: ToolCallOptions): Promise<ToolCallResult> {
    if (typeof this.#adapter.callTools !== 'function') {
      throw new NativeToolCallingUnsupportedError('当前连接不支持原生工具调用')
    }
    const startedAt = performance.now()
    const ledgerOptions: GenerateOptions = {
      sentence: '',
      strategy: 'tool',
      promptName: options.promptName,
    }
    try {
      const result = await this.#adapter.callTools(options)
      const totalMs = performance.now() - startedAt
      await this.#recordAttempt({
        status: 'succeeded',
        firstTokenMs: totalMs,
        totalMs,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        finishReasons: result.usage?.finishReasons ?? ['stop'],
        responseId: result.usage?.responseId ?? null,
        responseModel: result.usage?.responseModel ?? null,
        errorKinds: [],
        options: ledgerOptions,
      })
      return result
    } catch (error) {
      const totalMs = performance.now() - startedAt
      await this.#recordAttempt({
        status: 'failed',
        firstTokenMs: 0,
        totalMs,
        inputTokens: null,
        outputTokens: null,
        finishReasons: ['error'],
        responseId: null,
        responseModel: null,
        errorKinds: ['sse_interrupted'],
        options: ledgerOptions,
      })
      throw error
    }
  }

  async ocrPreview(options: OcrPreviewOptions): Promise<AdapterOcrPreviewResult> {
    if (typeof this.#adapter.ocrPreview !== 'function') {
      return {
        ok: false,
        errorKind: 'MODEL_CAPABILITY_MISMATCH',
        errorMessage: '当前协议暂不支持 OCR 预览',
      }
    }
    return this.#adapter.ocrPreview(options)
  }

  /**
   * 非流式：内部聚合所有 chunk，返回 `GenerateResult`。
   * 结构化校验（zod safeParse）与三档判定不在这里做，由 `services/ai_m0/judge.ts` 负责。
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startedAt = performance.now()
    let firstTokenMs = 0
    let firstTokenSeen = false
    const parts: string[] = []
    const errors: AiM0ErrorKind[] = []
    const errorMessages: string[] = []
    let outputTokens: number | null = null
    let usage: StreamChunk['usage'] | null = null

    for await (const chunk of this.#adapter.stream(options)) {
      if (chunk.kind === 'text' && chunk.text) {
        if (!firstTokenSeen) {
          firstTokenMs = performance.now() - startedAt
          firstTokenSeen = true
        }
        parts.push(chunk.text)
        try {
          options.onText?.(chunk.text)
        } catch {
          // 观察通道失败不能拖垮模型调用。
        }
      } else if (chunk.kind === 'reasoning' && chunk.text) {
        try {
          options.onReasoning?.(chunk.text)
        } catch {
          // 观察通道失败不能拖垮模型调用。
        }
      } else if (chunk.kind === 'error') {
        if (chunk.errorKind) errors.push(chunk.errorKind)
        // 循环中止等提前结束的错误可携带估算 usage。
        if (chunk.usage) {
          usage = chunk.usage
          outputTokens = chunk.usage.outputTokens ?? null
        }
        if (chunk.errorMessage) errorMessages.push(chunk.errorMessage)
      } else if (chunk.kind === 'done' && chunk.usage) {
        // 即使供应商没有 token，也保留其 response id/model/finish reason 元数据。
        outputTokens =
          typeof chunk.usage.outputTokens === 'number' ? chunk.usage.outputTokens : null
        usage = chunk.usage
      }
    }

    const result: GenerateResult = {
      rawText: parts.join(''),
      triggeredErrors: errors,
      ...(errorMessages.length > 0 ? { triggeredErrorMessages: errorMessages } : {}),
      outputTokens,
      firstTokenMs,
      totalMs: performance.now() - startedAt,
      usingRealAdapter: this.#adapter.isReal,
    }

    if (this.#recorder) {
      await this.#recordAttempt({
        status: errors.length > 0 ? 'failed' : 'succeeded',
        firstTokenMs,
        totalMs: result.totalMs,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens,
        reasoningTokens: usage?.reasoningTokens ?? null,
        finishReasons:
          errors.length > 0 ? errorFinishReasons(errors) : (usage?.finishReasons ?? ['stop']),
        responseId: usage?.responseId ?? null,
        responseModel: usage?.responseModel ?? null,
        errorKinds: errors,
        options,
      })
    }

    return result
  }

  // ── 统一账本采集（§4.2/4.4/4.8） ──

  /** 包装流：逐 chunk 采集首 token 时延/token 用量，迭代结束（正常/出错/中止）时落账一次。 */
  async *#recordedStream(
    raw: AsyncIterable<StreamChunk>,
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    const startedAt = performance.now()
    let firstTokenMs = 0
    let firstTokenSeen = false
    const errors: AiM0ErrorKind[] = []
    let outputTokens: number | null = null
    let usage: StreamChunk['usage'] | null = null
    let completed = false
    // 调用方收到 done 后常直接 return/break 退出循环（生成器被提前关闭），此时已拿到完整结果与用量，
    // 不能记成 aborted——否则账本里成功的生成全是「已中止」且没有 token 数。
    let sawDone = false

    try {
      for await (const chunk of raw) {
        if (chunk.kind === 'text' && chunk.text && !firstTokenSeen) {
          firstTokenMs = performance.now() - startedAt
          firstTokenSeen = true
        } else if (chunk.kind === 'error') {
          if (chunk.errorKind) errors.push(chunk.errorKind)
          // 循环中止等提前结束的错误可携带估算 usage。
          if (chunk.usage) {
            usage = chunk.usage
            outputTokens = chunk.usage.outputTokens ?? null
          }
        } else if (chunk.kind === 'done') {
          sawDone = true
          if (chunk.usage) {
            outputTokens =
              typeof chunk.usage.outputTokens === 'number' ? chunk.usage.outputTokens : null
            usage = chunk.usage
          }
        }
        yield chunk
      }
      completed = true
    } finally {
      // 正常完成（含收到 done 后提前退出）→ succeeded/failed；done 之前中止（abort/break）→ aborted
      if (sawDone) completed = true
      const status: UnifiedAiInvocationAttempt['status'] = completed
        ? errors.length > 0
          ? 'failed'
          : 'succeeded'
        : 'aborted'
      await this.#recordAttempt({
        status,
        firstTokenMs,
        totalMs: performance.now() - startedAt,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens,
        reasoningTokens: usage?.reasoningTokens ?? null,
        finishReasons: completed
          ? errors.length > 0
            ? errorFinishReasons(errors)
            : (usage?.finishReasons ?? ['stop'])
          : ['aborted'],
        responseId: usage?.responseId ?? null,
        responseModel: usage?.responseModel ?? null,
        errorKinds: errors,
        options,
      })
    }
  }

  /** 组装 attempt 记录并落账；recorder 抛错一律吞掉（instrumentation 失败隔离）。 */
  async #recordAttempt(input: {
    status: UnifiedAiInvocationAttempt['status']
    firstTokenMs: number
    totalMs: number
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens?: number | null
    finishReasons: string[]
    responseId: string | null
    responseModel: string | null
    errorKinds: AiM0ErrorKind[]
    options: GenerateOptions
  }): Promise<void> {
    if (!this.#recorder) return
    const ctx = this.#recordContext ?? {}
    const attemptNumber = input.options.attemptNumber ?? ctx.attemptNumber ?? 1
    const attempt: UnifiedAiInvocationAttempt = {
      aiproj_organization_id: ctx.organizationId ?? 0,
      aiproj_project_id: ctx.projectId ?? null,
      aiproj_user_id: ctx.userId ?? null,
      aiproj_connection_id: ctx.connectionId ?? null,
      aiproj_model_id: ctx.modelId ?? null,
      aiproj_capability: ctx.capability ?? 'unknown',
      aiproj_surface: ctx.surface ?? 'unknown',
      aiproj_attempt_number: attemptNumber,
      aiproj_using_real_adapter: this.#adapter.isReal,
      aiproj_fallback_used: ctx.source === 'fallback',
      aiproj_source: ctx.source ?? 'unknown',
      status: input.status,
      error_kind:
        input.errorKinds.length > 0 ? normalizeLedgerErrorKind(input.errorKinds[0]!) : 'none',
      error_message_ref: null,
      aiproj_degraded: input.status === 'degraded',
      operation_name: ctx.operationName ?? this.#defaultOperationName(input.options),
      provider_name: this.#adapter.providerName,
      request_model: this.#adapter.modelName,
      // §2.5：response_model 独立字段；仅使用 provider 响应实际报告的标识。
      response_model: input.responseModel,
      response_id: input.responseId,
      finish_reasons: input.finishReasons,
      output_type: this.#defaultOutputType(input.options),
      prompt_name: input.options.promptName ?? (input.options.promptSet ? 'product-prompt' : null),
      aiproj_prompt_version: null,
      tool_name: null,
      tool_type: null,
      tool_call_id: null,
      data_source_id: null,
      trace_id: ctx.traceId ?? null,
      span_id: ctx.spanId ?? null,
      parent_span_id: ctx.parentSpanId ?? null,
      conversation_id: ctx.conversationId ?? null,
      workflow_name: ctx.workflowName ?? null,
      agent_id: null,
      agent_name: null,
      agent_version: null,
      idempotency_key: ctx.idempotencyKey ?? null,
      // performance.now() 得到小数毫秒；账本列是整数，PG 拒收小数（SQLite 容忍，本地测不出）
      time_to_first_chunk_ms: Number.isFinite(input.firstTokenMs)
        ? Math.round(input.firstTokenMs) || null
        : null,
      duration_ms: Number.isFinite(input.totalMs) ? Math.max(0, Math.round(input.totalMs)) : null,
      usage_input_tokens: input.inputTokens,
      usage_output_tokens: input.outputTokens,
      usage_cache_read_input_tokens: null,
      usage_cache_creation_input_tokens: null,
      usage_reasoning_output_tokens: input.reasoningTokens ?? null,
      aiproj_audio_tokens: null,
      aiproj_context_tokens: null,
      aiproj_total_tokens:
        input.inputTokens !== null || input.outputTokens !== null
          ? (input.inputTokens ?? 0) + (input.outputTokens ?? 0)
          : null,
      aiproj_estimated_cost: null,
      aiproj_currency: null,
      aiproj_cost_status: null,
      aiproj_pricing_snapshot_id: null,
      aiproj_input_hash: null,
      aiproj_output_hash: null,
      aiproj_budget_decision_ref: null,
      // §8.7：限流决策与本次尝试互相可追溯（此前恒为 null）。
      aiproj_rate_limit_decision_ref: ctx.rateLimitDecisionId ?? null,
      aiproj_source_ledger_ref: ctx.sourceLedgerRef ?? null,
      occurred_at: new Date().toISOString(),
    }
    try {
      await this.#recorder.record(attempt)
    } catch {
      // §4.8 失败隔离：recorder 抛错不得改变业务终态；此处吞掉。
    }
    await this.#settleRateLimitDeviation(attempt.aiproj_total_tokens)
  }

  /**
   * 用既有 postflight 结算 TPM 预估与实际的偏差（§8.7）。
   *
   * 三条纪律：
   * - 不新建偏差表：偏差写回既有 `rate_limit_decisions`（postflight 内部行为）。
   * - 只在**真实 token 已知**时结算：token 为 null 说明 adapter 没报用量，
   *   此时结算会把窗口计数改写成 0，比不结算更糟。
   * - 失败隔离：结算属 instrumentation，抛错一律吞掉，绝不改变业务终态。
   */
  async #settleRateLimitDeviation(actualTokens: number | null): Promise<void> {
    const decisionId = this.#recordContext?.rateLimitDecisionId
    if (!this.#rateLimitSettler || !decisionId || actualTokens === null) return
    try {
      await this.#rateLimitSettler.postflight({ decisionId, actualTokens })
    } catch {
      // 失败隔离：与 recorder 同一条纪律。
    }
  }

  #defaultOperationName(options: GenerateOptions): UnifiedAiInvocationAttempt['operation_name'] {
    if (options.strategy === 'tool') return 'execute_tool'
    if (options.strategy === 'native') return 'generate_content'
    return 'chat'
  }

  #defaultOutputType(options: GenerateOptions): UnifiedAiInvocationAttempt['output_type'] {
    if (options.strategy === 'tool' || options.strategy === 'native') return 'json'
    return 'text'
  }

  /** 结构化校验后包成通用返回（供 controller 使用）；纯类型透传。 */
  static toDraft(_parsed: AiProjectDraft): AiProjectDraft {
    return _parsed
  }
}
