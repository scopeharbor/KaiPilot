/**
 * ai-gateway-abstraction / T034 —— Anthropic-compatible Adapter(自研)。
 *
 * 用 `@anthropic-ai/sdk`(动态 import,未装不崩)。支持任意 Anthropic-compat 端点(自定义 baseURL):
 * Anthropic 官方 / Bedrock / Vertex / 自建兼容层。
 *
 * 三策略镜像 OpenAiAdapter(协议差异收敛在 Adapter 内部,共享 AIGateway/schema/judge/recovery):
 *   - 策略 P:纯 Prompt,后端 JSON.parse + zod;
 *   - 策略 N:原生 `output_config.format=json_schema`;
 *   - 策略 T:tool_use 强制结构化。
 *
 * 流式:遍历 Anthropic 多事件 SSE(message_start/content_block_delta/message_delta/message_stop),
 * 聚合 text_delta / input_json_delta 为既有 StreamChunk(对齐 gateway.ts 契约)。
 *
 * spec 硬约束:同协议直连;本 Adapter 直连 Anthropic 形态端点,不做跨协议翻译。
 */
import type {
  Adapter,
  GenerateOptions,
  NativeToolCall,
  StreamChunk,
  ToolCallOptions,
  ToolCallResult,
} from './gateway.ts'
import { NativeToolCallingUnsupportedError, parseToolArguments } from './gateway.ts'
import type { AiM0ErrorKind } from '@aiproj/types'
import { resolveOutputTokenLimit } from '@aiproj/types'
import { buildStrategyPrompt } from './prompts.ts'
import { describePingError } from './ping_errors.ts'
import { dshFetch } from './dsh_transport.ts'
import { withDshMinimalPrompt } from './dsh_prompt.ts'

export interface AnthropicAdapterConfig {
  apiKey: string
  model: string
  baseURL?: string
  maxOutputTokensDefault?: number
  maxOutputTokensLimit?: number
  requestTimeoutMsDefault?: number
  providerName?: string
}

export class AnthropicCompatibleAdapter implements Adapter {
  readonly providerName: string
  readonly isReal = true
  readonly modelName: string

  private clientPromise: Promise<any> | null = null

  constructor(private config: AnthropicAdapterConfig) {
    this.modelName = config.model
    this.providerName = config.providerName ?? 'anthropic'
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        // 延迟加载避免未使用 AI 时增加启动副作用；SDK 已是正式运行时依赖。
        const mod: any = await import('@anthropic-ai/sdk').catch((err: Error) => {
          throw new Error(`@anthropic-ai/sdk 加载失败：${err.message}`)
        })
        const Anthropic = mod.default ?? mod.Anthropic
        return new Anthropic({
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

  async ping(options: { signal?: AbortSignal } = {}) {
    const client = await this.getClient()
    try {
      const response = await client.messages.create(
        {
          model: this.modelName,
          max_tokens: 4,
          system: withDshMinimalPrompt(),
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        },
        { signal: options.signal },
      )
      const text = (response?.content ?? [])
        .map((part: any) => (part?.type === 'text' ? String(part.text ?? '') : ''))
        .join('')
      const inputTokens = response?.usage?.input_tokens
      const outputTokens = response?.usage?.output_tokens
      const usage =
        typeof inputTokens === 'number' || typeof outputTokens === 'number'
          ? {
              inputTokens,
              outputTokens,
              totalTokens:
                typeof inputTokens === 'number' && typeof outputTokens === 'number'
                  ? inputTokens + outputTokens
                  : undefined,
            }
          : undefined
      if (text.trim().length > 0) return { ok: true, usage }
      return {
        ok: false,
        errorKind: 'model_refusal_or_empty' as const,
        errorMessage: '测试失败：供应商返回了空响应。',
      }
    } catch (err: any) {
      return {
        ok: false,
        errorKind: classifyAnthropicPingError(err),
        errorMessage: describePingError(err),
      }
    }
  }

  /**
   * Claude 原生 tool use（Messages API）：`tools: [{ name, description, input_schema }]`，
   * 结果为 `content[]` 里的 `tool_use` 块。
   * `tool_choice` 用 `auto`：Claude Opus 5.5 / Sonnet 5.5 等最新模型对强制 `any` / `tool`
   * 直接返回 400（官方文档「Forcing tool use」），且本场景允许模型不调工具而改为追问。
   */
  async callTools(options: ToolCallOptions): Promise<ToolCallResult> {
    if (options.api !== 'anthropic_messages') {
      throw new NativeToolCallingUnsupportedError('Anthropic 兼容连接不支持 OpenAI 原生工具调用')
    }
    const client = await this.getClient()
    const response = await client.messages.create(
      buildAnthropicToolsPayload(
        this.modelName,
        options,
        this.resolveMaxOutputTokens(options.maxOutputTokens, 4096),
      ),
      { signal: options.signal },
    )
    return parseAnthropicToolsResponse(response)
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const client = await this.getClient()
    const promptSet =
      options.promptSet ??
      buildStrategyPrompt({
        sentence: options.sentence,
        strategy: options.strategy,
      })

    // Anthropic:max_tokens 必填、system 走顶层字段(非 messages 内 role)。
    const params: Record<string, unknown> = {
      model: this.modelName,
      max_tokens: this.resolveMaxOutputTokens(options.maxOutputTokens, 4096),
      system: withDshMinimalPrompt(promptSet.systemPrompt),
      messages: [{ role: 'user', content: promptSet.userPrompt }],
      temperature: options.temperature ?? 0.2,
    }

    if (options.strategy === 'native' && options.jsonSchema) {
      params.output_config = {
        format: {
          type: 'json_schema',
          schema: options.jsonSchema,
        },
      }
    } else if (options.strategy === 'tool' && options.jsonSchema) {
      params.tools = [
        {
          name: 'submit_ai_project_draft',
          description: '提交结构化项目草案(章程 + WBS + 任务 + 验收标准)',
          input_schema: options.jsonSchema,
        },
      ]
      params.tool_choice = { type: 'tool', name: 'submit_ai_project_draft' }
    }

    let seq = 0
    const emit = (chunk: StreamChunk): StreamChunk => {
      seq += 1
      return { ...chunk, eventId: String(seq) }
    }

    let stream: any
    try {
      stream = await client.messages.stream(params, { signal: options.signal })
    } catch (err: any) {
      yield emit({
        kind: 'error',
        errorKind: classifyAnthropicError(err),
        errorMessage: err?.message ?? 'unknown_error',
      })
      return
    }

    let doneEmitted = false
    try {
      for await (const event of stream as AsyncIterable<any>) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta?.type === 'text_delta' && delta.text) {
            yield emit({ kind: 'text', text: String(delta.text) })
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            yield emit({ kind: 'reasoning', text: String(delta.thinking) })
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            // tool 策略:tool 入参 JSON 片段,前端/校验层拼接后解析(与 OpenAiAdapter tool 一致)。
            yield emit({ kind: 'text', text: String(delta.partial_json) })
          }
        } else if (event.type === 'message_delta') {
          // stop_reason=max_tokens → 触发 token 超限恢复路径
          if (event.delta?.stop_reason === 'max_tokens') {
            yield emit({
              kind: 'error',
              errorKind: 'token_limit_exceeded',
              errorMessage: 'stop_reason=max_tokens',
            })
          }
        } else if (event.type === 'message_stop') {
          doneEmitted = true
          yield emit({ kind: 'done' })
        }
      }
      // 兜底:某些自建兼容层可能不发 message_stop,for-await 结束即视为完成。
      if (!doneEmitted) yield emit({ kind: 'done' })
    } catch (err: any) {
      yield emit({
        kind: 'error',
        errorKind: 'sse_interrupted',
        errorMessage: err?.message ?? 'sse_interrupted',
      })
    }
  }
}

