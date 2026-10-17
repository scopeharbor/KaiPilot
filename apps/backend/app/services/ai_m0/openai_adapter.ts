/**
 * ai-structured-output-poc / M0 —— OpenAI 兼容 Adapter。
 *
 * 依据：apply 前置决策 = OpenAI 兼容（GPT-4o），SDK = `openai`。
 *   - 策略 P（prompt-only）走 chat.completions，纯文本；
 *   - 策略 N（native json）走 response_format={ type: 'json_schema', json_schema: {...} }；
 *   - 策略 T（tool/function）走 tools[].function，强制 tool_choice。
 *
 * `openai` 是后端正式运行时依赖；仍延迟加载，避免未使用 AI 时增加启动副作用。
 *
 * spec 硬约束：本 Adapter 走完整 Provider 链路（真实 API 调用），
 * `isReal = true`，其 outcome 允许计入 M0 判定。
 */

import type {
  Adapter,
  GenerateOptions,
  NativeToolCall,
  OcrPreviewOptions,
  StreamChunk,
  ToolCallOptions,
  ToolCallResult,
} from './gateway.ts'
import { NativeToolCallingUnsupportedError, parseToolArguments } from './gateway.ts'
import type { AiM0Strategy, AiM0ErrorKind } from '@aiproj/types'
import { resolveOutputTokenLimit } from '@aiproj/types'
import { buildStrategyPrompt } from './prompts.ts'
import { describePingError } from './ping_errors.ts'
import { dshFetch } from './dsh_transport.ts'
import { withDshMinimalPrompt } from './dsh_prompt.ts'
import { RepetitionGuard } from './repetition_guard.ts'

const PING_MAX_TOKENS = 128
const PING_RETRY_MAX_TOKENS = 512

/** token 上限「过大」错误时降级重试的安全下限。 */
const TOKEN_LIMIT_FALLBACK = 4096

/**
 * GPT-5.x / o 系推理模型只认 `max_completion_tokens`（发 `max_tokens` 会被拒绝，
 * 或被兼容代理静默忽略导致输出上限失控）；其余端点沿用 `max_tokens`。
 */
export function selectMaxTokenField(modelName: string, value: number): Record<string, number> {
  const name = modelName.toLowerCase()
  if (/\bgpt-5/.test(name) || /\bo[134](-|$)/.test(name) || name.includes('codex')) {
    return { max_completion_tokens: value }
  }
  return { max_tokens: value }
}

/** GPT-5.x / o 系推理模型：不接受 temperature（会 400），原生工具调用时省略。 */
export function isOpenAiReasoningModel(modelName: string): boolean {
  const name = modelName.toLowerCase()
  return /\bgpt-5/.test(name) || /\bo[134](-|$)/.test(name) || name.includes('codex')
}

/**
 * Chat Completions 原生工具请求体：
 * `tools: [{ type: 'function', function: { name, description, parameters } }]`，`tool_choice: 'auto'`。
 */
export function buildChatToolsPayload(
  modelName: string,
  options: ToolCallOptions,
  maxOutputTokens: number,
): Record<string, unknown> {
  return {
    model: modelName,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    tools: options.tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...(isOpenAiReasoningModel(modelName) ? {} : { temperature: options.temperature ?? 0 }),
    ...selectMaxTokenField(modelName, maxOutputTokens),
    stream: false,
  }
}

/** 解析 Chat Completions 响应：`choices[0].message.{content, tool_calls[]}`。 */
export function parseChatToolsResponse(response: any): ToolCallResult {
  const message = response?.choices?.[0]?.message ?? {}
  const toolCalls: NativeToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((call: any) => call?.type === 'function' || call?.function)
    .map((call: any, index: number) => ({
      id: String(call?.id ?? `call_${index}`),
      name: String(call?.function?.name ?? ''),
      arguments: parseToolArguments(call?.function?.arguments),
    }))
  const finishReason = response?.choices?.[0]?.finish_reason
  return {
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls,
    usage: {
      inputTokens: response?.usage?.prompt_tokens,
      outputTokens: response?.usage?.completion_tokens,
      totalTokens: response?.usage?.total_tokens,
      finishReasons: typeof finishReason === 'string' ? [finishReason] : undefined,
      responseId: typeof response?.id === 'string' ? response.id : undefined,
      responseModel: typeof response?.model === 'string' ? response.model : undefined,
    },
  }
}

