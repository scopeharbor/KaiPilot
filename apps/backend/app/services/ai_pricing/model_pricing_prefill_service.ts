/**
 * 定价自动预填（2026-10-01）——「以自动定价为主，人工随时可覆盖」。
 *
 * 背景：第三方中转/私有端点的模型名往往不在目录里，端点这一半分值永远拿不到，人工定价成了唯一出路；
 * 而同名条目动辄十几家、价差 5~10 倍，按名字硬套等于猜。这里的策略分三级，全部**自动落库**
 * （用户明确要求不设人工确认门槛）：
 *
 * 1. `exact-catalog`：端点 + 模型名双向精确命中（供应商自有条目）→ 确定性套用，不算近似；
 * 2. `ai-prefill`：把候选（含端点、模型名、各项单价）交给模型做一次极小的选择，只要求返回
 *    候选序号与一句话理由（限 160 token、温度 0），选中的价按「近似价」落库并记录理由；
 * 3. `first-party-fallback`：模型不可用/返回不可解析时，回退到确定性排序（供应商自有条目优先），
 *    同样按近似价落库——至少让成本有数，且理由写明是回退。
 *
 * 三条不变量：
 * - 人工定价（`decidedBy='manual'`）**永不被自动流程覆盖**；
 * - 任何一步失败都不得影响连接保存等业务动作（`tryAutoPrefill` 全量吞错）；
 * - 「近似价」必须显式标记（`approximate=true`），界面上不允许与真实结算价混同。
 * - 实现里**不含任何厂商/模型清单**：只做字符串与目录数据判定，新增供应商不必改代码。
 */

import type { AiModelCatalogCost, AiModelCatalogModelDto } from '@aiproj/types'
import type { GenerateOptions, GenerateResult, LedgerRecordContext } from '#services/ai_m0/gateway'
import AiConnection from '#models/ai_connection'
import AiConnectionModel from '#models/ai_connection_model'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import ModelPricingService, {
  rankCandidates,
  type ModelPricingView,
} from '#services/ai_pricing/model_pricing_service'
import { ResourceNotFoundException } from '#exceptions/api_exception'
import logger from '@adonisjs/core/services/logger'

/** 送给模型的候选上限：再多也只会让判断变糊，且要控 token。 */
export const PREFILL_MAX_CANDIDATES = 10
/** 目录侧召回上限。 */
export const PREFILL_SEARCH_LIMIT = 40
/** 自动预填总时间预算（毫秒）：超时即退回确定性回退，不拖住连接保存。 */
export const PREFILL_BUDGET_MS = 20_000
/** 模型输出上限：只要「序号 + 一句话理由」。 */
export const PREFILL_MAX_OUTPUT_TOKENS = 160
export const AUTO_PREFILL_COOLDOWN_MS = 24 * 60 * 60 * 1000

const autoPrefillInFlight = new Map<string, Promise<number>>()
const modelPrefillInFlight = new Map<string, Promise<PricingPrefillOutcome>>()

export interface PricingPrefillGateway {
  generate(options: GenerateOptions): Promise<GenerateResult>
}

export interface PricingCandidate {
  providerId: string
  providerName: string
  modelId: string
  api: string | null
  cost: AiModelCatalogCost
  /** 供应商端点与连接 baseUrl 归一化后相同。 */
  endpointMatched: boolean
  /** 模型 id / 名称与连接里填的模型名一致或互为包含。 */
  nameMatched: boolean
  /** 模型 id 是否以该供应商 id 开头（供应商自有条目，而非别家转售）。纯字符串判定。 */
  providerBranded: boolean
}

export type PricingPrefillStrategy =
  'exact-catalog' | 'ai-prefill' | 'first-party-fallback' | 'queued' | 'none'

export interface PricingPrefillOutcome {
  applied: boolean
  strategy: PricingPrefillStrategy
  reason: string
  approximate: boolean
  chosen: PricingCandidate | null
  candidates: PricingCandidate[]
  pricing: ModelPricingView | null
}

// ---------------------------------------------------------------------------
// 纯函数（无 DB / 无网络，可单测）
// ---------------------------------------------------------------------------

