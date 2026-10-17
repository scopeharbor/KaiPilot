/**
 * v3-ai-model-catalog-search-and-pricing —— models.dev 目录、价格与上下文限制共享契约。
 *
 * 目录数据采用双层保存：稳定字段结构化，完整原始 payload 由后端 source snapshot 保存。
 * 本文件只放前后端都需要理解的低敏 DTO 与成本估算纯函数。
 */

import type { AiConnectionProtocol, AiModelCapability } from './ai-connection.js'

export const AI_MODEL_CATALOG_SOURCE = 'models.dev' as const
export type AiModelCatalogSource = typeof AI_MODEL_CATALOG_SOURCE

export const AI_MODEL_TOKEN_LIMIT_SOURCES = ['catalog', 'manual'] as const
export type AiModelTokenLimitSource = (typeof AI_MODEL_TOKEN_LIMIT_SOURCES)[number]

/**
 * 手动新增通用文本模型时的保守预设。
 *
 * 2026-09 前沿模型基线：主流 1M 上下文，取 64K 作为较小共同输出档；
 * 最大输入保留约 10% 空间给系统提示、工具定义、推理与最终输出。
 * 供应商目录有明确限制时，目录值始终覆盖这组预设。
 */
export const DEFAULT_AI_MODEL_CONTEXT_LIMITS = {
  contextWindowTokens: 1_000_000,
  maxInputTokens: 900_000,
  maxOutputTokens: 65_536,
} as const

