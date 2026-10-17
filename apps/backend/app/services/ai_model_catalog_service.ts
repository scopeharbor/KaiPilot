import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import ApiException, { ResourceNotFoundException } from '#exceptions/api_exception'
import AiModelCatalogSnapshot from '#models/ai_model_catalog_snapshot'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import AiModelUsageSnapshot from '#models/ai_model_usage_snapshot'
import type {
  AiConnectionProtocol,
  AiModelCapability,
  AiModelCatalogCost,
  AiModelCatalogLimit,
  AiModelCatalogMatchResponse,
  AiModelCatalogModelDto,
  AiModelCatalogProviderDto,
  AiModelCatalogRefreshResponse,
  AiModelCatalogSearchResponse,
  AiModelCatalogSupportLevel,
  AiModelContextLimitSnapshot,
  AiModelUsageTokenSnapshot,
} from '@aiproj/types'
import { estimateAiModelCatalogCost } from '@aiproj/types'

const MODELS_DEV_CATALOG_URL = 'https://models.dev/catalog.json'
const MODELS_DEV_LOGO_BASE_URL = 'https://models.dev/logos'
const DEFAULT_REFRESH_TTL_MS = 6 * 60 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_SEARCH_LIMIT = 24
const MAX_SEARCH_LIMIT = 100
const SOURCE = 'models.dev'

type RawRecord = Record<string, unknown>
type FetchCatalog = (url: string, signal?: AbortSignal) => Promise<RawRecord>

export interface AiModelCatalogServiceOptions {
  catalogUrl?: string
  ttlMs?: number
  timeoutMs?: number
  now?: () => Date
  fetchCatalog?: FetchCatalog
}

export interface CatalogSearchInput {
  query?: string | null
  providerId?: string | null
  limit?: number | null
}

export interface CatalogMatchInput {
  baseUrl?: string | null
  modelName?: string | null
  limit?: number | null
}

export interface UsageSnapshotInput {
  organizationId: number
  connectionId?: number | null
  connectionModelId?: number | null
  provider: string
  model: string
  catalogProviderId?: string | null
  catalogModelId?: string | null
  pricingSnapshotId?: number | string | null
  usage?: AiModelUsageTokenSnapshot | null
  contextLimits?: AiModelContextLimitSnapshot | null
  latencyMs?: number | null
  errorCategory?: string | null
}

const CHINESE_PROVIDER_ALIASES: Record<string, string[]> = {
  alibaba: ['阿里', '阿里云', '通义', '通义千问', '百炼', '千问'],
  anthropic: ['安索ropic', 'Claude'],
  baidu: ['百度', '文心', '千帆'],
  deepseek: ['深度求索', '深度搜索', '深寻'],
  google: ['谷歌', 'Gemini'],
  minimax: ['MiniMax', '海螺'],
  modelscope: ['魔搭', '魔搭社区'],
  moonshot: ['月之暗面', 'Kimi'],
  openai: ['开放AI', 'ChatGPT'],
  siliconflow: ['硅基流动'],
  tencent: ['腾讯', '腾讯云', '混元'],
  volcengine: ['火山', '火山引擎', '豆包', '字节', '字节跳动'],
  zhipu: ['智谱', '智谱清言', '清言'],
}

function isRecord(value: unknown): value is RawRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()]
  return []
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function protocolFromNpm(npmPackage: string | null): AiConnectionProtocol | null {
  if (!npmPackage) return null
  if (npmPackage === '@ai-sdk/openai' || npmPackage === '@ai-sdk/openai-compatible') {
    return 'openai_compatible'
  }
  if (npmPackage === '@ai-sdk/anthropic') return 'anthropic_compatible'
  return null
}

