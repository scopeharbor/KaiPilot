/**
 * ai-gateway-abstraction / T034 —— Adapter 解析入口(自研,DB 驱动 + env 回退)。
 *
 * 主路径:按 connectionId/modelId 从 DB 读连接与模型 → 解密 key → 按协议 buildAdapter → new AIGateway。
 * 回退路径:不可用或未配置 → env 单 Provider OpenAiAdapter；env 也无 key → MockAdapter。
 */
import env from '#start/env'
import { OpenAiAdapter } from './openai_adapter.ts'
import { MockAdapter } from './mock_adapter.ts'
import {
  AIGateway,
  type Adapter,
  type LedgerAttemptRecorder,
  type LedgerRecordContext,
  type RateLimitTokenSettler,
} from './gateway.ts'
import { buildAdapter } from './adapter_factory.ts'
import { throttleModelCall } from './model_rate_limiter.ts'
import type {
  AiToolCallingMode,
  AiConnectionCapability,
  AiModelCapability,
  AiModelContextLimitSnapshot,
} from '@aiproj/types'
import AiConnection from '#models/ai_connection'
import AiConnectionModel from '#models/ai_connection_model'
import Organization from '#models/organization'
import CryptoService from '#services/crypto_service'
import UnifiedAiInvocationRecorder from '#services/unified_ai_invocation_ledger/recorder'
import RateLimitGuard from '#services/rate_limiting/rate_limit_guard'
import { editionHooks } from '#services/edition/edition_registry'
import { candidateOrganizationIds, resolveAiConnectionScope } from './connection_scope.ts'

/**
 * v3-unified-ai-invocation-ledger §4.3 —— 统一写入点（懒加载单例 recorder）。
 * 所有经 resolveAdapter 构造的 gateway 自动携带 recorder + 调用上下文，
 * 调用方零改动即落账；缺失归属上下文以显式 unknown 落账。
 */
let defaultRecorder: UnifiedAiInvocationRecorder | null = null
function getDefaultRecorder(): UnifiedAiInvocationRecorder {
  defaultRecorder ??= new UnifiedAiInvocationRecorder()
  return defaultRecorder
}

/**
 * v3-global-ai-rate-limiting §5.10 —— 限流守卫（懒加载单例）。
 * 所有经 resolveAdapter 构造的 gateway 自动携带限流检查。
 */
let defaultRateLimitGuard: RateLimitGuard | null = null
function getDefaultRateLimitGuard(): RateLimitGuard {
  defaultRateLimitGuard ??= new RateLimitGuard()
  return defaultRateLimitGuard
}

export type AdapterSource = 'user' | 'fallback' | 'mock'

export interface ResolvedAdapter {
  gateway: AIGateway
  provider: string
  model: string
  usingRealAdapter: boolean
  /** 'user'=用户连接; 'fallback'=env 默认; 'mock'=无 key 联调(禁用于判定)。 */
  source: AdapterSource
  /** 连接或模型存在但因跨组织/禁用/无 key/能力不符不可用。 */
  unavailable?: boolean
  /** 用户连接的端点能力(source=user 时带,供策略降级 resolveStrategy)。 */
  capabilities?: AiConnectionCapability | null
  /** 连接配置的工具调用方式（source=user 时带；fallback/mock 视为 prompt_json）。 */
  toolCallingMode?: AiToolCallingMode
  /** 被选中的连接与模型。fallback/mock 时为空。 */
  connectionId?: number
  modelId?: number
  catalogProviderId?: string | null
  catalogModelId?: string | null
  pricingSnapshotId?: string | null
  contextLimits?: AiModelContextLimitSnapshot
  modelCapabilities?: AiModelCapability[]
  throttle?: (estimatedTokens: number) => Promise<number>
}

const LEGACY_MODEL_CAPABILITIES: AiModelCapability[] = [
  'chat',
  'project_draft',
  'structured_output',
  'tool_calling',
]

function positiveNumber(value: unknown): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null
}

function adapterMaxOutputDefault(model: AiConnectionModel): number | undefined {
  const envDefault = positiveNumber(env.get('AI_M0_MAX_OUTPUT_TOKENS'))
  const modelLimit = positiveNumber(model.maxOutputTokens)
  // 调用方不指定时用模型自身的最大输出：生成质量优先，不设人为的小上限
  //（原为 min(4096, 模型上限)，思考模型常在正文开始前就耗尽额度）
  if (modelLimit) return modelLimit
  return envDefault ?? undefined
}