/** 端点归一化：去协议差异、去尾斜杠、统一小写。 */
export function normalizeEndpoint(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  try {
    const url = new URL(text)
    return `${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return text.replace(/\/+$/, '').toLowerCase()
  }
}

/**
 * 模型名归一化：中转站普遍在前面加自己的前缀（`<relay>/<vendor>/<model>`），
 * 取末段再比，才能与「用户填的 `<vendor>/<model>`」认成同一个模型。
 */
export function normalizeModelName(raw: string | null | undefined): string {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!text) return ''
  const tail = text.split('/').pop() ?? text
  return tail.replace(/:.*$/u, '').trim()
}

/**
 * 供应商自有条目：模型 id 以该供应商 id 开头（`foo/foo-bar`、`foo-bar`），
 * 说明这条目录是供应商自己发布的，而不是别家转售。**纯字符串判定，不维护任何厂商清单**——
 * 新增供应商不必改代码。
 */
export function isProviderBranded(modelId: string, providerId: string): boolean {
  const id = String(modelId ?? '')
    .trim()
    .toLowerCase()
  const provider = String(providerId ?? '')
    .trim()
    .toLowerCase()
  if (!id || !provider) return false
  return id.startsWith(`${provider}/`) || id.startsWith(`${provider}-`)
}

/** 判断目录条目与「连接里填的模型名 / baseUrl」的匹配关系。 */
export function classifyCandidate(
  model: AiModelCatalogModelDto,
  input: { modelName: string; baseUrl: string | null },
): PricingCandidate {
  const target = normalizeModelName(input.modelName)
  const targets = [normalizeModelName(model.id), normalizeModelName(model.name)].filter(Boolean)
  const nameMatched = targets.some(
    (candidate) =>
      candidate === target ||
      (target.length >= 4 &&
        candidate.length >= 4 &&
        (candidate.includes(target) || target.includes(candidate))),
  )
  const endpoint = normalizeEndpoint(input.baseUrl)
  const api = normalizeEndpoint(model.baseUrl ?? model.providerApi ?? '')
  const endpointMatched = Boolean(endpoint && api && endpoint === api)
  // 供应商自有条目：模型 id 以该供应商 id 开头。纯字符串判定，不维护厂商清单。
  const providerBranded = isProviderBranded(model.id, model.providerId)
  return {
    providerId: model.providerId,
    providerName: model.providerName,
    modelId: model.id,
    api: model.baseUrl ?? model.providerApi ?? null,
    cost: model.cost,
    endpointMatched,
    nameMatched,
    providerBranded,
  }
}

/**
 * 确定性回退选择：端点+名字双命中 > 供应商自有同名 > 仅同名 > 仅端点 > 首个。
 * 结果完全可复现——同样的输入永远给同一个候选；不依赖任何厂商知识。
 */
export function pickDeterministicCandidate(
  candidates: PricingCandidate[],
): PricingCandidate | null {
  if (candidates.length === 0) return null
  const pick = (predicate: (candidate: PricingCandidate) => boolean) =>
    candidates.find(predicate) ?? null
  return (
    pick((c) => c.endpointMatched && c.nameMatched) ??
    pick((c) => c.providerBranded && c.nameMatched) ??
    pick((c) => c.nameMatched) ??
    pick((c) => c.endpointMatched) ??
    candidates[0]!
  )
}

/**
 * 解析模型返回的选择。容忍三种形态：纯 JSON 对象、裸序号、带代码围栏的 JSON。
 * 返回 null = 不可用（调用方据此回退），绝不猜测。
 */
export function parsePrefillSelection(
  raw: string,
  candidates: PricingCandidate[],
): { index: number; reason: string } | null {
  if (candidates.length === 0) return null
  const text = String(raw ?? '')
    .replace(/```[a-z]*/giu, '')
    .trim()
  if (!text) return null

  const objectMatch = text.match(/\{[\s\S]*\}/u)
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>
      const reason = typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : ''
      const rawIndex = parsed.index ?? parsed.candidate ?? parsed.choice
      const index = Number(rawIndex)
      if (Number.isInteger(index) && index >= 0 && index < candidates.length) {
        return { index, reason }
      }
      // 也接受直接回 providerId + modelId 的形态
      const providerId = typeof parsed.providerId === 'string' ? parsed.providerId : ''
      const modelId = typeof parsed.modelId === 'string' ? parsed.modelId : ''
      if (providerId) {
        const found = candidates.findIndex(
          (candidate) =>
            candidate.providerId === providerId && (!modelId || candidate.modelId === modelId),
        )
        if (found >= 0) return { index: found, reason }
      }
      return null
    } catch {
      // 落到纯数字分支
    }
  }

  const bare = text.match(/\b(\d{1,2})\b/u)
  if (bare) {
    const index = Number(bare[1])
    if (Number.isInteger(index) && index >= 0 && index < candidates.length) {
      return { index, reason: '' }
    }
  }
  return null
}

