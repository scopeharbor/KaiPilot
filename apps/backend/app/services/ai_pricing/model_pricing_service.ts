/**
 * 模型定价与成本归属（2026-10-01）。
 *
 * 背景：组织配置的连接多为第三方中转 / 手填模型名，`ai_connection_models.pricing_snapshot_id`
 * 恒为空；又因 AIGateway 记账时把成本四字段写死 null，用量页成本长期显示「未定价」。
 *
 * 三条定价来源（优先级 人工 > 目录精确 > AI 预填）：
 * - `manual`：人工在模型连接上填写的实际结算单价（任意币种），最权威，可覆盖其余来源；
 * - `models.dev`：目录端点 + 模型名双向精确命中，确定性自动套用；
 * - `ai-prefill`：端点不在目录里时，由 AI 从候选里挑一条（或确定性回退到官方同族条目），
 *   落库时**记录理由与「近似价」标记**，界面上可识别、可覆盖。
 *
 * 两条不变量：
 * 1. 定价快照不可变（改价 = 新建快照 + 重新绑定），保证账本里的 `pricing_snapshot_id` 永远指向当时的价；
 * 2. 历史账本行**不因改价而改写**（账本是审计事实）；「过去这些用量按当前价值多少钱」用
 *    `backCompute()` 现算，供调价时对照。
 */

import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import {
  estimateAiModelCatalogCost,
  type AiModelCatalogCost,
  type AiModelUsageTokenSnapshot,
  type BudgetCostStatus,
} from '@aiproj/types'
import AiConnectionModel from '#models/ai_connection_model'
import AiModelPricingSnapshot from '#models/ai_model_pricing_snapshot'
import UnifiedAiInvocationLedger from '#models/unified_ai_invocation_ledger'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import db from '@adonisjs/lucid/services/db'

/** 人工定价来源标记。 */
export const MANUAL_PRICING_SOURCE = 'manual'
/** AI 预填来源标记。 */
export const AI_PREFILL_PRICING_SOURCE = 'ai-prefill'
/** 人工定价快照有效期：人工价不会因为目录过期而失效。 */
export const MANUAL_PRICING_TTL_YEARS = 10
const RESOLVED_PRICING_CACHE_TTL_MS = 5 * 60 * 1000
const RESOLVED_PRICING_CACHE_MAX_ENTRIES = 5_000

const resolvedPricingCache = new Map<
  string,
  { expiresAt: number; value: ResolvedAttemptPricing | null }
>()

function clearResolvedPricingCache(organizationId: number): void {
  const prefix = `${organizationId}:`
  for (const key of resolvedPricingCache.keys()) {
    if (key.startsWith(prefix)) resolvedPricingCache.delete(key)
  }
}

function cacheResolvedPricing(key: string, value: ResolvedAttemptPricing | null): void {
  if (resolvedPricingCache.size >= RESOLVED_PRICING_CACHE_MAX_ENTRIES) {
    const now = Date.now()
    for (const [candidate, entry] of resolvedPricingCache) {
      if (entry.expiresAt <= now) resolvedPricingCache.delete(candidate)
    }
    while (resolvedPricingCache.size >= RESOLVED_PRICING_CACHE_MAX_ENTRIES) {
      const oldest = resolvedPricingCache.keys().next().value as string | undefined
      if (!oldest) break
      resolvedPricingCache.delete(oldest)
    }
  }
  resolvedPricingCache.set(key, {
    expiresAt: Date.now() + RESOLVED_PRICING_CACHE_TTL_MS,
    value,
  })
}

/** 可定价的单价维度（均为「每 1M token」）。 */
export const PRICING_COST_FIELDS = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'inputAudio',
  'outputAudio',
  'reasoning',
] as const

export type PricingCostField = (typeof PRICING_COST_FIELDS)[number]

export interface PricingInput {
  currency?: string | null
  cost: Partial<Record<PricingCostField, number | null | undefined>>
  note?: string | null
}