function generationCapabilities(conn: AiConnection): AiConnectionCapability | null {
  if (conn.protocol === 'openai_compatible' && conn.baseUrl) {
    const baseUrl = conn.baseUrl.toLowerCase()
    const isOfficialOpenAi = baseUrl.includes('api.openai.com')
    if (!isOfficialOpenAi) {
      return {
        ...(conn.capabilities ?? {}),
        supportsStrictSchema: false,
        supportsToolCalling: false,
        supportsStreamingTool: false,
      }
    }
  }
  return conn.capabilities
}

function hasRequiredCapability(
  model: AiConnectionModel,
  requiredCapabilities?: AiModelCapability[] | null,
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) return true
  const caps = model.capabilities ?? LEGACY_MODEL_CAPABILITIES
  return requiredCapabilities.some((capability) => caps.includes(capability))
}

async function selectModel(args: {
  conn: AiConnection
  organizationId: number
  modelId?: number | null
  requiredCapabilities?: AiModelCapability[] | null
}): Promise<AiConnectionModel | null> {
  const { conn, organizationId, modelId, requiredCapabilities } = args
  const base = AiConnectionModel.query()
    .where('connection_id', conn.id)
    .where('organization_id', organizationId)

  if (modelId && Number.isFinite(modelId) && modelId > 0) {
    const model = await base.clone().where('id', modelId).first()
    if (!model || !model.isActive || !hasRequiredCapability(model, requiredCapabilities))
      return null
    return model
  }

  const models = await base
    .clone()
    .where('is_active', true)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
  const model = models.find((candidate) => hasRequiredCapability(candidate, requiredCapabilities))
  if (model) return model

  const anyModel = await base.clone().first()
  if (anyModel) return null

  if (!conn.model) return null
  return AiConnectionModel.create({
    connectionId: conn.id,
    organizationId,
    modelName: conn.model,
    capabilities: LEGACY_MODEL_CAPABILITIES,
    catalogProviderId: null,
    catalogModelId: null,
    pricingSnapshotId: null,
    catalogMetadata: null,
    contextWindowTokens: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    tokenLimitSource: null,
    rpmLimit: null,
    tpmLimit: null,
    isActive: true,
  })
}

/**
 * 把 preflight 的限流决策标识并进落账上下文（§8.7）。
 *
 * 不改原对象：resolver 上游的 `ledger` 会被两条分支共用，
 * 就地改会让第二条分支读到第一条的 decisionId。
 */
function withRateLimitDecision(
  ledger: { recorder: LedgerAttemptRecorder | null; recordContext?: LedgerRecordContext | null },
  decisionId: string | null,
): { recorder: LedgerAttemptRecorder | null; recordContext?: LedgerRecordContext | null } {
  if (!decisionId) return ledger
  return {
    recorder: ledger.recorder,
    recordContext: { ...(ledger.recordContext ?? {}), rateLimitDecisionId: decisionId },
  }
}

function buildResolved(
  conn: AiConnection,
  model: AiConnectionModel,
  apiKey: string,
  ledger?: { recorder: LedgerAttemptRecorder | null; recordContext?: LedgerRecordContext | null },
  /**
   * §8.7：TPM 预估与实际偏差的结算出口。
   * 由调用方在 preflight 之后注入既有守卫，gateway 落账后按真实 token 结算，
   * 偏差写回既有 `rate_limit_decisions`——不新建偏差表。
   */
  rateLimitSettler?: RateLimitTokenSettler | null,
): ResolvedAdapter {
  const adapter: Adapter = buildAdapter(conn.protocol, {
    apiKey,
    model: model.modelName,
    baseURL: conn.baseUrl,
    providerName:
      conn.protocol === 'openai_compatible' ? 'openai-compatible' : 'anthropic-compatible',
    maxOutputTokensDefault: adapterMaxOutputDefault(model),
    maxOutputTokensLimit: model.maxOutputTokens ?? undefined,
    requestTimeoutMsDefault: env.get('AI_M0_REQUEST_TIMEOUT_MS') ?? undefined,
  })
  return {
    gateway: new AIGateway(adapter, {
      recorder: ledger?.recorder ?? null,
      recordContext: ledger?.recordContext ?? null,
      rateLimitSettler: rateLimitSettler ?? null,
    }),
    provider: adapter.providerName,
    model: adapter.modelName,
    usingRealAdapter: true,
    source: 'user',
    capabilities: generationCapabilities(conn),
    toolCallingMode: conn.toolCallingMode ?? 'prompt_json',
    connectionId: conn.id,
    modelId: model.id,
    catalogProviderId: model.catalogProviderId ?? null,
    catalogModelId: model.catalogModelId ?? null,
    pricingSnapshotId:
      model.pricingSnapshotId !== null && model.pricingSnapshotId !== undefined
        ? String(model.pricingSnapshotId)
        : null,
    contextLimits: {
      contextWindowTokens: model.contextWindowTokens ?? null,
      maxInputTokens: model.maxInputTokens ?? null,
      maxOutputTokens: model.maxOutputTokens ?? null,
      source: model.tokenLimitSource ?? null,
    },
    modelCapabilities: model.capabilities ?? LEGACY_MODEL_CAPABILITIES,
    throttle: (estimatedTokens) => throttleModelCall(model, estimatedTokens),
  }
}