/**
 * Responses API 原生工具请求体：扁平 `tools: [{ type: 'function', name, description, parameters, strict }]`，
 * system 走 `instructions`，用户话走 `input`。
 */
export function buildResponsesToolsPayload(
  modelName: string,
  options: ToolCallOptions,
  maxOutputTokens: number,
): Record<string, unknown> {
  return {
    model: modelName,
    instructions: options.systemPrompt,
    input: options.userPrompt,
    tools: options.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      // 我们的 schema 含可选字段；strict 要求全部字段必填，故关闭，由服务端校验兜底
      strict: false,
    })),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    ...(isOpenAiReasoningModel(modelName) ? {} : { temperature: options.temperature ?? 0 }),
    max_output_tokens: maxOutputTokens,
    store: false,
  }
}

/** 解析 Responses API 响应：`output[]` 中 `function_call` 项 + `message` 项里的 `output_text`。 */
export function parseResponsesToolsResponse(response: any): ToolCallResult {
  const output: any[] = Array.isArray(response?.output) ? response.output : []
  const toolCalls: NativeToolCall[] = output
    .filter((item) => item?.type === 'function_call')
    .map((item, index) => ({
      id: String(item?.call_id ?? item?.id ?? `call_${index}`),
      name: String(item?.name ?? ''),
      arguments: parseToolArguments(item?.arguments),
    }))
  const text =
    typeof response?.output_text === 'string' && response.output_text
      ? response.output_text
      : output
          .filter((item) => item?.type === 'message')
          .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
          .filter((part: any) => part?.type === 'output_text')
          .map((part: any) => String(part?.text ?? ''))
          .join('')
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: response?.usage?.input_tokens,
      outputTokens: response?.usage?.output_tokens,
      totalTokens: response?.usage?.total_tokens,
      finishReasons: typeof response?.status === 'string' ? [response.status] : undefined,
      responseId: typeof response?.id === 'string' ? response.id : undefined,
      responseModel: typeof response?.model === 'string' ? response.model : undefined,
    },
  }
}

/**
 * 首轮请求因 token 上限参数被拒时构造降级重试体；不该重试时返回 null。
 * - 字段名不被接受（推理模型只认 max_completion_tokens，或旧端点只认 max_tokens）：换名重试；
 * - 上限超过模型允许的最大值：降到 TOKEN_LIMIT_FALLBACK 重试。
 */
export function buildTokenParamRetryPayload(
  payload: Record<string, unknown>,
  errorMessage: unknown,
): Record<string, unknown> | null {
  const msg = String(errorMessage ?? '').toLowerCase()
  const hasMaxTokens = 'max_tokens' in payload
  const hasMaxCompletionTokens = 'max_completion_tokens' in payload
  if (!hasMaxTokens && !hasMaxCompletionTokens) return null
  if (!msg.includes('max_tokens') && !msg.includes('max_completion_tokens')) return null

  if (
    /unsupported|not supported|unrecognized|unknown param|invalid param|不允许|不支持/.test(msg)
  ) {
    const value = (payload.max_tokens ?? payload.max_completion_tokens) as number
    const rest = { ...payload }
    delete rest.max_tokens
    delete rest.max_completion_tokens
    return hasMaxTokens ? { ...rest, max_completion_tokens: value } : { ...rest, max_tokens: value }
  }

  if (/too large|too many|maximum|exceed|greater than|超过|上限/.test(msg)) {
    const key = hasMaxTokens ? 'max_tokens' : 'max_completion_tokens'
    const value = payload[key]
    if (typeof value !== 'number' || value <= TOKEN_LIMIT_FALLBACK) return null
    return { ...payload, [key]: TOKEN_LIMIT_FALLBACK }
  }

  return null
}