/** 把 SDK 抛出的错误粗分类到 six error kinds。 */
function classifyAnthropicError(err: any): AiM0ErrorKind {
  const msg = String(err?.message ?? '').toLowerCase()
  const status = err?.status ?? err?.response?.status
  if (msg.includes('aborted')) return 'sse_interrupted'
  if (status === 401 || msg.includes('authentication') || msg.includes('x-api-key')) {
    return 'model_refusal_or_empty'
  }
  if (status === 429 || status === 529 || msg.includes('rate') || msg.includes('overload')) {
    return 'model_refusal_or_empty'
  }
  if (msg.includes('token') || msg.includes('length')) return 'token_limit_exceeded'
  return 'malformed_json'
}

function classifyAnthropicPingError(err: any): string {
  const msg = String(err?.message ?? '').toLowerCase()
  const status = err?.status ?? err?.response?.status
  if (status === 401 || msg.includes('authentication') || msg.includes('x-api-key')) {
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

/** Claude Messages API 原生工具请求体。 */
export function buildAnthropicToolsPayload(
  modelName: string,
  options: ToolCallOptions,
  maxOutputTokens: number,
): Record<string, unknown> {
  return {
    model: modelName,
    max_tokens: maxOutputTokens,
    system: options.systemPrompt,
    messages: [{ role: 'user', content: options.userPrompt }],
    tools: options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    })),
    tool_choice: { type: 'auto' },
    temperature: options.temperature ?? 0,
  }
}

/** 解析 Claude 响应：`content[]` 中 `tool_use` 块（id / name / input）与 `text` 块。 */
export function parseAnthropicToolsResponse(response: any): ToolCallResult {
  const content: any[] = Array.isArray(response?.content) ? response.content : []
  const toolCalls: NativeToolCall[] = content
    .filter((block) => block?.type === 'tool_use')
    .map((block, index) => ({
      id: String(block?.id ?? `toolu_${index}`),
      name: String(block?.name ?? ''),
      arguments: parseToolArguments(block?.input),
    }))
  const text = content
    .filter((block) => block?.type === 'text')
    .map((block) => String(block?.text ?? ''))
    .join('')
  const inputTokens = response?.usage?.input_tokens
  const outputTokens = response?.usage?.output_tokens
  return {
    text,
    toolCalls,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens:
        typeof inputTokens === 'number' && typeof outputTokens === 'number'
          ? inputTokens + outputTokens
          : undefined,
      finishReasons: typeof response?.stop_reason === 'string' ? [response.stop_reason] : undefined,
      responseId: typeof response?.id === 'string' ? response.id : undefined,
      responseModel: typeof response?.model === 'string' ? response.model : undefined,
    },
  }
}