/** 定价快照的可读视图（界面 + API 共用）。 */
export interface ModelPricingView {
  hasPricing: boolean
  snapshotId: string | null
  source: string | null
  currency: string
  pricingUnit: string
  cost: AiModelCatalogCost | null
  /** true = 并非该中转的实际挂牌价（目录同族 / 官方价近似），界面需显式标注。 */
  approximate: boolean
  /** 谁定的价：manual（人工）/ ai-prefill（AI 自动）/ exact-catalog（端点+模型名精确命中）。 */
  decidedBy: string | null
  /** 定价来源说明（AI 预填时是选择理由；人工时是备注）。 */
  reason: string | null
  /** 绑定的定价快照落库时间。 */
  boundAt: string | null
}

/** 账本记账时解析出的定价。 */
export interface ResolvedAttemptPricing {
  snapshotId: string
  source: string
  currency: string
  cost: AiModelCatalogCost
  approximate: boolean
  /** 命中方式：id（连接/模型精确）或 model_name（按模型名回落）。 */
  matchedBy: 'connection_model_id' | 'model_name'
}

export interface BackComputeResult {
  calls: number
  pricedCalls: number
  /** 未带定价快照的历史行数（改价不会回填这些行）。 */
  unpricedCalls: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    reasoning: number
    total: number
  }
  /** 历史 token × 当前单价。无定价时为 null。 */
  estimatedCost: number | null
  currency: string
  /** true = 用近似价算出来的。 */
  approximate: boolean
  from: string
  to: string
}

// ---------------------------------------------------------------------------
// 纯函数（无 DB，可单测）
// ---------------------------------------------------------------------------

/** 单价归一化：有限非负数保留，其余一律 null。全空视为非法定价。 */
export function normalizeCost(input: PricingInput['cost']): AiModelCatalogCost {
  const pick = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null
    const num = Number(value)
    return Number.isFinite(num) && num >= 0 ? num : null
  }
  const cost: AiModelCatalogCost = {
    input: pick(input?.input),
    output: pick(input?.output),
    cacheRead: pick(input?.cacheRead),
    cacheWrite: pick(input?.cacheWrite),
    inputAudio: pick(input?.inputAudio),
    outputAudio: pick(input?.outputAudio),
    reasoning: pick(input?.reasoning),
    contextOver200k: null,
    tiers: null,
  }
  const hasAny = PRICING_COST_FIELDS.some((field) => cost[field] !== null)
  if (!hasAny) throw new ValidationException('至少需要填写一个单价（输入、输出、缓存读写等）')
  return cost
}

/** 币种归一化：默认 USD，只接受 3–8 位字母。 */
export function normalizeCurrency(raw: unknown): string {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!text) return 'USD'
  if (!/^[A-Z]{3,8}$/.test(text))
    throw new ValidationException('币种需为 3–8 位字母代码（如 USD、CNY）')
  return text
}

/** 定价载荷指纹：同价复用同一条快照，改价必然产生新快照。 */
export function costPayloadHash(currency: string, cost: AiModelCatalogCost): string {
  const payload = JSON.stringify(PRICING_COST_FIELDS.map((field) => [field, cost[field] ?? null]))
  return createHash('sha256').update(`${currency}:${payload}`).digest('hex').slice(0, 24)
}

/** 把「每 1M token 单价」换成一个能看懂的摘要行，供 AI 提示词与界面复用。 */
export function costSummary(cost: AiModelCatalogCost | null): string {
  if (!cost) return '目录未提供价格'
  const parts: string[] = []
  const push = (label: string, value: number | null) => {
    if (value !== null) parts.push(`${label} ${value}`)
  }
  push('输入', cost.input)
  push('输出', cost.output)
  push('缓存读', cost.cacheRead)
  push('缓存写', cost.cacheWrite)
  return parts.length > 0 ? parts.join(' / ') : '目录未提供价格'
}

/** 目录候选的稳定标识：providerId::modelId。 */
export function candidateKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

/**
 * 确定性候选排序：模型名精确命中 → 端点精确命中 → 供应商 id 出现在用户填的模型名里。
 * 全部是字符串判定，**不维护任何厂商清单**；AI 不可用时的回退选择也走这里，
 * 保证「不调模型也有一个稳定、可复现的结果」。
 */
