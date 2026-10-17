/**
 * AI 网关测试 fake SDK 助手（ai-gateway-abstraction-test-debt）。
 * 提供 fake OpenAI/Anthropic SDK 模块，模拟各种 chunk 序列与错误场景。
 * 供 3.2/3.3/3.4 契约测试注入动态 import 使用。
 */
import type { StreamChunk } from '#services/ai_m0/gateway'

// ─── helper: fake OpenAI SSE event chunk ────────────────────────────────

export interface FakeOpenAiChunk {
  id?: string
  object?: string
  created?: number
  model?: string
  choices?: Array<{
    index?: number
    delta?: { content?: string; tool_calls?: Array<{ function: { arguments?: string } }> }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

/** 生成 OpenAI 文本内容 chunk */
export function textChunk(text: string, index = 0): FakeOpenAiChunk {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    choices: [{ index, delta: { content: text }, finish_reason: null }],
  }
}

/** 生成 OpenAI tool_calls arguments chunk */
export function toolCallChunk(argumentsFragment: string, index = 0): FakeOpenAiChunk {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        index,
        delta: { tool_calls: [{ function: { arguments: argumentsFragment } }] },
        finish_reason: null,
      },
    ],
  }
}

/** 生成 finish_reason=length 的终止 chunk（token 超限） */
export function lengthFinishChunk(index = 0): FakeOpenAiChunk {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    choices: [{ index, delta: {}, finish_reason: 'length' }],
  }
}

/** 生成 usage 汇总 chunk（stream_options.include_usage） */
export function usageChunk(promptTokens = 10, completionTokens = 20): FakeOpenAiChunk {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    choices: [],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

/** 成功文本流：3 个文本片段 + usage + done */
export function successTextChunks(): FakeOpenAiChunk[] {
  return [textChunk('{"pro'), textChunk('ject":'), textChunk('"test"}'), usageChunk()]
}

/** OpenAI ping 成功响应（非流式） */
export function pingSuccessResponse() {
  return {
    id: 'chatcmpl-ping',
    object: 'chat.completion',
    choices: [{ message: { content: 'OK' } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  }
}

/** OpenAI ping 空响应（模拟拒绝） */
export function pingEmptyResponse() {
  return {
    id: 'chatcmpl-ping',
    object: 'chat.completion',
    choices: [{ message: { content: '' } }],
  }
}

// ─── fake Anthropic SSE events ──────────────────────────────────────────

export interface FakeAnthropicEvent {
  type: string
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
  content_block?: { type: string; text?: string }
  message?: { id: string }
}

/** text_delta 事件 */
export function textDelta(text: string): FakeAnthropicEvent {
  return { type: 'content_block_delta', delta: { type: 'text_delta', text } }
}

/** input_json_delta 事件（tool 策略） */
export function inputJsonDelta(partialJson: string): FakeAnthropicEvent {
  return {
    type: 'content_block_delta',
    delta: { type: 'input_json_delta', partial_json: partialJson },
  }
}

/** message_delta stop_reason=max_tokens */
export function maxTokensStop(): FakeAnthropicEvent {
  return { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }
}

/** message_stop 完成事件 */
export function messageStop(): FakeAnthropicEvent {
  return { type: 'message_stop' }
}

// ─── error helpers ────────────────────────────────────────────────────

/** OpenAI SDK 认证错误 */
export function authError(): Error {
  const err = new Error('401 Invalid Authentication')
  ;(err as any).status = 401
  return err
}

/** OpenAI SDK 限流错误 */
export function rateLimitError(): Error {
  const err = new Error('429 Rate limit exceeded')
  ;(err as any).status = 429
  return err
}

/** OpenAI SDK 服务不可用错误 */
export function serviceUnavailableError(): Error {
  const err = new Error('503 Service Unavailable')
  ;(err as any).status = 503
  return err
}

/** OpenAI SDK 超时/abort 错误 */
export function abortError(): Error {
  const err = new Error('aborted')
  ;(err as any).name = 'APIUserAbortError'
  return err
}

/** Anthropic SDK 认证错误 */
export function anthropicAuthError(): Error {
  const err = new Error('401 Authentication: x-api-key is invalid')
  ;(err as any).status = 401
  return err
}

/** Anthropic SDK 限流错误 */
export function anthropicRateLimitError(): Error {
  const err = new Error('529 Rate limited')
  ;(err as any).status = 529
  return err
}

// ─── StreamChunk → SDK event 反向映射工具（契约断言用） ──────────────

/**
 * 从项目 StreamChunk 列表重建「纯文本」结果。
 * 用于断言 AIGateway.generate() / Adapter.stream() 的聚合输出。
 */
export function collectText(chunks: StreamChunk[]): string {
  return chunks
    .filter((c) => c.kind === 'text')
    .map((c) => c.text)
    .join('')
}

export function collectErrors(chunks: StreamChunk[]): string[] {
  return chunks.filter((c) => c.kind === 'error').map((c) => c.errorKind ?? 'unknown')
}

export function findDone(chunks: StreamChunk[]): StreamChunk | undefined {
  return chunks.find((c) => c.kind === 'done')
}
