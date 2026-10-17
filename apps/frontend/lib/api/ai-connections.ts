import { apiFetch, apiFetchEnvelope } from '@/lib/api-client'
import type {
  AiConnectionDto,
  AiConnectionModelDto,
  AiConnectionProtocol,
  AiConnectionTestResult,
  AiModelCatalogMatchResponse,
  AiModelCatalogProviderDto,
  AiModelCatalogRefreshResponse,
  AiModelCatalogSearchResponse,
  AiModelTokenLimitSource,
  AiToolCallingMode,
  OcrPreviewRequest,
  OcrPreviewResult,
} from '@aiproj/types'

export type AiConnectionModelInput = Pick<
  AiConnectionModelDto,
  | 'modelName'
  | 'capabilities'
  | 'catalogProviderId'
  | 'catalogModelId'
  | 'catalogMetadata'
  | 'contextWindowTokens'
  | 'maxInputTokens'
  | 'maxOutputTokens'
  | 'rpmLimit'
  | 'tpmLimit'
  | 'isActive'
> & {
  id?: string
  pricingSnapshotId?: number | null
  tokenLimitSource?: AiModelTokenLimitSource | null
}

/** AI 连接 CRUD + 测连接(ai-gateway-abstraction / T034)。 */
export const aiConnectionsApi = {
  list: () => apiFetch<AiConnectionDto[]>('/ai/connections'),
  get: (id: number) => apiFetch<AiConnectionDto>(`/ai/connections/${id}`),
  create: (input: {
    displayName: string
    protocol: AiConnectionProtocol
    baseUrl?: string | null
    catalogProviderId?: string | null
    catalogProviderName?: string | null
    catalogProviderLogoUrl?: string | null
    catalogProviderDocUrl?: string | null
    catalogProviderEnvKeys?: string[]
    apiKey?: string
    model: string
    models?: AiConnectionModelInput[]
    toolCallingMode?: AiToolCallingMode
    isActive?: boolean
  }) =>
    apiFetch<AiConnectionDto>('/ai/connections', { method: 'POST', body: JSON.stringify(input) }),
  update: (
    id: number,
    input: Partial<{
      displayName: string
      protocol: AiConnectionProtocol
      baseUrl: string | null
      catalogProviderId: string | null
      catalogProviderName: string | null
      catalogProviderLogoUrl: string | null
      catalogProviderDocUrl: string | null
      catalogProviderEnvKeys: string[]
      apiKey: string
      model: string
      models: AiConnectionModelInput[]
      toolCallingMode: AiToolCallingMode
      isActive: boolean
    }>,
  ) =>
    apiFetch<AiConnectionDto>(`/ai/connections/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (id: number) => apiFetch<void>(`/ai/connections/${id}`, { method: 'DELETE' }),
  /** 默认测试连接下全部启用模型；传 modelName 时只测该模型。 */
  test: (id: number, modelName?: string) =>
    apiFetch<AiConnectionTestResult>(`/ai/connections/${id}/test`, {
      method: 'POST',
      body: JSON.stringify(modelName ? { modelName } : {}),
    }),
  previewOcr: (input: OcrPreviewRequest) =>
    apiFetch<OcrPreviewResult>('/ai/ocr/preview', { method: 'POST', body: JSON.stringify(input) }),
}

function catalogQuery(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim().length > 0) {
      query.set(key, String(value))
    }
  })
  const suffix = query.toString()
  return suffix ? `?${suffix}` : ''
}

export const aiModelCatalogApi = {
  search: (input: { q?: string; providerId?: string | null; limit?: number } = {}) =>
    // 响应体本身含顶层 `data` 键（models[] + meta），必须走 envelope，
    // 否则 apiFetch 会把它误当统一包裹再拆一层（旧版目录搜寻在生产端因此拿不到结果）。
    apiFetchEnvelope<AiModelCatalogSearchResponse>(
      `/ai/model-catalog/search${catalogQuery({
        q: input.q,
        providerId: input.providerId,
        limit: input.limit,
      })}`,
    ),
  match: (input: { baseUrl?: string | null; modelName?: string | null; limit?: number } = {}) =>
    apiFetch<AiModelCatalogMatchResponse>(
      `/ai/model-catalog/match${catalogQuery({
        baseUrl: input.baseUrl,
        modelName: input.modelName,
        limit: input.limit,
      })}`,
    ),
  provider: (providerId: string) =>
    apiFetch<{
      provider: AiModelCatalogProviderDto
      models: AiModelCatalogSearchResponse['data']
      stale: boolean
    }>(`/ai/model-catalog/providers/${encodeURIComponent(providerId)}`),
  refresh: (force = true) =>
    apiFetch<AiModelCatalogRefreshResponse>('/ai/model-catalog/refresh', {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
}

// ---------------------------------------------------------------------------
// 模型定价（2026-10-01）
// ---------------------------------------------------------------------------

/** 单价维度，单位「每 1M token」。 */
export interface ModelPricingCost {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
  inputAudio: number | null
  outputAudio: number | null
  reasoning: number | null
}

export interface ModelPricingView {
  hasPricing: boolean
  snapshotId: string | null
  source: string | null
  currency: string
  pricingUnit: string
  cost: ModelPricingCost | null
  /** true = 非该中转实际挂牌价（同名/官方近似），界面必须标注。 */
  approximate: boolean
  /** manual / ai-prefill / exact-catalog / first-party-fallback。 */
  decidedBy: string | null
  reason: string | null
  boundAt: string | null
}

/** 历史用量按**当前**单价的回算（账本历史行不改写）。 */
export interface ModelPricingBackCompute {
  calls: number
  pricedCalls: number
  unpricedCalls: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
    total: number
  }
  estimatedCost: number | null
  currency: string
  approximate: boolean
  from: string
  to: string
}

export interface ModelPricingDetail {
  model: { id: string; connectionId: string; modelName: string; isActive: boolean }
  pricing: ModelPricingView
  backCompute: ModelPricingBackCompute | null
}

export interface ModelPricingCandidate {
  providerId: string
  providerName: string
  modelId: string
  api: string | null
  cost: ModelPricingCost
  endpointMatched: boolean
  nameMatched: boolean
  /** 模型 id 是否以该供应商 id 开头（供应商自有条目，而非别家转售）。 */
  providerBranded: boolean
}

export interface ModelPricingPrefillOutcome {
  applied: boolean
  strategy: 'exact-catalog' | 'ai-prefill' | 'first-party-fallback' | 'queued' | 'none'
  reason: string
  approximate: boolean
  chosen: ModelPricingCandidate | null
  candidates: ModelPricingCandidate[]
  pricing: ModelPricingView | null
}

export const modelPricingApi = {
  show: (connectionId: number, modelId: number, includeBackCompute = true) =>
    apiFetch<ModelPricingDetail>(
      `/ai/connections/${connectionId}/models/${modelId}/pricing${includeBackCompute ? '' : '?includeBackCompute=false'}`,
    ),
  /** 人工定价：实际结算单价，优先级最高，可覆盖自动结果。 */
  setManual: (
    connectionId: number,
    modelId: number,
    input: { currency?: string; cost: Partial<ModelPricingCost>; note?: string | null },
  ) =>
    apiFetch<ModelPricingView>(`/ai/connections/${connectionId}/models/${modelId}/pricing`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  /** 绑定 models.dev 条目作为价源；approximate=true 表示同族/官方近似价。 */
  applyCatalog: (
    connectionId: number,
    modelId: number,
    input: {
      catalogProviderId: string
      catalogModelId: string
      approximate?: boolean
      reason?: string | null
    },
  ) =>
    apiFetch<ModelPricingView>(
      `/ai/connections/${connectionId}/models/${modelId}/pricing/catalog`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  candidates: (connectionId: number, modelId: number) =>
    apiFetch<{ candidates: ModelPricingCandidate[] }>(
      `/ai/connections/${connectionId}/models/${modelId}/pricing/candidates`,
    ),
  /** 自动预填：精确命中直接套用，否则交模型挑一条（useAi=false 只看确定性结果）。 */
  prefill: (connectionId: number, modelId: number, useAi = true) =>
    apiFetch<ModelPricingPrefillOutcome>(
      `/ai/connections/${connectionId}/models/${modelId}/pricing/prefill`,
      { method: 'POST', body: JSON.stringify({ useAi }) },
    ),
  unbind: (connectionId: number, modelId: number) =>
    apiFetch<void>(`/ai/connections/${connectionId}/models/${modelId}/pricing`, {
      method: 'DELETE',
    }),
}