function apiLooksTemplated(api: string | null): boolean {
  if (!api) return false
  return /\$\{|<|>|\{|\}/.test(api)
}

function apiLooksUrl(api: string | null): boolean {
  if (!api) return false
  try {
    const parsed = new URL(api)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function supportLevelFor(input: {
  protocol: AiConnectionProtocol | null
  api: string | null
}): AiModelCatalogSupportLevel {
  if (!input.protocol) return 'unsupported'
  if (apiLooksTemplated(input.api)) return 'manual'
  if (!input.api || apiLooksUrl(input.api)) return 'one_click'
  return 'manual'
}

function baseUrlFor(api: string | null, supportLevel: AiModelCatalogSupportLevel): string | null {
  if (supportLevel !== 'one_click') return null
  if (apiLooksTemplated(api)) return null
  return apiLooksUrl(api) ? api : null
}

function providerAliases(providerId: string, providerName: string): string[] {
  const normalized = providerId.toLowerCase()
  const direct = CHINESE_PROVIDER_ALIASES[normalized] ?? []
  const fuzzy = Object.entries(CHINESE_PROVIDER_ALIASES)
    .filter(([key]) => normalized.includes(key) || providerName.toLowerCase().includes(key))
    .flatMap(([, aliases]) => aliases)
  return [...new Set([...direct, ...fuzzy])]
}

function costOf(raw: unknown): AiModelCatalogCost {
  const cost = isRecord(raw) ? raw : {}
  return {
    input: numberOrNull(cost.input),
    output: numberOrNull(cost.output),
    cacheRead: numberOrNull(cost.cache_read),
    cacheWrite: numberOrNull(cost.cache_write),
    inputAudio: numberOrNull(cost.input_audio),
    outputAudio: numberOrNull(cost.output_audio),
    reasoning: numberOrNull(cost.reasoning),
    contextOver200k: cost.context_over_200k ?? null,
    tiers: cost.tiers ?? null,
  }
}

function limitOf(raw: unknown): AiModelCatalogLimit {
  const limit = isRecord(raw) ? raw : {}
  return {
    context: numberOrNull(limit.context),
    input: numberOrNull(limit.input),
    output: numberOrNull(limit.output),
  }
}

function modalitiesOf(raw: unknown): { input: string[]; output: string[] } {
  const modalities = isRecord(raw) ? raw : {}
  return {
    input: stringArray(modalities.input),
    output: stringArray(modalities.output),
  }
}

function inferCapabilities(model: RawRecord): AiModelCapability[] {
  const modalities = modalitiesOf(model.modalities)
  const caps = new Set<AiModelCapability>(['chat'])
  if (modalities.input.includes('image')) caps.add('vision')
  if (modalities.input.includes('pdf')) caps.add('document_understanding')
  if (modalities.input.includes('audio')) caps.add('audio_input')
  if (modalities.input.includes('video')) caps.add('video_input')
  if (modalities.output.includes('audio')) caps.add('speech_output')
  if (modalities.output.includes('image')) caps.add('image_generation')
  if (model.structured_output === true) caps.add('structured_output')
  if (model.tool_call === true) caps.add('tool_calling')
  if (model.attachment === true || modalities.input.includes('pdf')) caps.add('ocr')
  return [...caps]
}

function rootProviders(payload: RawRecord): Record<string, RawRecord> {
  const source = isRecord(payload.providers) ? payload.providers : payload
  return Object.fromEntries(
    Object.entries(source).filter(([, provider]) => isRecord(provider)),
  ) as Record<string, RawRecord>
}

export default class AiModelCatalogService {
  readonly #catalogUrl: string
  readonly #ttlMs: number
  readonly #timeoutMs: number
  readonly #now: () => Date
  readonly #fetchCatalog: FetchCatalog

  constructor(options: AiModelCatalogServiceOptions = {}) {
    this.#catalogUrl = options.catalogUrl ?? MODELS_DEV_CATALOG_URL
    this.#ttlMs = options.ttlMs ?? DEFAULT_REFRESH_TTL_MS
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#now = options.now ?? (() => new Date())
    this.#fetchCatalog = options.fetchCatalog ?? this.#defaultFetch
  }

  async search(input: CatalogSearchInput = {}): Promise<AiModelCatalogSearchResponse> {
    const catalog = await this.ensureCatalog()
    const providers = rootProviders(catalog.snapshot.payload)
    const query = normalizeSearchText(input.query ?? '')
    const providerId = input.providerId?.trim() || null
    const limit = Math.min(
      Math.max(Number(input.limit ?? DEFAULT_SEARCH_LIMIT) || DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT,
    )
    const matches = this.#allModels(providers, catalog.sourceHash, catalog.expiresAt)
      .filter((model) => !providerId || model.providerId === providerId)
      .map((model) => ({ model, score: query ? this.#scoreModel(model, query) : 1 }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.model.providerName.localeCompare(b.model.providerName))
      .slice(0, limit)
      .map((item) => item.model)

    return {
      data: matches,
      meta: {
        query,
        providerId,
        total: matches.length,
        stale: catalog.stale,
        fetchedAt: catalog.fetchedAt,
        expiresAt: catalog.expiresAt,
      },
    }
  }

  async match(input: CatalogMatchInput): Promise<AiModelCatalogMatchResponse> {
    const catalog = await this.ensureCatalog()
    const providers = rootProviders(catalog.snapshot.payload)
    const baseUrl = normalizeUrl(input.baseUrl ?? '')
    const modelName = normalizeSearchText(input.modelName ?? '')
    const scoredCandidates = this.#allModels(providers, catalog.sourceHash, catalog.expiresAt)
      .map((model) => ({ model, score: this.#scoreMatch(model, baseUrl, modelName) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Number(input.limit ?? 10) || 10, 25))
    const candidates = scoredCandidates.map((item) => item.model)

    // 自动套用必须同时精确命中供应商端点与模型 ID/名称。仅模型名或仅端点命中时
    // 仍返回候选给用户确认，避免第三方代理沿用基础模型名称却提供不同 token 限制。
    const model = (scoredCandidates[0]?.score ?? 0) >= 120 ? scoredCandidates[0]!.model : null
    const provider = model
      ? this.normalizeProvider(model.providerId, providers[model.providerId])
      : null
    return { provider, model, candidates, stale: catalog.stale }
  }

  async provider(providerId: string): Promise<{
    provider: AiModelCatalogProviderDto
    models: AiModelCatalogModelDto[]
    stale: boolean
  }> {
    const catalog = await this.ensureCatalog()
    const providers = rootProviders(catalog.snapshot.payload)
    const rawProvider = providers[providerId]
    if (!rawProvider) throw new ResourceNotFoundException('模型供应商不存在')
    return {
      provider: this.normalizeProvider(providerId, rawProvider),
      models: this.#modelsForProvider(
        providerId,
        rawProvider,
        catalog.sourceHash,
        catalog.expiresAt,
      ),
      stale: catalog.stale,
    }
  }

  async refresh(force = false): Promise<AiModelCatalogRefreshResponse> {
    const catalog = await this.ensureCatalog({ force })
    const providers = rootProviders(catalog.snapshot.payload)
    return {
      ok: true,
      stale: catalog.stale,
      providerCount: Object.keys(providers).length,
      modelCount: this.#allModels(providers, catalog.sourceHash, catalog.expiresAt).length,
      fetchedAt: catalog.fetchedAt ?? DateTime.fromJSDate(this.#now()).toISO()!,
      expiresAt:
        catalog.expiresAt ?? DateTime.fromMillis(this.#now().getTime() + this.#ttlMs).toISO()!,
      sourceHash: catalog.sourceHash,
    }
  }

  async createPricingSnapshot(
    providerId: string,
    modelId: string,
  ): Promise<AiModelPricingSnapshot> {
    const catalog = await this.ensureCatalog()
    const providers = rootProviders(catalog.snapshot.payload)
    const rawProvider = providers[providerId]
    if (!rawProvider) throw new ResourceNotFoundException('模型供应商不存在')
    const rawModels = isRecord(rawProvider.models) ? rawProvider.models : {}
    const rawModel = rawModels[modelId]
    if (!isRecord(rawModel)) throw new ResourceNotFoundException('模型目录记录不存在')

    const normalized = this.normalizeModel(providerId, rawProvider, modelId, rawModel, {
      sourceHash: catalog.sourceHash,
      expiresAt: catalog.expiresAt,
    })
    const snapshotKey = `${catalog.sourceHash}:${providerId}:${modelId}`
    const existing = await AiModelPricingSnapshot.query().where('snapshot_key', snapshotKey).first()
    if (existing) return existing

    return AiModelPricingSnapshot.create({
      snapshotKey,
      source: SOURCE,
      sourceHash: catalog.sourceHash,
      providerId,
      providerName: normalized.providerName,
      modelId,
      modelName: normalized.name,
      currency: 'USD',
      pricingUnit: '1M_tokens',
      cost: normalized.cost,
      limits: normalized.limit,
      modalities: normalized.modalities,
      rawProvider: rawProvider as RawRecord,
      rawModel: normalized.rawModel,
      fetchedAt: DateTime.fromISO(catalog.fetchedAt ?? DateTime.fromJSDate(this.#now()).toISO()!),
      expiresAt: DateTime.fromISO(
        catalog.expiresAt ?? DateTime.fromMillis(this.#now().getTime() + this.#ttlMs).toISO()!,
      ),
      stale: catalog.stale,
    })
  }

  async findModel(providerId: string, modelId: string): Promise<AiModelCatalogModelDto> {
    const catalog = await this.ensureCatalog()
    const providers = rootProviders(catalog.snapshot.payload)
    const rawProvider = providers[providerId]
    if (!rawProvider) throw new ResourceNotFoundException('模型供应商不存在')
    const rawModels = isRecord(rawProvider.models) ? rawProvider.models : {}
    const rawModel = rawModels[modelId]
    if (!isRecord(rawModel)) throw new ResourceNotFoundException('模型目录记录不存在')
    return this.normalizeModel(providerId, rawProvider, modelId, rawModel, {
      sourceHash: catalog.sourceHash,
      expiresAt: catalog.expiresAt,
    })
  }

  async recordUsageSnapshot(input: UsageSnapshotInput): Promise<AiModelUsageSnapshot> {
    let cost: AiModelCatalogCost | null = null
    let currency = 'USD'
    const pricingId = input.pricingSnapshotId ? Number(input.pricingSnapshotId) : null
    if (pricingId && Number.isFinite(pricingId)) {
      const snapshot = await AiModelPricingSnapshot.find(pricingId)
      cost = snapshot?.cost ?? null
      currency = snapshot?.currency ?? 'USD'
    }
    const estimate = estimateAiModelCatalogCost({
      usage: input.usage ?? {},
      cost,
      currency,
    })

    return AiModelUsageSnapshot.create({
      organizationId: input.organizationId,
      connectionId: input.connectionId ?? null,
      connectionModelId: input.connectionModelId ?? null,
      pricingSnapshotId: pricingId && Number.isFinite(pricingId) ? pricingId : null,
      provider: input.provider,
      model: input.model,
      catalogProviderId: input.catalogProviderId ?? null,
      catalogModelId: input.catalogModelId ?? null,
      usage: input.usage ?? null,
      contextLimits: input.contextLimits ?? null,
      estimatedCost: estimate.estimatedCost,
      currency: estimate.currency,
      latencyMs: input.latencyMs ?? null,
      errorCategory: input.errorCategory ?? null,
      occurredAt: DateTime.fromJSDate(this.#now()),
    })
  }

  async ensureCatalog(options: { force?: boolean } = {}): Promise<{
    snapshot: AiModelCatalogSnapshot
    sourceHash: string
    stale: boolean
    fetchedAt: string | null
    expiresAt: string | null
  }> {
    const now = DateTime.fromJSDate(this.#now())
    const latest = await AiModelCatalogSnapshot.query()
      .where('source', SOURCE)
      .orderBy('fetched_at', 'desc')
      .orderBy('id', 'desc')
      .first()

    if (!options.force && latest && latest.expiresAt > now && !latest.stale) {
      return this.#catalogResult(latest, false)
    }

    try {
      const payload = await this.#fetchWithTimeout()
      const sourceHash = hashPayload(payload)
      const providers = rootProviders(payload)
      const fetchedAt = now
      const expiresAt = DateTime.fromMillis(now.toMillis() + this.#ttlMs)
      let snapshot = await AiModelCatalogSnapshot.query().where('source_hash', sourceHash).first()
      if (snapshot) {
        snapshot.fetchedAt = fetchedAt
        snapshot.expiresAt = expiresAt
        snapshot.stale = false
        await snapshot.save()
      } else {
        snapshot = await AiModelCatalogSnapshot.create({
          source: SOURCE,
          sourceUrl: this.#catalogUrl,
          sourceHash,
          payload,
          providerCount: Object.keys(providers).length,
          modelCount: this.#allModels(providers, sourceHash, expiresAt.toISO()!).length,
          fetchedAt,
          expiresAt,
          stale: false,
        })
      }
      return this.#catalogResult(snapshot, false)
    } catch (err) {
      if (latest) {
        latest.stale = true
        await latest.save()
        return this.#catalogResult(latest, true)
      }
      throw new ApiException('模型目录暂时不可用', {
        status: 502,
        code: 'AI_SERVICE_ERROR',
        details: { source: SOURCE, message: (err as Error).message },
      })
    }
  }

  normalizeProvider(providerId: string, rawProvider: RawRecord): AiModelCatalogProviderDto {
    const name = stringOrNull(rawProvider.name) ?? providerId
    const api = stringOrNull(rawProvider.api)
    const npmPackage = stringOrNull(rawProvider.npm)
    const protocol = protocolFromNpm(npmPackage)
    const supportLevel = supportLevelFor({ protocol, api })
    const models = isRecord(rawProvider.models) ? rawProvider.models : {}
    return {
      id: providerId,
      name,
      api,
      docsUrl: stringOrNull(rawProvider.doc),
      npmPackage,
      envKeys: stringArray(rawProvider.env),
      logoUrl: `${MODELS_DEV_LOGO_BASE_URL}/${providerId}.svg`,
      searchAliases: providerAliases(providerId, name),
      supportedProtocol: protocol,
      supportLevel,
      modelsCount: Object.keys(models).length,
    }
  }

  normalizeModel(
    providerId: string,
    rawProvider: RawRecord,
    modelId: string,
    rawModel: RawRecord,
    context: { sourceHash: string; expiresAt: string | null },
  ): AiModelCatalogModelDto {
    const providerName = stringOrNull(rawProvider.name) ?? providerId
    const override = isRecord(rawModel.provider) ? rawModel.provider : {}
    const api = stringOrNull(override.api) ?? stringOrNull(rawProvider.api)
    const npmPackage = stringOrNull(override.npm) ?? stringOrNull(rawProvider.npm)
    const protocol = protocolFromNpm(npmPackage)
    const supportLevel = supportLevelFor({ protocol, api })
    const modalities = modalitiesOf(rawModel.modalities)
    const limit = limitOf(rawModel.limit)
    const cost = costOf(rawModel.cost)
    return {
      id: stringOrNull(rawModel.id) ?? modelId,
      name: stringOrNull(rawModel.name) ?? modelId,
      providerId,
      providerName,
      providerApi: api,
      providerDocsUrl: stringOrNull(rawProvider.doc),
      providerEnvKeys: stringArray(rawProvider.env),
      providerLogoUrl: `${MODELS_DEV_LOGO_BASE_URL}/${providerId}.svg`,
      npmPackage,
      protocol,
      supportLevel,
      baseUrl: baseUrlFor(api, supportLevel),
      baseUrlNeedsManualEdit: apiLooksTemplated(api),
      family: stringOrNull(rawModel.family),
      description: stringOrNull(rawModel.description),
      modalities,
      capabilities: inferCapabilities(rawModel),
      limit,
      cost,
      knowledgeCutoff: stringOrNull(rawModel.knowledge),
      releaseDate: stringOrNull(rawModel.release_date),
      lastUpdated: stringOrNull(rawModel.last_updated),
      status: stringOrNull(rawModel.status),
      attachment: boolOrNull(rawModel.attachment),
      reasoning: boolOrNull(rawModel.reasoning),
      reasoningOptions: rawModel.reasoning_options ?? null,
      toolCall: boolOrNull(rawModel.tool_call),
      structuredOutput: boolOrNull(rawModel.structured_output),
      temperature: boolOrNull(rawModel.temperature),
      openWeights: boolOrNull(rawModel.open_weights),
      weights: rawModel.weights ?? null,
      benchmarks: rawModel.benchmarks ?? null,
      license: rawModel.license ?? null,
      links: rawModel.links ?? null,
      experimentalModes: isRecord(rawModel.experimental)
        ? (rawModel.experimental.modes ?? rawModel.experimental)
        : null,
      providerOverride: rawModel.provider ?? null,
      pricingSnapshotId: null,
      rawModel: {
        ...rawModel,
        _catalog: {
          source: SOURCE,
          sourceHash: context.sourceHash,
          expiresAt: context.expiresAt,
        },
      },
    }
  }

  async #defaultFetch(url: string, signal?: AbortSignal): Promise<RawRecord> {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`)
    const payload = await response.json()
    if (!isRecord(payload)) throw new Error('models.dev catalog payload is not an object')
    return payload
  }

  async #fetchWithTimeout(): Promise<RawRecord> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs)
    try {
      return await this.#fetchCatalog(this.#catalogUrl, controller.signal)
    } finally {
      clearTimeout(timeout)
    }
  }

  #catalogResult(snapshot: AiModelCatalogSnapshot, stale: boolean) {
    return {
      snapshot,
      sourceHash: snapshot.sourceHash,
      stale,
      fetchedAt: snapshot.fetchedAt ? snapshot.fetchedAt.toISO() : null,
      expiresAt: snapshot.expiresAt ? snapshot.expiresAt.toISO() : null,
    }
  }

  #allModels(
    providers: Record<string, RawRecord>,
    sourceHash: string,
    expiresAt: string | null,
  ): AiModelCatalogModelDto[] {
    return Object.entries(providers).flatMap(([providerId, rawProvider]) =>
      this.#modelsForProvider(providerId, rawProvider, sourceHash, expiresAt),
    )
  }

  #modelsForProvider(
    providerId: string,
    rawProvider: RawRecord,
    sourceHash: string,
    expiresAt: string | null,
  ): AiModelCatalogModelDto[] {
    const models = isRecord(rawProvider.models) ? rawProvider.models : {}
    return Object.entries(models)
      .filter(([, rawModel]) => isRecord(rawModel))
      .map(([modelId, rawModel]) =>
        this.normalizeModel(providerId, rawProvider, modelId, rawModel as RawRecord, {
          sourceHash,
          expiresAt,
        }),
      )
  }

  #scoreModel(model: AiModelCatalogModelDto, query: string): number {
    const normalizedQuery = normalizeSearchText(query)
    const queryTail = normalizedQuery.split('/').filter(Boolean).pop() ?? normalizedQuery
    const aliases = providerAliases(model.providerId, model.providerName).join(' ')
    const haystack = normalizeSearchText(
      [
        model.providerId,
        model.providerName,
        aliases,
        model.id,
        model.name,
        model.family,
        model.description,
        model.modalities.input.join(' '),
        model.modalities.output.join(' '),
      ]
        .filter(Boolean)
        .join(' '),
    )
    if (
      [normalizedQuery, queryTail].some(
        (candidate) =>
          model.id.toLowerCase() === candidate || model.name.toLowerCase() === candidate,
      )
    )
      return 100
    if (
      model.providerId.toLowerCase() === normalizedQuery ||
      model.providerName.toLowerCase() === normalizedQuery
    ) {
      return 80
    }
    if (haystack.includes(normalizedQuery) || (queryTail && haystack.includes(queryTail))) return 50
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
    if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) return 25
    return 0
  }

  #scoreMatch(model: AiModelCatalogModelDto, baseUrl: string, modelName: string): number {
    let score = 0
    const modelNames = [model.id, model.name].map((value) => value.toLowerCase())
    if (modelName && modelNames.includes(modelName)) score += 60
    else if (modelName && modelNames.some((value) => value.includes(modelName))) score += 25

    const catalogUrl = normalizeUrl(model.baseUrl ?? model.providerApi ?? '')
    if (baseUrl && catalogUrl) {
      if (catalogUrl === baseUrl) score += 60
      else if (catalogUrl.includes(baseUrl) || baseUrl.includes(catalogUrl)) score += 20
    }
    return score
  }
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '').toLowerCase()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return trimmed
  }
}