/** 用目录限制补齐模型容量；缺少 max input 时为输出和协议开销预留空间。 */
export function resolveAiModelContextLimits(limit?: Partial<AiModelCatalogLimit> | null) {
  const contextWindowTokens = positiveInteger(limit?.context)
    ? limit!.context!
    : DEFAULT_AI_MODEL_CONTEXT_LIMITS.contextWindowTokens
  const maxOutputTokens = positiveInteger(limit?.output)
    ? Math.min(limit!.output!, contextWindowTokens - 1)
    : Math.min(DEFAULT_AI_MODEL_CONTEXT_LIMITS.maxOutputTokens, contextWindowTokens - 1)
  const maxInputTokens = positiveInteger(limit?.input)
    ? limit!.input!
    : Math.min(
        DEFAULT_AI_MODEL_CONTEXT_LIMITS.maxInputTokens,
        Math.max(1, contextWindowTokens - maxOutputTokens),
      )
  return { contextWindowTokens, maxInputTokens, maxOutputTokens }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export const AI_MODEL_CATALOG_SUPPORT_LEVELS = ['one_click', 'manual', 'unsupported'] as const
export type AiModelCatalogSupportLevel = (typeof AI_MODEL_CATALOG_SUPPORT_LEVELS)[number]

export const AI_MODEL_PRICE_STATES = ['priced', 'included', 'unknown'] as const
export type AiModelPriceState = (typeof AI_MODEL_PRICE_STATES)[number]

export interface AiModelCatalogLimit {
  /** models.dev limit.context，上下文窗口 token。 */
  context: number | null
  /** models.dev limit.input，最大输入 token。 */
  input: number | null
  /** models.dev limit.output，最大输出 token。 */
  output: number | null
}

export interface AiModelCatalogCost {
  /** 普通输入 / 缓存未命中输入，单位：每 1M token。 */
  input: number | null
  /** 输出，单位：每 1M token。 */
  output: number | null
  /** 缓存读取命中，单位：每 1M token。 */
  cacheRead: number | null
  /** 缓存写入，单位：每 1M token。 */
  cacheWrite: number | null
  /** 音频输入，单位：每 1M token 或供应商声明的 token-equivalent。 */
  inputAudio: number | null
  /** 音频输出，单位：每 1M token 或供应商声明的 token-equivalent。 */
  outputAudio: number | null
  /** 独立推理 token 价格；缺失不等于 0。 */
  reasoning: number | null
  /** 超过 200k 上下文的附加/分段价格，保留原结构。 */
  contextOver200k: unknown | null
  /** 分层价格，保留原结构。 */
  tiers: unknown | null
}

export interface AiModelCatalogProviderDto {
  id: string
  name: string
  api: string | null
  docsUrl: string | null
  npmPackage: string | null
  envKeys: string[]
  logoUrl: string
  searchAliases: string[]
  supportedProtocol: AiConnectionProtocol | null
  supportLevel: AiModelCatalogSupportLevel
  modelsCount: number
}

export interface AiModelCatalogModelDto {
  id: string
  name: string
  providerId: string
  providerName: string
  providerApi: string | null
  providerDocsUrl: string | null
  providerEnvKeys: string[]
  providerLogoUrl: string
  npmPackage: string | null
  protocol: AiConnectionProtocol | null
  supportLevel: AiModelCatalogSupportLevel
  baseUrl: string | null
  baseUrlNeedsManualEdit: boolean
  family: string | null
  description: string | null
  modalities: {
    input: string[]
    output: string[]
  }
  capabilities: AiModelCapability[]
  limit: AiModelCatalogLimit
  cost: AiModelCatalogCost
  knowledgeCutoff: string | null
  releaseDate: string | null
  lastUpdated: string | null
  status: string | null
  attachment: boolean | null
  reasoning: boolean | null
  reasoningOptions: unknown | null
  toolCall: boolean | null
  structuredOutput: boolean | null
  temperature: boolean | null
  openWeights: boolean | null
  weights: unknown | null
  benchmarks: unknown | null
  license: unknown | null
  links: unknown | null
  experimentalModes: unknown | null
  providerOverride: unknown | null
  pricingSnapshotId: string | null
  rawModel: Record<string, unknown>
}

export interface AiModelCatalogSearchResponse {
  data: AiModelCatalogModelDto[]
  meta: {
    query: string
    providerId: string | null
    total: number
    stale: boolean
    fetchedAt: string | null
    expiresAt: string | null
  }
}

export interface AiModelCatalogMatchResponse {
  provider: AiModelCatalogProviderDto | null
  model: AiModelCatalogModelDto | null
  candidates: AiModelCatalogModelDto[]
  stale: boolean
}

export interface AiModelCatalogRefreshResponse {
  ok: boolean
  stale: boolean
  providerCount: number
  modelCount: number
  fetchedAt: string
  expiresAt: string
  sourceHash: string
}

export interface AiModelPricingSnapshotDto {
  id: string
  providerId: string
  modelId: string
  source: AiModelCatalogSource
  sourceHash: string
  currency: string
  pricingUnit: '1M_tokens'
  cost: AiModelCatalogCost
  limit: AiModelCatalogLimit
  modalities: AiModelCatalogModelDto['modalities']
  rawModel: Record<string, unknown>
  fetchedAt: string
  expiresAt: string
  stale: boolean
}

export interface AiModelUsageTokenSnapshot {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  inputAudioTokens?: number
  outputAudioTokens?: number
  reasoningTokens?: number
  contextOver200kTokens?: number
}

export interface AiModelContextLimitSnapshot {
  contextWindowTokens: number | null
  maxInputTokens: number | null
  maxOutputTokens: number | null
  source: AiModelTokenLimitSource | null
}

export interface AiModelUsageSnapshotDto {
  id: string
  organizationId: string
  connectionId: string | null
  connectionModelId: string | null
  provider: string
  model: string
  catalogProviderId: string | null
  catalogModelId: string | null
  pricingSnapshotId: string | null
  usage: AiModelUsageTokenSnapshot
  contextLimits: AiModelContextLimitSnapshot
  estimatedCost: number | null
  currency: string
  latencyMs: number | null
  errorCategory: string | null
  occurredAt: string
}

export interface AiModelCostComponent {
  kind:
    | 'input'
    | 'output'
    | 'cache_read'
    | 'cache_write'
    | 'input_audio'
    | 'output_audio'
    | 'reasoning'
    | 'context_over_200k'
  tokens: number
  pricePerMillion: number | null
  cost: number | null
  state: AiModelPriceState
}

export interface AiModelCostEstimate {
  estimatedCost: number | null
  currency: string
  pricingUnit: '1M_tokens'
  components: AiModelCostComponent[]
  hasUnknownComponent: boolean
}

function addCostComponent(
  components: AiModelCostComponent[],
  kind: AiModelCostComponent['kind'],
  tokens: number | null | undefined,
  pricePerMillion: number | null | undefined,
  includedWhenMissing = false,
) {
  if (!tokens || tokens <= 0) return
  if (typeof pricePerMillion === 'number' && Number.isFinite(pricePerMillion)) {
    components.push({
      kind,
      tokens,
      pricePerMillion,
      cost: (tokens / 1_000_000) * pricePerMillion,
      state: 'priced',
    })
    return
  }
  components.push({
    kind,
    tokens,
    pricePerMillion: null,
    cost: includedWhenMissing ? 0 : null,
    state: includedWhenMissing ? 'included' : 'unknown',
  })
}

/**
 * 成本估算：输入/输出是基础计价维度；缓存、音频等细分 token 在没有独立单价时
 * 视为已包含在基础维度中，不能把整笔调用降级为「未定价」。
 * reasoningTokens 已包含在 outputTokens：有独立推理价时先从普通输出扣除，避免双重计费；
 * 没有独立推理价时仍按普通输出价计费。
 */
export function estimateAiModelCatalogCost(input: {
  usage: AiModelUsageTokenSnapshot
  cost: AiModelCatalogCost | null | undefined
  currency?: string
}): AiModelCostEstimate {
  const components: AiModelCostComponent[] = []
  const pricing = input.cost
  if (!pricing) {
    addCostComponent(components, 'input', input.usage.inputTokens, null)
    addCostComponent(components, 'output', input.usage.outputTokens, null)
    return {
      estimatedCost: null,
      currency: input.currency ?? 'USD',
      pricingUnit: '1M_tokens',
      components,
      hasUnknownComponent: components.length > 0,
    }
  }

  addCostComponent(components, 'input', input.usage.inputTokens, pricing.input)
  const reasoningTokens = Math.max(0, input.usage.reasoningTokens ?? 0)
  const outputTokens = Math.max(0, input.usage.outputTokens ?? 0)
  const separatelyPricedReasoning = pricing.reasoning !== null && reasoningTokens > 0
  addCostComponent(
    components,
    'output',
    separatelyPricedReasoning ? Math.max(0, outputTokens - reasoningTokens) : outputTokens,
    pricing.output,
  )
  addCostComponent(components, 'cache_read', input.usage.cacheReadTokens, pricing.cacheRead, true)
  addCostComponent(
    components,
    'cache_write',
    input.usage.cacheWriteTokens,
    pricing.cacheWrite,
    true,
  )
  addCostComponent(
    components,
    'input_audio',
    input.usage.inputAudioTokens,
    pricing.inputAudio,
    true,
  )
  addCostComponent(
    components,
    'output_audio',
    input.usage.outputAudioTokens,
    pricing.outputAudio,
    true,
  )
  addCostComponent(components, 'reasoning', input.usage.reasoningTokens, pricing.reasoning, true)
  addCostComponent(
    components,
    'context_over_200k',
    input.usage.contextOver200kTokens,
    typeof pricing.contextOver200k === 'number' ? pricing.contextOver200k : null,
  )

  const hasUnknownComponent = components.some((component) => component.state === 'unknown')
  const pricedTotal = components.reduce((sum, component) => sum + (component.cost ?? 0), 0)
  return {
    estimatedCost: hasUnknownComponent ? null : Math.round(pricedTotal * 1_000_000) / 1_000_000,
    currency: input.currency ?? 'USD',
    pricingUnit: '1M_tokens',
    components,
    hasUnknownComponent,
  }
}

export function resolveOutputTokenLimit(input: {
  requested?: number | null
  configured?: number | null
  fallback: number
}): number {
  const positive = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  const desired = positive(input.requested) ?? positive(input.fallback)
  const configured = positive(input.configured)
  if (desired && configured) return Math.min(desired, configured)
  return desired ?? configured ?? input.fallback
}