/** 给模型的最小提示词：只让它挑一个序号，并给一句理由。 */
export function buildPrefillPrompt(
  candidates: PricingCandidate[],
  modelName: string,
): { systemPrompt: string; userPrompt: string } {
  const lines = candidates.map((candidate, index) => {
    const price = [
      candidate.cost.input === null ? '输入未标价' : `输入 ${candidate.cost.input}`,
      candidate.cost.output === null ? '输出未标价' : `输出 ${candidate.cost.output}`,
      candidate.cost.cacheRead === null ? null : `缓存读 ${candidate.cost.cacheRead}`,
    ]
      .filter(Boolean)
      .join(' / ')
    const marks = [
      candidate.endpointMatched ? '端点命中' : null,
      candidate.nameMatched ? '同名' : null,
      candidate.providerBranded ? '自有条目' : null,
    ]
      .filter(Boolean)
      .join('+')
    return `${index}. ${candidate.providerName}（${candidate.providerId}） 模型 ${candidate.modelId} 端点 ${candidate.api ?? '未标注'} 单价(USD/百万token) ${price}${marks ? ` 〔${marks}〕` : ''}`
  })

  return {
    systemPrompt: `你在为一个 AI 连接选择「计价基准」。用户用的可能是第三方中转或私有端点，目录里未必有它的挂牌价。
只做一件事：从候选里挑出最可能代表该连接真实计费的那一条。判断优先级：
1. 端点与候选供应商的 API 地址一致的最可信；
2. 其次是模型出品方自己发布的同名条目（其 id 以供应商 id 开头，候选里标了「自有条目」）；
3. 再其次是同名条目里价格居中的主流供应商。
不要臆造候选之外的价格；拿不准就选最接近官方价的那条。只输出 JSON：{"index": 序号, "reason": "不超过 30 字的中文理由"}。不要解释、不要多余文字。`,
    userPrompt: `连接的模型名：${modelName}\n候选：\n${lines.join('\n')}`,
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface ModelPricingPrefillOptions {
  catalog?: AiModelCatalogService
  pricing?: ModelPricingService
  /** 解析用于判断的网关；返回 null = 当前组织没有可用真实模型（直接走确定性回退）。 */
  resolveGateway?: (organizationId: number) => Promise<PricingPrefillGateway | null>
}

export default class ModelPricingPrefillService {
  readonly #catalog: AiModelCatalogService
  readonly #pricing: ModelPricingService
  readonly #resolveGateway: (organizationId: number) => Promise<PricingPrefillGateway | null>

  constructor(options: ModelPricingPrefillOptions = {}) {
    this.#catalog = options.catalog ?? new AiModelCatalogService()
    this.#pricing = options.pricing ?? new ModelPricingService()
    this.#resolveGateway = options.resolveGateway ?? defaultResolveGateway
  }

  /** 同一组织/模型只允许一个预填任务在途，避免并发保存或重复点击产生双倍真实调用。 */
  async prefillDeduped(
    args: Parameters<ModelPricingPrefillService['prefill']>[0],
  ): Promise<PricingPrefillOutcome> {
    const key = `${args.organizationId}:${args.connectionModelId}`
    const running = modelPrefillInFlight.get(key)
    if (running) return running
    const job = this.prefill(args).finally(() => modelPrefillInFlight.delete(key))
    modelPrefillInFlight.set(key, job)
    return job
  }

  /** 目录里与该模型名/端点相关的候选（已排序、已截断）。 */
  async candidatesFor(input: {
    modelName: string
    baseUrl: string | null
  }): Promise<PricingCandidate[]> {
    const search = await this.#catalog.search({
      query: normalizeModelName(input.modelName) || input.modelName,
      limit: PREFILL_SEARCH_LIMIT,
    })
    const classified = search.data
      .map((model) => classifyCandidate(model, input))
      .filter((candidate) => candidate.nameMatched || candidate.endpointMatched)
    const ranked = rankCandidates(classified, {
      modelName: input.modelName,
      baseUrl: input.baseUrl,
    })
    return ranked.slice(0, PREFILL_MAX_CANDIDATES)
  }

  /**
   * 为单个模型预填定价。默认会用一次极小模型调用做选择；失败时确定性回退。
   * 已有**人工**定价时不覆盖。
   */
  async prefill(args: {
    organizationId: number
    connectionModelId: number
    gateway?: PricingPrefillGateway | null
    useAi?: boolean
    allowFallback?: boolean
  }): Promise<PricingPrefillOutcome> {
    const model = await AiConnectionModel.query()
      .where('id', args.connectionModelId)
      .where('organization_id', args.organizationId)
      .first()
    if (!model) throw new ResourceNotFoundException('AI 模型不存在')

    const existing = await this.#pricing.view(args.organizationId, args.connectionModelId)
    if (existing.hasPricing && existing.decidedBy === 'manual') {
      return {
        applied: false,
        strategy: 'none',
        reason: '该模型已有手工定价，自动预填不覆盖',
        approximate: existing.approximate,
        chosen: null,
        candidates: [],
        pricing: existing,
      }
    }

    const connection = await AiConnection.find(model.connectionId)
    const candidates = await this.candidatesFor({
      modelName: model.modelName,
      baseUrl: connection?.baseUrl ?? null,
    })

    if (candidates.length === 0) {
      return {
        applied: false,
        strategy: 'none',
        reason: '目录里没有同名模型条目，请手工填写单价',
        approximate: false,
        chosen: null,
        candidates: [],
        pricing: existing,
      }
    }

    const apply = async (
      candidate: PricingCandidate,
      meta: { strategy: PricingPrefillStrategy; approximate: boolean; reason: string },
    ): Promise<PricingPrefillOutcome> => {
      // 最后写入前再次读取，缩小「先查人工价、后绑定目录价」的 TOCTOU 窗口。
      const latest = await this.#pricing.view(args.organizationId, args.connectionModelId)
      if (latest.hasPricing && latest.decidedBy === 'manual') {
        return {
          applied: false,
          strategy: 'none',
          reason: '预填期间检测到人工定价，已保留人工价',
          approximate: false,
          chosen: null,
          candidates,
          pricing: latest,
        }
      }
      const pricing = await this.#pricing.bindCatalogPricing({
        organizationId: args.organizationId,
        connectionModelId: args.connectionModelId,
        catalogProviderId: candidate.providerId,
        catalogModelId: candidate.modelId,
        approximate: meta.approximate,
        reason: meta.reason,
        decidedBy: meta.strategy,
      })
      return {
        applied: true,
        strategy: meta.strategy,
        reason: meta.reason,
        approximate: meta.approximate,
        chosen: candidate,
        candidates,
        pricing,
      }
    }

    // ① 端点 + 模型名双命中：确定性套用
    const exact = candidates.find((candidate) => candidate.endpointMatched && candidate.nameMatched)
    if (exact) {
      return apply(exact, {
        strategy: 'exact-catalog',
        approximate: false,
        reason: `端点与模型名都精确命中 ${exact.providerId}`,
      })
    }

    // ② 交给模型做一次最小选择
    if (args.useAi !== false) {
      const gateway = args.gateway ?? (await this.#resolveGateway(args.organizationId))
      if (gateway) {
        try {
          const prompt = buildPrefillPrompt(candidates, model.modelName)
          const generated = await gateway.generate({
            sentence: '选择模型定价基准',
            promptName: 'ai-pricing.prefill',
            promptSet: prompt,
            strategy: 'prompt',
            temperature: 0,
            maxOutputTokens: PREFILL_MAX_OUTPUT_TOKENS,
            requestTimeoutMs: PREFILL_BUDGET_MS,
          })
          if (generated.usingRealAdapter && generated.triggeredErrors.length === 0) {
            const selection = parsePrefillSelection(generated.rawText, candidates)
            if (selection) {
              const chosen = candidates[selection.index]!
              return apply(chosen, {
                strategy: 'ai-prefill',
                approximate: !chosen.endpointMatched,
                reason: selection.reason
                  ? `模型判断：${selection.reason}`
                  : `模型选择 ${chosen.providerId} 作为计价基准`,
              })
            }
          }
        } catch {
          // 交给下面的确定性回退
        }
      }
    }

    if (args.allowFallback === false) {
      return {
        applied: false,
        strategy: 'none',
        reason: '需要进一步判断目录候选',
        approximate: false,
        chosen: null,
        candidates,
        pricing: existing,
      }
    }

    // ③ 确定性回退（官方/同名条目近似价）
    const fallback = pickDeterministicCandidate(candidates)
    if (fallback && fallback.nameMatched) {
      return apply(fallback, {
        strategy: 'first-party-fallback',
        approximate: true,
        reason: fallback.providerBranded
          ? `未取得模型判断，回退到供应商自有条目 ${fallback.providerId}（近似价）`
          : `未取得模型判断，回退到同名条目 ${fallback.providerId}（近似价）`,
      })
    }

    return {
      applied: false,
      strategy: 'none',
      reason: '无法自动确定价格，请从候选里选一个或手工填写',
      approximate: false,
      chosen: null,
      candidates,
      pricing: existing,
    }
  }

  /**
   * 自动预填（连接保存后调用）：只处理「还没有定价」的启用模型，全量吞错。
   * 返回成功预填的模型数。**不得**因任何失败影响调用方。
   */
  async tryAutoPrefill(args: {
    organizationId: number
    connectionId?: number
    budgetMs?: number
    onOutcome?: (input: {
      connectionModelId: number
      modelName: string
      outcome: PricingPrefillOutcome | null
      error?: unknown
    }) => Promise<void> | void
  }): Promise<number> {
    const key = `${args.organizationId}:${args.connectionId ?? '*'}`
    const running = autoPrefillInFlight.get(key)
    if (running) return running
    const job = this.#runAutoPrefill(args).finally(() => autoPrefillInFlight.delete(key))
    autoPrefillInFlight.set(key, job)
    return job
  }

  async #runAutoPrefill(args: {
    organizationId: number
    connectionId?: number
    budgetMs?: number
    onOutcome?: (input: {
      connectionModelId: number
      modelName: string
      outcome: PricingPrefillOutcome | null
      error?: unknown
    }) => Promise<void> | void
  }): Promise<number> {
    const deadline = Date.now() + (args.budgetMs ?? PREFILL_BUDGET_MS)
    let applied = 0
    try {
      const models = args.connectionId
        ? await AiConnectionModel.query()
            .where('organization_id', args.organizationId)
            .where('connection_id', args.connectionId)
            .where('is_active', true)
        : await AiConnectionModel.query()
            .where('organization_id', args.organizationId)
            .where('is_active', true)

      for (const model of models) {
        if (Date.now() > deadline) break
        if (model.pricingSnapshotId) continue
        const metadata = (model.catalogMetadata as Record<string, unknown> | null) ?? {}
        const lastAttemptAt = Date.parse(String(metadata.autoPricingAttemptAt ?? ''))
        if (
          Number.isFinite(lastAttemptAt) &&
          metadata.autoPricingAttemptModelName === model.modelName &&
          Date.now() - lastAttemptAt < AUTO_PREFILL_COOLDOWN_MS
        ) {
          continue
        }
        let outcome: PricingPrefillOutcome | null = null
        let error: unknown
        try {
          outcome = await this.prefillDeduped({
            organizationId: args.organizationId,
            connectionModelId: Number(model.id),
          })
          if (outcome.applied) applied += 1
        } catch (cause) {
          error = cause
        }
        try {
          await model.refresh()
          model.catalogMetadata = {
            ...((model.catalogMetadata as Record<string, unknown> | null) ?? {}),
            autoPricingAttemptAt: new Date().toISOString(),
            autoPricingAttemptModelName: model.modelName,
          }
          await model.save()
        } catch (markError) {
          error ??= markError
        }
        // 单个模型失败或回调失败均不影响其余；失败也记冷却，避免每次保存重复花钱。
        try {
          await args.onOutcome?.({
            connectionModelId: Number(model.id),
            modelName: model.modelName,
            outcome,
            error,
          })
        } catch {
          // 审计/日志回调失败不能阻断连接保存后的后台任务。
        }
      }
    } catch (error) {
      // 自动预填永远不向业务抛出，但外层失败必须可观测。
      logger.warn(
        { err: error, organizationId: args.organizationId, connectionId: args.connectionId },
        'AI 模型定价自动预填任务失败',
      )
    }
    return applied
  }

  /** 显式列出候选（不落库），供界面让人工挑一条。 */
  async candidatesForModel(args: {
    organizationId: number
    connectionModelId: number
  }): Promise<PricingCandidate[]> {
    const model = await AiConnectionModel.query()
      .where('id', args.connectionModelId)
      .where('organization_id', args.organizationId)
      .first()
    if (!model) throw new ResourceNotFoundException('AI 模型不存在')
    const connection = await AiConnection.find(model.connectionId)
    return this.candidatesFor({
      modelName: model.modelName,
      baseUrl: connection?.baseUrl ?? null,
    })
  }
}

/** 默认网关：用该组织可用的真实适配器；mock/无 key 一律视为不可用。 */
async function defaultResolveGateway(
  organizationId: number,
): Promise<PricingPrefillGateway | null> {
  try {
    const { resolveAdapter } = await import('#services/ai_m0/resolver')
    const context: LedgerRecordContext = {
      organizationId,
      capability: 'chat',
      surface: 'ai-pricing-prefill',
      operationName: 'chat',
      source: 'user',
    }
    const resolved = await resolveAdapter({ organizationId, recordContext: context })
    if (!resolved.usingRealAdapter) return null
    return resolved.gateway
  } catch {
    return null
  }
}