/** 按 connectionId/modelId 解析 Adapter(自研路径:DB 驱动,运行时实例化)。
 * v3-unified-ai-invocation-ledger §4.3/4.4：统一写入点接线——
 * 所有经本函数构造的 gateway 携带 recorder 与调用上下文（可缺省，缺省落 unknown）。
 * v3-global-ai-rate-limiting §5.10：限流守卫接线——所有经本函数构造的 gateway 自动携带限流检查。
 */
export async function resolveAdapter(args: {
  connectionId?: number | string | null
  modelId?: number | string | null
  organizationId?: number | null
  requiredCapabilities?: AiModelCapability[] | null
  crypto?: CryptoService
  /** §4.4 调用上下文；缺失维度以显式 unknown 落账。 */
  recordContext?: LedgerRecordContext | null
  /** 测试/特化场景可覆写 recorder（缺省用懒加载单例）。 */
  recorder?: LedgerAttemptRecorder | null
  /** 测试/特化场景可覆写 rateLimitGuard（缺省用懒加载单例）。 */
  rateLimitGuard?: RateLimitGuard | null
  /**
   * TPM preflight 的输入侧确定性估算（v3-copilot-live-submission-channel §8.2）。
   *
   * 此前两处 preflight 硬传 null 且无调用方提供，致 TPM 维度**恒不约束**——
   * 只有窗口内历史已超限才会拒绝。调用方按 `estimateTurnTokens` 之类的
   * 确定性纯函数给出上界即可，不引入模型 tokenizer。
   */
  estimatedTokens?: number
}): Promise<ResolvedAdapter> {
  const { connectionId, modelId, organizationId } = args
  const ledger = {
    recorder: args.recorder !== undefined ? args.recorder : getDefaultRecorder(),
    recordContext: {
      organizationId: args.recordContext?.organizationId ?? organizationId ?? null,
      projectId: args.recordContext?.projectId ?? null,
      userId: args.recordContext?.userId ?? null,
      connectionId: args.recordContext?.connectionId ?? null,
      modelId: args.recordContext?.modelId ?? null,
      capability: args.recordContext?.capability ?? null,
      surface: args.recordContext?.surface ?? null,
      conversationId: args.recordContext?.conversationId ?? null,
      traceId: args.recordContext?.traceId ?? null,
      spanId: args.recordContext?.spanId ?? null,
      parentSpanId: args.recordContext?.parentSpanId ?? null,
      workflowName: args.recordContext?.workflowName ?? null,
      idempotencyKey: args.recordContext?.idempotencyKey ?? null,
      attemptNumber: args.recordContext?.attemptNumber ?? 1,
      operationName: args.recordContext?.operationName ?? undefined,
      source: args.recordContext?.source ?? 'user',
      sourceLedgerRef: args.recordContext?.sourceLedgerRef ?? null,
    },
  }
  const rateLimitGuard =
    args.rateLimitGuard !== undefined ? args.rateLimitGuard : getDefaultRateLimitGuard()
  const cid =
    connectionId !== null && connectionId !== undefined ? Number(connectionId) : Number.NaN
  const mid = modelId !== null && modelId !== undefined ? Number(modelId) : Number.NaN
  const orgId =
    organizationId !== null && organizationId !== undefined ? Number(organizationId) : Number.NaN
  // 组织的连接作用域：私有部署的 free 组织按平台规则决定自己的连接是否参与、可否回退
  // 平台统一 AI 配置；开源个人版没有平台实现，只用自己的连接（见 connection_scope.ts）。
  // 限流与落账始终记在请求方组织 orgId 名下，只有连接/模型取自候选组织。
  const platformAi = editionHooks().platformAi
  const allowedOrgIds = Number.isFinite(orgId)
    ? candidateOrganizationIds(orgId, await resolveAiConnectionScope(orgId))
    : []

  if (Number.isFinite(cid) && cid > 0) {
    const conn = await AiConnection.query().where('id', cid).first()
    if (conn) {
      const connOrgId = Number(conn.organizationId)
      const orgMatch = allowedOrgIds.includes(connOrgId)
      const model =
        orgMatch && conn.isActive
          ? await selectModel({
              conn,
              organizationId: connOrgId,
              modelId: Number.isFinite(mid) ? mid : null,
              requiredCapabilities: args.requiredCapabilities ?? null,
            })
          : null
      const connOrg = orgMatch ? await Organization.find(connOrgId) : null
      const routing = connOrg && platformAi ? platformAi.readRouting(connOrg) : null
      const platformSelectionAllowed =
        !routing ||
        connOrgId === orgId ||
        (model && [routing.primaryModelId, ...routing.fallbackModelIds].includes(Number(model.id)))
      const usable =
        orgMatch && conn.isActive && !!conn.apiKeyEncrypted && !!model && platformSelectionAllowed
      if (usable) {
        // v3-global-ai-rate-limiting §5.10：限流守卫接线
        // 执行顺序：限流守卫 → 账本 recorder → 预算守卫
        const rateLimitResult = (await rateLimitGuard?.preflight({
          organizationId: orgId,
          connectionId: cid,
          modelId: model.id,
          actorId: ledger.recordContext.userId,
          estimatedTokens: args.estimatedTokens,
          attemptId: ledger.recordContext.idempotencyKey,
        })) ?? {
          allowed: true,
          decision: 'allow' as const,
          retryAfterSeconds: null,
          decisionId: null,
          triggeringLayer: null,
        }

        if (!rateLimitResult.allowed) {
          // 超限：返回限流错误，不构造 gateway
          const error = new Error(`Rate limit exceeded: ${rateLimitResult.decision}`)
          ;(error as any).rateLimitDecision = rateLimitResult.decision
          ;(error as any).retryAfterSeconds = rateLimitResult.retryAfterSeconds
          ;(error as any).triggeringLayer = rateLimitResult.triggeringLayer
          throw error
        }

        const crypto = args.crypto ?? new CryptoService()
        // §8.7：把 preflight 的 decisionId 带进落账上下文，并注入结算出口。
        return buildResolved(
          conn,
          model,
          crypto.decrypt(conn.apiKeyEncrypted!),
          withRateLimitDecision(ledger, rateLimitResult.decisionId),
          rateLimitGuard ?? null,
        )
      }
      const fb = fallbackToEnv(ledger)
      return { ...fb, unavailable: true }
    }
    return { ...fallbackToEnv(ledger), unavailable: true }
  }

  let hasPlatformConfiguration = false
  for (const candidateOrgId of allowedOrgIds) {
    const conns = await AiConnection.query()
      .where('organization_id', candidateOrgId)
      .where('is_active', true)
      .whereNotNull('api_key_encrypted')
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
    const candidateOrg = await Organization.find(candidateOrgId)
    const routing = candidateOrg && platformAi ? platformAi.readRouting(candidateOrg) : null
    if (routing) hasPlatformConfiguration = true
    const candidates: Array<{ conn: AiConnection; model: AiConnectionModel }> = []
    if (routing) {
      for (const id of [routing.primaryModelId, ...routing.fallbackModelIds]) {
        if (Number.isFinite(mid) && id !== mid) continue
        for (const conn of conns) {
          const model = await selectModel({
            conn,
            organizationId: candidateOrgId,
            modelId: id,
            requiredCapabilities: args.requiredCapabilities,
          })
          if (model) {
            candidates.push({ conn, model })
            break
          }
        }
      }
    } else {
      for (const conn of conns) {
        const model = await selectModel({
          conn,
          organizationId: candidateOrgId,
          modelId: Number.isFinite(mid) ? mid : null,
          requiredCapabilities: args.requiredCapabilities,
        })
        if (model) candidates.push({ conn, model })
      }
    }
    for (const [candidateIndex, { conn, model }] of candidates.entries()) {
      // v3-global-ai-rate-limiting §5.10：限流守卫接线
      // 执行顺序：限流守卫 → 账本 recorder → 预算守卫
      const rateLimitResult = (await rateLimitGuard?.preflight({
        organizationId: orgId,
        connectionId: conn.id,
        modelId: model.id,
        actorId: ledger.recordContext.userId,
        estimatedTokens: args.estimatedTokens,
        attemptId: ledger.recordContext.idempotencyKey,
      })) ?? {
        allowed: true,
        decision: 'allow' as const,
        retryAfterSeconds: null,
        decisionId: null,
        triggeringLayer: null,
      }

      if (!rateLimitResult.allowed) {
        // 超限：返回限流错误，不构造 gateway
        const error = new Error(`Rate limit exceeded: ${rateLimitResult.decision}`)
        ;(error as any).rateLimitDecision = rateLimitResult.decision
        ;(error as any).retryAfterSeconds = rateLimitResult.retryAfterSeconds
        ;(error as any).triggeringLayer = rateLimitResult.triggeringLayer
        throw error
      }

      const crypto = args.crypto ?? new CryptoService()
      // §8.7：同上，组织级遍历路径同样接线。
      const resolved = buildResolved(
        conn,
        model,
        crypto.decrypt(conn.apiKeyEncrypted!),
        withRateLimitDecision(ledger, rateLimitResult.decisionId),
        rateLimitGuard ?? null,
      )
      if (routing && platformAi && !Number.isFinite(mid)) {
        const primaryGateway = resolved.gateway
        const next = candidates
          .slice(candidateIndex + 1)
          .map(({ conn: fallbackConn, model: fallbackModel }) => async () => {
            const fallback = await resolveAdapter({
              ...args,
              connectionId: fallbackConn.id,
              modelId: fallbackModel.id,
            })
            if (!fallback.usingRealAdapter || fallback.unavailable) return null
            const gateway = fallback.gateway
            Object.assign(resolved, { ...fallback, gateway: resolved.gateway })
            return gateway
          })
        resolved.gateway = platformAi.createFallbackGateway(primaryGateway, next)
      }
      return resolved
    }
  }
  if (hasPlatformConfiguration) {
    const adapter: Adapter = {
      providerName: 'platform',
      modelName: 'unavailable',
      isReal: false,
      async ping() {
        return { ok: false, errorMessage: '平台选定模型不可用' }
      },
      async *stream() {
        yield {
          kind: 'error',
          errorKind: 'sse_interrupted',
          errorMessage: '平台选定模型均不可用，请联系平台管理员检查模型配置',
        }
      },
    }
    return {
      gateway: new AIGateway(adapter),
      provider: 'platform',
      model: 'unavailable',
      usingRealAdapter: false,
      source: 'user',
      unavailable: true,
    }
  }
  return fallbackToEnv(ledger)
}

