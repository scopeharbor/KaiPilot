/**
 * ai-gateway-abstraction —— 按协议构造 Adapter 的工厂。
 *
 * 同协议直连(design D2):OpenAI-compat → OpenAiAdapter(直打 OpenAI 形态端点),
 * Anthropic-compat → AnthropicCompatibleAdapter(直打 Anthropic Messages 端点)。
 * 不做跨协议翻译。Resolver 与测连接共用本工厂。
 */
import type { Adapter } from './gateway.ts'
import { OpenAiAdapter } from './openai_adapter.ts'
import { AnthropicCompatibleAdapter } from './anthropic_compatible_adapter.ts'
import type { AiConnectionProtocol } from '@aiproj/types'

export interface AdapterBuildOptions {
  apiKey: string
  model: string
  baseURL?: string | null
  providerName?: string
  maxOutputTokensDefault?: number
  maxOutputTokensLimit?: number
  requestTimeoutMsDefault?: number
}

export function buildAdapter(protocol: AiConnectionProtocol, opts: AdapterBuildOptions): Adapter {
  const common = {
    apiKey: opts.apiKey,
    model: opts.model,
    baseURL: opts.baseURL ?? undefined,
    providerName: opts.providerName,
    maxOutputTokensDefault: opts.maxOutputTokensDefault,
    maxOutputTokensLimit: opts.maxOutputTokensLimit,
    requestTimeoutMsDefault: opts.requestTimeoutMsDefault,
  }
  if (protocol === 'anthropic_compatible') {
    return new AnthropicCompatibleAdapter(common)
  }
  return new OpenAiAdapter(common)
}