/** OpenAI Adapter 的构造参数(由 `resolveAdapter()` 从 env 或连接 DB 注入)。 */
export interface OpenAiAdapterConfig {
  apiKey: string
  model: string
  baseURL?: string
  maxOutputTokensDefault?: number
  maxOutputTokensLimit?: number
  requestTimeoutMsDefault?: number
  /** 显示用 provider 名(默认 'openai';OpenAI-compat 端点可传端点名)。 */
  providerName?: string
}

/**
 * 真 Adapter。为保持 zero-runtime-side-effect（未安装 openai 包时不炸），
 * 采用 dynamic import，只在 `stream()` 首次调用时加载 SDK。
 */
export class OpenAiAdapter implements Adapter {
  readonly providerName: string
  readonly isReal = true
  readonly modelName: string

  private clientPromise: Promise<any> | null = null

  constructor(private config: OpenAiAdapterConfig) {
    this.modelName = config.model
    // 泛化:任意 OpenAI-compat 端点(DeepSeek/NVIDIA NIM/vLLM/Ollama/LM Studio/...)复用本 Adapter,
    // 仅 baseURL + providerName 不同。design D5。
    this.providerName = config.providerName ?? 'openai'
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod: any = await import('openai').catch((err: Error) => {
          throw new Error(`openai SDK 加载失败：${err.message}`)
        })
        const OpenAI = mod.default ?? mod.OpenAI
        return new OpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseURL,
          // 推理模型可能在首个答案 token 前长时间保持静默；静默不是断网。
          timeout: this.config.requestTimeoutMsDefault ?? 50 * 60_000,
          fetch: dshFetch,
        })
      })()
    }
    return this.clientPromise
  }

  private resolveMaxOutputTokens(requested: number | null | undefined, fallback: number): number {
    const base = requested ?? this.config.maxOutputTokensDefault ?? fallback
    if (!this.config.maxOutputTokensLimit) return base
    return resolveOutputTokenLimit({
      requested: base,
      configured: this.config.maxOutputTokensLimit,
      fallback,
    })
  }

  private isDeepSeekOcrModel(): boolean {
    return this.modelName.toLowerCase().includes('deepseek-ocr')
  }

  private maxTokenField(value: number): Record<string, number> {
    return selectMaxTokenField(this.modelName, value)
  }

  /**
   * 统一入口：首轮请求因 token 上限参数被拒（字段名不认 / 上限过大）时按
   * buildTokenParamRetryPayload 降级重试一次，其余错误原样抛出。
   */
  private async createChatCompletion(
    client: any,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    try {
      const response = await client.chat.completions.create(payload, { signal })
      return unwrapChatCompletionEnvelope(response)
    } catch (err: any) {
      const retryPayload = buildTokenParamRetryPayload(payload, err?.message)
      if (!retryPayload) throw err
      const response = await client.chat.completions.create(retryPayload, { signal })
      return unwrapChatCompletionEnvelope(response)
    }
  }

  async ping(options: { signal?: AbortSignal } = {}) {
    const client = await this.getClient()
    try {
      // DeepSeek-OCR 是纯视觉模型，文本 ping 会返回空内容，造成“连接失败”的假阴性。
      // 对这类模型改查供应商模型目录：仍会真实验证 baseURL / API key / model id，
      // 但不会为一次连接测试额外消耗 OCR 推理 token。
      if (this.isDeepSeekOcrModel()) {
        const page = await client.models.list({ signal: options.signal })
        const models = Array.isArray(page?.data) ? page.data : []
        const modelExists = models.some(
          (item: any) => String(item?.id ?? '').toLowerCase() === this.modelName.toLowerCase(),
        )
        if (modelExists) return { ok: true }
        return {
          ok: false,
          errorKind: 'RESOURCE_NOT_FOUND' as const,
          errorMessage: `测试失败：供应商模型目录中不存在 ${this.modelName}。`,
        }
      }

      const complete = (maxTokens: number) =>
        this.createChatCompletion(
          client,
          {
            model: this.modelName,
            messages: [
              { role: 'system', content: withDshMinimalPrompt() },
              { role: 'user', content: 'Reply with exactly OK.' },
            ],
            temperature: 0,
            ...this.maxTokenField(this.resolveMaxOutputTokens(maxTokens, maxTokens)),
            stream: false,
          },
          options.signal,
        )

      let response = await complete(PING_MAX_TOKENS)
      let usage = openAiPingUsage(response)
      let text = response?.choices?.[0]?.message?.content
      if (!hasVisibleText(text) && shouldRetryReasoningPing(response)) {
        const retry = await complete(PING_RETRY_MAX_TOKENS)
        usage = mergePingUsage(usage, openAiPingUsage(retry))
        response = retry
        text = response?.choices?.[0]?.message?.content
      }
      if (hasVisibleText(text)) return { ok: true, usage }
      return {
        ok: false,
        errorKind: 'model_refusal_or_empty' as const,
        errorMessage: '测试失败：供应商返回了空响应。',
      }
    } catch (err: any) {
      return {
        ok: false,
        errorKind: classifyOpenAiPingError(err),
        errorMessage: describePingError(err),
      }
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()
    const strategy: AiM0Strategy = options.strategy
    const promptSet =
      options.promptSet ??
      buildStrategyPrompt({
        sentence: options.sentence,
        strategy,
      })

    // 请求体：三策略只在 response_format / tools 上分叉，共享 messages + temperature。
    const commonPayload: Record<string, unknown> = {
      model: this.modelName,
      messages: [
        { role: 'system', content: withDshMinimalPrompt(promptSet.systemPrompt) },
        { role: 'user', content: promptSet.userPrompt },
      ],
      temperature: options.temperature ?? 0.2,
      ...this.maxTokenField(this.resolveMaxOutputTokens(options.maxOutputTokens, 4096)),
      stream: true,
    }
    // 不再给思考模型设 thinking_budget（原为 1024）：复杂规划需要充分推理，
    // 思考与正文共享输出上限，统一取模型自身的最大输出（见 resolver）。
    // GPT-5.x / o 系推理模型发 max_completion_tokens（见 selectMaxTokenField）。

    if (strategy === 'native' && options.jsonSchema) {
      commonPayload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'AiProjectDraft',
          schema: options.jsonSchema,
          strict: true,
        },
      }
    } else if (strategy === 'tool' && options.jsonSchema) {
      commonPayload.tools = [
        {
          type: 'function',
          function: {
            name: 'submit_ai_project_draft',
            description: '提交结构化项目草案（章程 + WBS + 任务 + 验收标准）',
            parameters: options.jsonSchema,
          },
        },
      ]
      commonPayload.tool_choice = {
        type: 'function',
        function: { name: 'submit_ai_project_draft' },
      }
    }

    // 评测模式：请求包含 usage 信息的流式响应，便于 token 成本统计
    commonPayload.stream_options = { include_usage: true }

    let seq = 0
    const emit = (chunk: StreamChunk): StreamChunk => {
      seq += 1
      return { ...chunk, eventId: String(seq) }
    }

    let response: any
    try {
      response = await this.createChatCompletion(client, commonPayload, options.signal)
    } catch (err: any) {
      yield emit({
        kind: 'error',
        errorKind: classifyOpenAiError(err),
        errorMessage: err?.message ?? 'unknown_error',
      })
      return
    }

    try {
      let finalUsage: any
      let responseId: string | undefined
      let responseModel: string | undefined
      const finishReasons: string[] = []
      // 正文与推理流各自一个循环检测器：推理内容不对外输出，但同样会陷入循环白烧 token。
      const contentGuard = new RepetitionGuard()
      const reasoningGuard = new RepetitionGuard()
      let streamedChars = 0
      for await (const part of response as AsyncIterable<any>) {
        // 策略 P/N：文本在 delta.content；策略 T：文本在 delta.tool_calls[0].function.arguments。
        const delta = part?.choices?.[0]?.delta
        const finishReason = part?.choices?.[0]?.finish_reason as string | undefined
        // stream_options.include_usage 的最终 usage chunk：choices 为空，usage 有值
        const usage = part?.usage
        if (typeof part?.id === 'string' && part.id.trim()) responseId = part.id
        if (typeof part?.model === 'string' && part.model.trim()) responseModel = part.model
        if (finishReason && !finishReasons.includes(finishReason)) finishReasons.push(finishReason)
        // 多数兼容端点把 usage 放在「choices 为空」的末帧；也有端点放在带空 delta `{}` 的末帧，
        // 旧判断 `!delta` 会把后者整个丢掉（AI 同事对话的 token 数因此一直为空）。
        if (usage && typeof usage === 'object') {
          finalUsage = usage
        }
        const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning
        if (typeof reasoningDelta === 'string' && reasoningDelta) {
          streamedChars += reasoningDelta.length
          reasoningGuard.push(reasoningDelta)
          yield emit({ kind: 'reasoning', text: reasoningDelta })
        }
        let textDelta: string | null = null
        if (delta?.content) {
          textDelta = String(delta.content)
        } else if (delta?.tool_calls?.[0]?.function?.arguments) {
          textDelta = String(delta.tool_calls[0].function.arguments)
        }
        if (textDelta) {
          streamedChars += textDelta.length
          contentGuard.push(textDelta)
          yield emit({ kind: 'text', text: textDelta })
        }
        const loop = contentGuard.verdict ?? reasoningGuard.verdict
        if (loop) {
          // 中止上游请求，不再为循环内容付费；上层丢弃本次输出并以干净上下文重试。
          response?.controller?.abort?.()
          yield emit({
            kind: 'error',
            errorKind: 'repetition_loop',
            errorMessage: `repetition_loop:${contentGuard.verdict ? 'content' : 'reasoning'}:period=${loop.period}:repeats=${loop.repeats}`,
            usage: {
              // 中止后拿不到供应商 usage：按已流出的字符估算（中英混排 JSON 约 2.5 字符/token）。
              outputTokens: Math.ceil(streamedChars / 2.5),
              finishReasons: ['repetition_loop'],
              responseId,
              responseModel,
            },
          })
          return
        }
        // finish_reason=length → 触发 token 超限恢复路径
        if (finishReason === 'length') {
          yield emit({
            kind: 'error',
            errorKind: 'token_limit_exceeded',
            errorMessage: 'finish_reason=length',
          })
        }
      }
      // 最终 done 事件携带可能的 usage 数据
      yield emit({
        kind: 'done',
        usage: {
          inputTokens:
            typeof finalUsage?.prompt_tokens === 'number' ? finalUsage.prompt_tokens : undefined,
          outputTokens:
            typeof finalUsage?.completion_tokens === 'number'
              ? finalUsage.completion_tokens
              : undefined,
          totalTokens:
            typeof finalUsage?.total_tokens === 'number' ? finalUsage.total_tokens : undefined,
          reasoningTokens:
            typeof finalUsage?.completion_tokens_details?.reasoning_tokens === 'number'
              ? finalUsage.completion_tokens_details.reasoning_tokens
              : undefined,
          finishReasons: finishReasons.length > 0 ? finishReasons : ['stop'],
          responseId,
          responseModel,
        },
      })
    } catch (err: any) {
      yield emit({
        kind: 'error',
        errorKind: 'sse_interrupted',
        errorMessage: err?.message ?? 'sse_interrupted',
      })
    }
  }

  /** 原生工具调用：Chat Completions（`openai_chat`）或 Responses API（`openai_responses`）。 */
  async callTools(options: ToolCallOptions): Promise<ToolCallResult> {
    if (options.api !== 'openai_chat' && options.api !== 'openai_responses') {
      throw new NativeToolCallingUnsupportedError('OpenAI 兼容连接不支持 Claude 原生工具调用')
    }
    const client = await this.getClient()
    const maxOutputTokens = this.resolveMaxOutputTokens(options.maxOutputTokens, 4096)
    if (options.api === 'openai_chat') {
      const response = await this.createChatCompletion(
        client,
        buildChatToolsPayload(this.modelName, options, maxOutputTokens),
        options.signal,
      )
      return parseChatToolsResponse(response)
    }
    if (typeof client?.responses?.create !== 'function') {
      throw new NativeToolCallingUnsupportedError('当前 openai SDK 不支持 Responses API')
    }
    const response = await client.responses.create(
      buildResponsesToolsPayload(this.modelName, options, maxOutputTokens),
      { signal: options.signal },
    )
    return parseResponsesToolsResponse(response)
  }

  async ocrPreview(options: OcrPreviewOptions) {
    const client = await this.getClient()
    const prompt = this.isDeepSeekOcrModel()
      ? [
          'OCR this image. 只输出图片中可见的文字，保持原文语言和顺序。',
          '不要输出定位框、JSON 或任何标记。',
          options.promptHint?.trim() ? `Context: ${options.promptHint.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          '请进行 OCR。只返回图片中可见的文字，保持原有语言和顺序。',
          '不要解释、不要补写、不要推测不可见内容。',
          options.promptHint ? `额外提示：${options.promptHint}` : '',
        ]
          .filter(Boolean)
          .join('\n')

    try {
      const response = await this.createChatCompletion(
        client,
        {
          model: this.modelName,
          messages: [
            { role: 'system', content: withDshMinimalPrompt() },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: options.imageDataUrl } },
                { type: 'text', text: prompt },
              ],
            },
          ],
          temperature: 0,
          ...this.maxTokenField(this.resolveMaxOutputTokens(options.maxOutputTokens, 1024)),
          stream: false,
        },
        options.signal,
      )
      const extraction = extractTextFromChatCompletionResponse(response)
      if (!extraction.text) {
        if (extraction.refusal) {
          return {
            ok: false,
            errorKind: 'model_refusal_or_empty',
            errorMessage: `OCR 供应商拒答：${extraction.refusal}`,
          }
        }
        return {
          ok: false,
          errorKind: 'PROVIDER_MALFORMED_RESPONSE',
          errorMessage: extraction.emptyReason ?? 'OCR 供应商返回了空响应',
        }
      }
      const text = extraction.text
      const usage = response?.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined
      return { ok: true, extractedText: text, usage }
    } catch (err: any) {
      return {
        ok: false,
        errorKind: classifyOpenAiOcrError(err),
        errorMessage: describePingError(err),
      }
    }
  }
}

export interface ExtractedOcrTextResult {
  text: string
  refusal?: string
  emptyReason?: string
}

/**
 * 保留标准 OpenAI Chat Completions 响应，同时兼容部分 OpenAI-compatible
 * 网关使用的 `{ success, data: ChatCompletion }` 外层信封。
 */
function unwrapChatCompletionEnvelope<T>(response: T): T {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response

  const record = response as Record<string, unknown>
  if (Array.isArray(record.choices)) return response

  const data = record.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return response
  if (!Array.isArray((data as Record<string, unknown>).choices)) return response

  return data as T
}

/**
 * 从 OpenAI 兼容 ChatCompletion / Completion 响应中提取文本内容，
 * 兼容纯字符串、多段 content 文本数组、reasoning_content、兼容 text 字段。
 */
export function extractTextFromChatCompletionResponse(response: any): ExtractedOcrTextResult {
  if (!response || typeof response !== 'object') {
    return { text: '', emptyReason: 'OCR 供应商未返回有效响应对象' }
  }

  const choices = response.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return { text: '', emptyReason: 'OCR 供应商响应缺失 choices 列表' }
  }

  const choice = choices[0]
  if (!choice || typeof choice !== 'object') {
    return { text: '', emptyReason: 'OCR 供应商返回的 choices[0] 为空' }
  }

  // 1. 检查模型拒答
  const refusal = choice.message?.refusal || choice.refusal
  if (typeof refusal === 'string' && refusal.trim().length > 0) {
    return { text: '', refusal: refusal.trim() }
  }

  // 2. 提取 message.content
  const rawContent = choice.message?.content
  let extracted = extractTextFromValue(rawContent)

  // 3. 兼容 message.text
  if (!extracted && choice.message?.text) {
    extracted = extractTextFromValue(choice.message.text)
  }

  // 4. 兼容 choice.text (completions API 格式)
  if (!extracted && choice.text) {
    extracted = extractTextFromValue(choice.text)
  }

  // 5. 容错：若 content 为空但存在 reasoning_content / reasoning 字段
  if (!extracted) {
    const reasoning = choice.message?.reasoning_content ?? choice.message?.reasoning
    if (reasoning) {
      extracted = extractTextFromValue(reasoning)
    }
  }

  if (!extracted) {
    return { text: '', emptyReason: 'OCR 供应商返回的 choices[0] 未包含任何可见文本内容' }
  }

  return { text: extracted }
}

function extractTextFromValue(val: unknown): string {
  if (typeof val === 'string') {
    return val.trim()
  }
  if (Array.isArray(val)) {
    const parts: string[] = []
    for (const item of val) {
      if (typeof item === 'string') {
        parts.push(item)
      } else if (item && typeof item === 'object') {
        const textPart =
          (item as any).text ?? ((item as any).type === 'text' ? (item as any).content : undefined)
        if (typeof textPart === 'string') {
          parts.push(textPart)
        } else if (typeof (item as any).content === 'string') {
          parts.push((item as any).content)
        }
      }
    }
    return parts.join('').trim()
  }
  return ''
}

/** 把 SDK 抛出的错误粗分类到 six error kinds。 */
function classifyOpenAiError(err: any): AiM0ErrorKind {
  const msg = String(err?.message ?? '').toLowerCase()
  const name = String(err?.name ?? '')
  if (name === 'APIUserAbortError' || msg.includes('aborted')) return 'sse_interrupted'
  // 超时/连不上属于传输中断，不是模型吐了坏 JSON。原先它们落进最后那个
  // `malformed_json` 兜底桶，用户看到的错因与真实原因完全对不上。
  if (
    name === 'APIConnectionTimeoutError' ||
    name === 'APIConnectionError' ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('connection error')
  ) {
    return 'sse_interrupted'
  }
  if (msg.includes('refus') || msg.includes('policy')) return 'model_refusal_or_empty'
  if (msg.includes('token') || msg.includes('length')) return 'token_limit_exceeded'
  return 'malformed_json'
}

function hasVisibleText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function openAiPingUsage(response: any) {
  if (!response?.usage) return undefined
  return {
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens,
  }
}

function mergePingUsage(
  first: ReturnType<typeof openAiPingUsage>,
  second: ReturnType<typeof openAiPingUsage>,
) {
  if (!first) return second
  if (!second) return first
  const add = (left: unknown, right: unknown) =>
    typeof left === 'number' && typeof right === 'number' ? left + right : undefined
  return {
    inputTokens: add(first.inputTokens, second.inputTokens),
    outputTokens: add(first.outputTokens, second.outputTokens),
    totalTokens: add(first.totalTokens, second.totalTokens),
  }
}

function shouldRetryReasoningPing(response: any): boolean {
  const choice = response?.choices?.[0]
  if (choice?.finish_reason === 'length') return true
  if (hasVisibleText(choice?.message?.reasoning_content)) return true

  const reasoningTokens = response?.usage?.completion_tokens_details?.reasoning_tokens
  return typeof reasoningTokens === 'number' && reasoningTokens > 0
}

function classifyOpenAiPingError(err: any): string {
  const msg = String(err?.message ?? '').toLowerCase()
  const status = err?.status ?? err?.response?.status
  if (status === 401 || msg.includes('authentication') || msg.includes('api key')) {
    return 'AUTH_REQUIRED'
  }
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 529 ||
    msg.includes('service_unavailable') ||
    msg.includes('unavailable') ||
    msg.includes('overload') ||
    msg.includes('rate')
  ) {
    return 'AI_SERVICE_ERROR'
  }
  if (msg.includes('aborted')) return 'AI_SERVICE_ERROR'
  return 'AI_SERVICE_ERROR'
}

function classifyOpenAiOcrError(err: any): string {
  const msg = String(err?.message ?? '').toLowerCase()
  const status = err?.status ?? err?.response?.status
  if (status === 401 || msg.includes('authentication') || msg.includes('api key')) {
    return 'AUTH_REQUIRED'
  }
  if (status === 429 || msg.includes('rate')) return 'PROVIDER_RATE_LIMITED'
  if (msg.includes('aborted') || msg.includes('timeout') || msg.includes('timed out')) {
    return 'PROVIDER_TIMEOUT'
  }
  if (status === 400 || status === 404) return 'MODEL_UNAVAILABLE'
  if (status === 500 || status === 502 || status === 503 || status === 529) {
    return 'PROVIDER_UNAVAILABLE'
  }
  return 'AI_SERVICE_ERROR'
}