/** env 单 Provider 回退(poc 既有路径)。
 * v3-unified-ai-invocation-ledger §4.3：回退/无 key 构造点同样接线统一账本。
 */
function fallbackToEnv(ledger?: {
  recorder: LedgerAttemptRecorder | null
  recordContext?: LedgerRecordContext | null
}): ResolvedAdapter {
  const apiKey = env.get('OPENAI_API_KEY')
  const model = env.get('AI_M0_MODEL') ?? 'claude-haiku-4-5-20251001'
  if (apiKey && apiKey.length > 0) {
    const adapter = new OpenAiAdapter({
      apiKey,
      model,
      baseURL: env.get('OPENAI_BASE_URL'),
      maxOutputTokensDefault: env.get('AI_M0_MAX_OUTPUT_TOKENS') ?? 4096,
      requestTimeoutMsDefault: env.get('AI_M0_REQUEST_TIMEOUT_MS') ?? 50 * 60_000,
    })
    return {
      gateway: new AIGateway(adapter, {
        recorder: ledger?.recorder ?? null,
        recordContext: ledger?.recordContext ?? null,
      }),
      provider: adapter.providerName,
      model,
      usingRealAdapter: true,
      source: 'fallback',
    }
  }
  return {
    gateway: new AIGateway(new MockAdapter(), {
      recorder: ledger?.recorder ?? null,
      recordContext: ledger?.recordContext ?? null,
    }),
    provider: 'mock',
    model: 'mock-deterministic-v1',
    usingRealAdapter: false,
    source: 'mock',
  }
}

/** 旧入口(同步,无 connectionId,走 env 回退)—— 保留供少数不需要连接选择的场景/测试。
 * v3-unified-ai-invocation-ledger §4.3：同样接线统一写入点（缺省上下文落 unknown）。
 */
export function makeGateway(recordContext?: LedgerRecordContext | null) {
  return fallbackToEnv({
    recorder: getDefaultRecorder(),
    recordContext: recordContext ?? null,
  }).gateway
}