export function rankCandidates<
  T extends { providerId: string; modelId: string; api?: string | null; baseUrl?: string | null },
>(candidates: T[], input: { modelName: string; baseUrl?: string | null }): T[] {
  const modelName = input.modelName.trim().toLowerCase()
  const baseUrl = (input.baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
  const scored = candidates.map((candidate) => {
    const ids = [candidate.modelId, candidate.modelId.split('/').pop() ?? ''].map((v) =>
      v.toLowerCase(),
    )
    let score = 0
    if (ids.includes(modelName)) score += 100
    else if (ids.some((id) => id && (id.includes(modelName) || modelName.includes(id)))) score += 40
    const api = (candidate.api ?? candidate.baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
    if (baseUrl && api && api === baseUrl) score += 100
    // 用户填的模型名里出现该供应商 id，说明这条连接大概率就是找该供应商的模型
    // （`vendor/model` 形态最常见），优于同名的别家转售条目。
    const provider = candidate.providerId.toLowerCase()
    if (provider && modelName.includes(provider)) score += 60
    return { candidate, score }
  })
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.providerId.localeCompare(b.candidate.providerId) ||
        a.candidate.modelId.localeCompare(b.candidate.modelId),
    )
    .map((item) => item.candidate)
}

/** 用量 → 估算成本（薄封装，便于单测与复用）。 */
export function estimateCostForUsage(
  usage: AiModelUsageTokenSnapshot,
  cost: AiModelCatalogCost | null,
  currency: string,
): number | null {
  return estimateAiModelCatalogCost({ usage, cost, currency }).estimatedCost
}

/** 按账本字段算出成本状态：有价且能算 → estimated；否则 cost_unknown。 */
export function costStatusFor(estimatedCost: number | null): BudgetCostStatus {
  return estimatedCost === null ? 'cost_unknown' : 'estimated'
}

// ---------------------------------------------------------------------------
// DB 服务
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/** 定价决策元数据（存在连接模型的 catalog_metadata.pricing 上，不改表结构）。 */
interface PricingDecisionMetadata {
  source: string
  currency: string
  approximate: boolean
  /** manual / ai-prefill / exact-catalog。 */
  decidedBy: string
  reason: string | null
  decidedAt: string
}

export default class ModelPricingService {
  readonly #catalog: AiModelCatalogService

  constructor(options: { catalog?: AiModelCatalogService } = {}) {
    this.#catalog = options.catalog ?? new AiModelCatalogService()
  }

  /** 取某连接模型的定价视图（含近似标记与理由）。 */
  async view(organizationId: number, connectionModelId: number): Promise<ModelPricingView> {
    const model = await this.#requireModel(organizationId, connectionModelId)
    if (!model.pricingSnapshotId) return emptyPricingView()
    const snapshot = await AiModelPricingSnapshot.find(Number(model.pricingSnapshotId))
    if (!snapshot) return emptyPricingView()
    return this.#toView(model, snapshot)
  }

  /**
   * 人工定价：新建（或复用同价）快照并绑定到模型。
   * 人工价优先级最高，覆盖此前的目录/AI 预填结果。
   */
  async setManualPricing(args: {
    organizationId: number
    connectionModelId: number
    input: PricingInput
  }): Promise<ModelPricingView> {
    const model = await this.#requireModel(args.organizationId, args.connectionModelId)
    const currency = normalizeCurrency(args.input.currency)
    const cost = normalizeCost(args.input.cost)
    const sourceHash = costPayloadHash(currency, cost)
    const snapshotKey = `manual:${model.id}:${sourceHash}`

    let snapshot = await AiModelPricingSnapshot.query().where('snapshot_key', snapshotKey).first()
    if (!snapshot) {
      const now = DateTime.now()
      snapshot = await AiModelPricingSnapshot.create({
        snapshotKey,
        source: MANUAL_PRICING_SOURCE,
        sourceHash,
        providerId: model.catalogProviderId ?? 'manual',
        providerName: this.#catalogProviderNameOf(model) ?? '人工定价',
        modelId: model.catalogModelId ?? model.modelName,
        modelName: model.modelName,
        currency,
        pricingUnit: '1M_tokens',
        cost,
        limits: null,
        modalities: null,
        rawProvider: null,
        rawModel: {
          costBasis: 'manual',
          note: args.input.note ?? null,
          recordedAt: now.toISO(),
        },
        fetchedAt: now,
        expiresAt: now.plus({ years: MANUAL_PRICING_TTL_YEARS }),
        stale: false,
      })
    }

    await this.#bind(model, snapshot, {
      source: MANUAL_PRICING_SOURCE,
      currency,
      approximate: false,
      decidedBy: 'manual',
      reason: args.input.note ?? '人工填写单价',
      decidedAt: DateTime.now().toISO()!,
    })
    return this.#toView(model, snapshot)
  }

  /**
   * 绑定目录定价：目录条目作为价源。
   * `approximate=true` 表示这是「同族/官方价近似」，界面必须标注，不能当成实际账单。
   */
  async bindCatalogPricing(args: {
    organizationId: number
    connectionModelId: number
    catalogProviderId: string
    catalogModelId: string
    approximate?: boolean
    reason?: string | null
    decidedBy?: string
  }): Promise<ModelPricingView> {
    const model = await this.#requireModel(args.organizationId, args.connectionModelId)
    const snapshot = await this.#catalog.createPricingSnapshot(
      args.catalogProviderId,
      args.catalogModelId,
    )

    await this.#bind(model, snapshot, {
      source: snapshot.source,
      currency: snapshot.currency,
      approximate: args.approximate ?? false,
      decidedBy: args.decidedBy ?? 'manual',
      reason: args.reason ?? null,
      decidedAt: DateTime.now().toISO()!,
    })
    return this.#toView(model, snapshot)
  }

  /** 解绑定价（回到「未定价」）。 */
  async unbindPricing(organizationId: number, connectionModelId: number): Promise<void> {
    const model = await this.#requireModel(organizationId, connectionModelId)
    model.pricingSnapshotId = null
    const metadata = (model.catalogMetadata as Record<string, unknown> | null) ?? {}
    const rest = { ...metadata }
    delete rest.pricing
    model.catalogMetadata = rest
    await model.save()
    clearResolvedPricingCache(organizationId)
  }

  /**
   * 账本记账用：解析一次调用的定价。
   * 顺序：模型 id 精确 → 模型名回落（账本里 connection_id/model_id 常为空）。
   */
  async resolveForAttempt(input: {
    organizationId: number
    connectionId?: number | null
    modelId?: number | null
    requestModel?: string | null
    responseModel?: string | null
  }): Promise<ResolvedAttemptPricing | null> {
    const organizationId = Number(input.organizationId)
    if (!Number.isFinite(organizationId) || organizationId <= 0) return null

    const connectionId = Number(input.connectionId)
    const normalizedConnectionId =
      Number.isFinite(connectionId) && connectionId > 0 ? connectionId : null
    const cacheKey = [
      organizationId,
      normalizedConnectionId ?? '-',
      Number(input.modelId) || '-',
      input.responseModel ?? '-',
      input.requestModel ?? '-',
    ].join(':')
    const cached = resolvedPricingCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    let model: AiConnectionModel | null = null
    let matchedBy: ResolvedAttemptPricing['matchedBy'] = 'connection_model_id'

    const modelId = Number(input.modelId)
    if (Number.isFinite(modelId) && modelId > 0) {
      model = await AiConnectionModel.query()
        .where('id', modelId)
        .where('organization_id', organizationId)
        .if(normalizedConnectionId !== null, (query) =>
          query.where('connection_id', normalizedConnectionId!),
        )
        .first()
    }

    if (!model || !model.pricingSnapshotId) {
      const names = [input.responseModel, input.requestModel]
        .map((name) => (name ? String(name).trim() : ''))
        .filter(Boolean)
      if (names.length > 0) {
        const byName = await AiConnectionModel.query()
          .where('organization_id', organizationId)
          .if(normalizedConnectionId !== null, (query) =>
            query.where('connection_id', normalizedConnectionId!),
          )
          .whereIn('model_name', names)
          .whereNotNull('pricing_snapshot_id')
          .orderBy('id', 'asc')
          .first()
        if (byName) {
          model = byName
          matchedBy = 'model_name'
        }
      }
    }

    if (!model || !model.pricingSnapshotId) {
      cacheResolvedPricing(cacheKey, null)
      return null
    }
    const snapshot = await AiModelPricingSnapshot.find(Number(model.pricingSnapshotId))
    const cost = (snapshot?.cost as AiModelCatalogCost | null) ?? null
    if (
      !snapshot ||
      !cost ||
      snapshot.stale ||
      (snapshot.expiresAt && snapshot.expiresAt.toMillis() <= DateTime.now().toMillis())
    ) {
      cacheResolvedPricing(cacheKey, null)
      return null
    }

    const resolved: ResolvedAttemptPricing = {
      snapshotId: String(snapshot.id),
      source: snapshot.source,
      currency: snapshot.currency,
      cost,
      approximate: this.#decisionOf(model)?.approximate ?? snapshot.source !== 'manual',
      matchedBy,
    }
    cacheResolvedPricing(cacheKey, resolved)
    return resolved
  }

  /**
   * 回算：该模型历史用量按**当前**单价值多少钱。
   * 账本行本身不改写（历史成本不追溯），这里只做投影，供调价时对照。
   */
  async backCompute(args: {
    organizationId: number
    connectionModelId: number
    from?: Date
    to?: Date
  }): Promise<BackComputeResult> {
    const model = await this.#requireModel(args.organizationId, args.connectionModelId)
    const from = args.from ?? new Date(0)
    const to = args.to ?? new Date()

    const aggregate = await UnifiedAiInvocationLedger.query()
      .where('organization_id', args.organizationId)
      .where((builder) => {
        builder
          .where('model_id', model.id)
          .orWhere('request_model', model.modelName)
          .orWhere('response_model', model.modelName)
      })
      .where('occurred_at', '>=', DateTime.fromJSDate(from).toUTC().toSQL()!)
      .where('occurred_at', '<=', DateTime.fromJSDate(to).toUTC().toSQL()!)
      .sum({ input: 'usage_input_tokens' })
      .sum({ output: 'usage_output_tokens' })
      .sum({ cacheRead: 'usage_cache_read_input_tokens' })
      .sum({ cacheWrite: 'usage_cache_creation_input_tokens' })
      .sum({ reasoning: 'usage_reasoning_output_tokens' })
      .count({ calls: '*' })
      .count({ pricedCalls: 'pricing_snapshot_id' })
      .first()

    // Lucid 模型上的聚合别名不会成为模型属性，而是落在 `$extras`（`toJSON()` 里看不到），
    // 直接读 row.calls 会恒为 undefined → 静默算成 0。
    const row = (aggregate ?? {}) as Record<string, unknown>
    const extras = (row.$extras ?? {}) as Record<string, unknown>
    const agg = (key: string): number => toNumber(row[key] ?? extras[key])

    const tokens = {
      input: agg('input'),
      output: agg('output'),
      cacheRead: agg('cacheRead'),
      cacheWrite: agg('cacheWrite'),
      reasoning: agg('reasoning'),
    }
    const calls = agg('calls')
    const pricedCalls = agg('pricedCalls')
    const pricing = await this.view(args.organizationId, args.connectionModelId)

    return {
      calls,
      pricedCalls,
      unpricedCalls: Math.max(0, calls - pricedCalls),
      tokens: {
        ...tokens,
        total:
          tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning,
      },
      estimatedCost: pricing.hasPricing
        ? estimateCostForUsage(
            {
              inputTokens: tokens.input,
              outputTokens: tokens.output,
              cacheReadTokens: tokens.cacheRead,
              cacheWriteTokens: tokens.cacheWrite,
              reasoningTokens: tokens.reasoning,
            },
            pricing.cost,
            pricing.currency,
          )
        : null,
      currency: pricing.currency,
      approximate: pricing.approximate,
      from: from.toISOString(),
      to: to.toISOString(),
    }
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  async #requireModel(
    organizationId: number,
    connectionModelId: number,
  ): Promise<AiConnectionModel> {
    const model = await AiConnectionModel.query()
      .where('id', connectionModelId)
      .where('organization_id', organizationId)
      .first()
    if (!model) throw new ResourceNotFoundException('AI 模型不存在')
    return model
  }

  async #bind(
    model: AiConnectionModel,
    snapshot: AiModelPricingSnapshot,
    decision: PricingDecisionMetadata,
  ): Promise<void> {
    const applied = await db.transaction(async (trx) => {
      const locked = await AiConnectionModel.query({ client: trx })
        .where('id', model.id)
        .where('organization_id', model.organizationId)
        .forUpdate()
        .first()
      if (!locked) throw new ResourceNotFoundException('AI 模型不存在')
      const currentDecision = this.#decisionOf(locked)
      if (decision.decidedBy !== 'manual' && currentDecision?.decidedBy === 'manual') {
        return false
      }
      locked.pricingSnapshotId = Number(snapshot.id)
      const metadata = (locked.catalogMetadata as Record<string, unknown> | null) ?? {}
      locked.catalogMetadata = { ...metadata, pricing: decision }
      await locked.useTransaction(trx).save()
      return true
    })
    if (!applied) throw new ValidationException('该模型已有手工定价，自动预填不覆盖')
    await model.refresh()
    clearResolvedPricingCache(Number(model.organizationId))
  }

  #catalogProviderNameOf(model: AiConnectionModel): string | null {
    const metadata = (model.catalogMetadata as Record<string, unknown> | null) ?? {}
    const name = metadata.providerName
    return typeof name === 'string' && name.trim() ? name : null
  }

  #decisionOf(model: AiConnectionModel): PricingDecisionMetadata | null {
    const metadata = (model.catalogMetadata as Record<string, unknown> | null) ?? {}
    const pricing = metadata.pricing
    if (!pricing || typeof pricing !== 'object') return null
    return pricing as PricingDecisionMetadata
  }

  #toView(model: AiConnectionModel, snapshot: AiModelPricingSnapshot): ModelPricingView {
    const decision = this.#decisionOf(model)
    return {
      hasPricing: true,
      snapshotId: String(snapshot.id),
      source: snapshot.source,
      currency: snapshot.currency,
      pricingUnit: snapshot.pricingUnit,
      cost: (snapshot.cost as AiModelCatalogCost | null) ?? null,
      approximate: decision?.approximate ?? snapshot.source !== MANUAL_PRICING_SOURCE,
      decidedBy: decision?.decidedBy ?? null,
      reason: decision?.reason ?? null,
      boundAt: decision?.decidedAt ?? (snapshot.createdAt ? snapshot.createdAt.toISO() : null),
    }
  }
}

export function emptyPricingView(): ModelPricingView {
  return {
    hasPricing: false,
    snapshotId: null,
    source: null,
    currency: 'USD',
    pricingUnit: '1M_tokens',
    cost: null,
    approximate: false,
    decidedBy: null,
    reason: null,
    boundAt: null,
  }
}

let defaultService: ModelPricingService | null = null

/** 默认单例（账本记账路径用）。 */
export function getDefaultModelPricingService(): ModelPricingService {
  defaultService ??= new ModelPricingService()
  return defaultService
}

/**
 * 记账路径的**失败隔离**封装：定价解析任何异常都不得影响账本写入、
 * 更不得改变业务终态，失败一律降级为「未解析到定价」。
 */
export async function resolveAttemptPricingSafely(input: {
  organizationId: number
  connectionId?: number | null
  modelId?: number | null
  requestModel?: string | null
  responseModel?: string | null
}): Promise<ResolvedAttemptPricing | null> {
  try {
    return await getDefaultModelPricingService().resolveForAttempt(input)
  } catch {
    return null
  }
}
