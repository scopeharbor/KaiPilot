import AiConnection from '#models/ai_connection'
import AiConnectionModel from '#models/ai_connection_model'
import CryptoService from '#services/crypto_service'
import AuditService, { AuditEvent } from '#services/audit_service'
import { buildAdapter, type AdapterBuildOptions } from '#services/ai_m0/adapter_factory'
import AiModelCatalogService from '#services/ai_model_catalog_service'
import ModelPricingPrefillService from '#services/ai_pricing/model_pricing_prefill_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import type {
  AiConnectionCapability,
  AiConnectionDto,
  AiConnectionModelDto,
  AiConnectionModelTestResult,
  AiConnectionProtocol,
  AiM0Strategy,
  AiModelCapability,
  AiConnectionTestResult,
  AiModelTokenLimitSource,
  AiToolCallingMode,
} from '@aiproj/types'
import { AI_TOOL_CALLING_MODE_LABELS, isToolCallingModeAllowed } from '@aiproj/types'
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'

/**
 * AI 连接服务(ai-gateway-abstraction):CRUD + key 加解密 + 组织隔离 + 测连接 + DTO。
 *
 * 红线:API key 经 CryptoService 加密落库,明文仅在 testConnection/生成前临时解密注入 Adapter;
 * DTO 永不回明文(只 hasKey)。组织隔离:所有查询附加 organization_id。
 */
const OPTIMISTIC_CAPS: AiConnectionCapability = {
  supportsStrictSchema: true,
  supportsToolCalling: true,
  supportsStreamingTool: true,
}
export const DEFAULT_MODEL_CAPABILITIES: AiModelCapability[] = [
  'chat',
  'project_draft',
  'structured_output',
  'tool_calling',
]
const TEST_CONNECTION_TIMEOUT_MS = 20_000

export interface ConnectionModelInput {
  id?: number
  modelName: string
  capabilities?: AiModelCapability[]
  catalogProviderId?: string | null
  catalogModelId?: string | null
  pricingSnapshotId?: number | null
  catalogMetadata?: Record<string, unknown> | null
  contextWindowTokens?: number | null
  maxInputTokens?: number | null
  maxOutputTokens?: number | null
  tokenLimitSource?: AiModelTokenLimitSource | null
  rpmLimit?: number | null
  tpmLimit?: number | null
  isActive?: boolean
}

export interface ConnectionCreateInput {
  displayName: string
  protocol: AiConnectionProtocol
  baseUrl?: string | null
  catalogProviderId?: string | null
  catalogProviderName?: string | null
  catalogProviderLogoUrl?: string | null
  catalogProviderDocUrl?: string | null
  catalogProviderEnvKeys?: string[]
  catalogSourcePayload?: Record<string, unknown> | null
  apiKey?: string
  model?: string
  models?: ConnectionModelInput[]
  toolCallingMode?: AiToolCallingMode
  isActive?: boolean
}

export interface ConnectionUpdateInput {
  displayName?: string
  protocol?: AiConnectionProtocol
  baseUrl?: string | null
  catalogProviderId?: string | null
  catalogProviderName?: string | null
  catalogProviderLogoUrl?: string | null
  catalogProviderDocUrl?: string | null
  catalogProviderEnvKeys?: string[]
  catalogSourcePayload?: Record<string, unknown> | null
  apiKey?: string
  model?: string
  models?: ConnectionModelInput[]
  toolCallingMode?: AiToolCallingMode
  isActive?: boolean
}

export interface AuditCtx {
  requestId?: string | null
}

type NumericId = number | bigint

/** buildAdapter 的返回形态（避免为测试钩子引入 Adapter 的运行时依赖）。 */
export type AdapterLike = ReturnType<typeof buildAdapter>

@inject()
export default class AiConnectionService {
  readonly #catalog = new AiModelCatalogService()
  /** 定价自动预填（2026-10-01）：连接保存后异步为「还没定价」的模型补上计价基准。 */
  readonly #prefill = new ModelPricingPrefillService()

  /**
   * 测连接的 Adapter 构造钩子（仅测试注入用；默认走真实 buildAdapter 直连供应商）。
   * 生产代码不得赋值。
   */
  #testAdapterOverride:
    ((protocol: AiConnectionProtocol, opts: AdapterBuildOptions) => AdapterLike) | null = null

  constructor(
    private crypto: CryptoService,
    private audit: AuditService,
  ) {}

  /** 仅测试注入：替换测连接用的 Adapter 构造（不传参恢复真实 buildAdapter）。 */
  setTestAdapterOverride(
    override: ((protocol: AiConnectionProtocol, opts: AdapterBuildOptions) => AdapterLike) | null,
  ): void {
    this.#testAdapterOverride = override
  }

  private scheduleAutoPrefill(input: {
    organizationId: number
    connectionId: number
    actorUserId: number
    requestId?: string | null
  }): void {
    void this.#prefill
      .tryAutoPrefill({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        onOutcome: async ({ connectionModelId, modelName, outcome, error }) => {
          if (error) {
            logger.warn(
              {
                err: error,
                organizationId: input.organizationId,
                connectionId: input.connectionId,
                connectionModelId,
              },
              'AI 模型定价自动预填失败',
            )
          }
          try {
            await this.audit.log({
              event: AuditEvent.AI_CONNECTION_UPDATED,
              userId: input.actorUserId,
              organizationId: input.organizationId,
              entityType: 'ai_connection_model',
              entityId: connectionModelId,
              requestId: input.requestId ?? null,
              metadata: {
                reason: 'model_pricing_auto_prefill',
                connectionId: input.connectionId,
                modelName,
                applied: outcome?.applied ?? false,
                strategy: outcome?.strategy ?? 'error',
                approximate: outcome?.approximate ?? false,
                rationale:
                  outcome?.reason ?? (error instanceof Error ? error.message : String(error)),
              },
            })
          } catch (auditError) {
            logger.warn(
              { err: auditError, organizationId: input.organizationId, connectionModelId },
              'AI 模型定价自动预填审计写入失败',
            )
          }
        },
      })
      .catch((error) => {
        logger.warn(
          { err: error, organizationId: input.organizationId, connectionId: input.connectionId },
          'AI 连接定价自动预填任务异常结束',
        )
      })
  }

  toModelDto(model: AiConnectionModel): AiConnectionModelDto {
    return {
      id: String(model.id),
      connectionId: String(model.connectionId),
      organizationId: String(model.organizationId),
      modelName: model.modelName,
      capabilities: model.capabilities ?? [],
      catalogProviderId: model.catalogProviderId ?? null,
      catalogModelId: model.catalogModelId ?? null,
      pricingSnapshotId:
        model.pricingSnapshotId !== null && model.pricingSnapshotId !== undefined
          ? String(model.pricingSnapshotId)
          : null,
      catalogMetadata: (model.catalogMetadata as AiConnectionModelDto['catalogMetadata']) ?? null,
      contextWindowTokens: model.contextWindowTokens ?? null,
      maxInputTokens: model.maxInputTokens ?? null,
      maxOutputTokens: model.maxOutputTokens ?? null,
      tokenLimitSource: model.tokenLimitSource ?? null,
      rpmLimit: model.rpmLimit,
      tpmLimit: model.tpmLimit,
      isActive: Boolean(model.isActive),
      lastTestedAt: model.lastTestedAt ? model.lastTestedAt.toISO() : null,
      createdAt: model.createdAt.toISO() ?? '',
      updatedAt: model.updatedAt ? model.updatedAt.toISO() : null,
    }
  }

  /** 工具调用方式须与协议匹配（同协议直连：OpenAI 方式只给 OpenAI 兼容端点，Claude 方式只给 Anthropic 兼容端点）。 */
  private resolveToolCallingMode(
    mode: AiToolCallingMode | undefined,
    protocol: AiConnectionProtocol,
    strict = true,
  ): AiToolCallingMode {
    const candidate = mode ?? 'prompt_json'
    if (isToolCallingModeAllowed(candidate, protocol)) return candidate
    if (!strict) return 'prompt_json'
    throw new ValidationException(
      `「${AI_TOOL_CALLING_MODE_LABELS[candidate]}」不适用于${protocol === 'openai_compatible' ? ' OpenAI 兼容' : ' Anthropic 兼容'}协议的连接`,
    )
  }

  toDto(conn: AiConnection): AiConnectionDto {
    const models = ((conn.$preloaded.models as AiConnectionModel[] | undefined) ?? []).map((m) =>
      this.toModelDto(m),
    )
    return {
      id: String(conn.id),
      organizationId: String(conn.organizationId),
      displayName: conn.displayName,
      protocol: conn.protocol,
      baseUrl: conn.baseUrl,
      catalogProviderId: conn.catalogProviderId ?? null,
      catalogProviderName: conn.catalogProviderName ?? null,
      catalogProviderLogoUrl: conn.catalogProviderLogoUrl ?? null,
      catalogProviderDocUrl: conn.catalogProviderDocUrl ?? null,
      catalogProviderEnvKeys: conn.catalogProviderEnvKeys ?? [],
      catalogSyncedAt: conn.catalogSyncedAt ? conn.catalogSyncedAt.toISO() : null,
      model: models[0]?.modelName ?? conn.model,
      models,
      hasKey: !!conn.apiKeyEncrypted,
      keyHint: null,
      capabilities: conn.capabilities,
      toolCallingMode: conn.toolCallingMode ?? 'prompt_json',
      isActive: Boolean(conn.isActive),
      lastTestedAt: conn.lastTestedAt ? conn.lastTestedAt.toISO() : null,
      createdAt: conn.createdAt.toISO() ?? '',
      updatedAt: conn.updatedAt ? conn.updatedAt.toISO() : null,
    }
  }

  async list(organizationId: NumericId, activeOnly = false): Promise<AiConnection[]> {
    const orgId = Number(organizationId)
    const q = AiConnection.query()
      .where('organization_id', orgId)
      .orderBy('created_at', 'asc')
      .preload('models', (models) => models.orderBy('created_at', 'asc').orderBy('id', 'asc'))
    if (activeOnly) q.where('is_active', true)
    return q
  }

  async get(id: number, organizationId: NumericId): Promise<AiConnection> {
    const orgId = Number(organizationId)
    const conn = await AiConnection.query()
      .where('id', id)
      .where('organization_id', orgId)
      .preload('models', (models) => models.orderBy('created_at', 'asc').orderBy('id', 'asc'))
      .first()
    if (!conn) throw new ResourceNotFoundException('AI 连接不存在')
    return conn
  }

  async create(
    input: ConnectionCreateInput,
    actorUserId: NumericId,
    organizationId: NumericId,
    ctx: AuditCtx = {},
  ): Promise<AiConnection> {
    const orgId = Number(organizationId)
    const userId = Number(actorUserId)
    const modelInputs = await this.enrichModelInputs(
      this.normalizeModelInputs(input.models, input.model),
    )
    const catalogFields = this.connectionCatalogFields(input, modelInputs[0])
    const conn = await AiConnection.create({
      organizationId: orgId,
      displayName: input.displayName,
      protocol: input.protocol,
      baseUrl: input.baseUrl ?? null,
      catalogProviderId: catalogFields.catalogProviderId,
      catalogProviderName: catalogFields.catalogProviderName,
      catalogProviderLogoUrl: catalogFields.catalogProviderLogoUrl,
      catalogProviderDocUrl: catalogFields.catalogProviderDocUrl,
      catalogProviderEnvKeys: catalogFields.catalogProviderEnvKeys,
      catalogSourcePayload: catalogFields.catalogSourcePayload,
      catalogSyncedAt: catalogFields.catalogSyncedAt,
      apiKeyEncrypted: input.apiKey ? this.crypto.encrypt(input.apiKey) : null,
      model: modelInputs[0].modelName,
      capabilities: null,
      toolCallingMode: this.resolveToolCallingMode(input.toolCallingMode, input.protocol),
      isActive: input.isActive ?? true,
    })
    await this.replaceModels(conn, modelInputs, orgId)

    // 定价自动预填（2026-10-01）：非阻塞执行，失败绝不影响连接保存；已有手工定价不被覆盖。
    this.scheduleAutoPrefill({
      organizationId: orgId,
      connectionId: Number(conn.id),
      actorUserId: userId,
      requestId: ctx.requestId,
    })
    await conn.load('models', (models) => models.orderBy('created_at', 'asc').orderBy('id', 'asc'))
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_CREATED,
      userId,
      organizationId: orgId,
      entityType: 'ai_connection',
      entityId: Number(conn.id),
      requestId: ctx.requestId ?? null,
    })
    return conn
  }

  async update(
    id: number,
    input: ConnectionUpdateInput,
    actorUserId: NumericId,
    organizationId: NumericId,
    ctx: AuditCtx = {},
  ): Promise<AiConnection> {
    const orgId = Number(organizationId)
    const userId = Number(actorUserId)
    const conn = await this.get(id, orgId)
    if (input.displayName !== undefined) conn.displayName = input.displayName
    if (input.protocol !== undefined) conn.protocol = input.protocol
    if (input.toolCallingMode !== undefined || input.protocol !== undefined) {
      // 协议改了而方式不再适用时回到 prompt_json；显式传入不适用的方式直接拒绝
      conn.toolCallingMode = this.resolveToolCallingMode(
        input.toolCallingMode ?? conn.toolCallingMode,
        conn.protocol,
        input.toolCallingMode !== undefined,
      )
    }
    if (input.baseUrl !== undefined) conn.baseUrl = input.baseUrl ?? null
    if (input.catalogProviderId !== undefined) conn.catalogProviderId = input.catalogProviderId
    if (input.catalogProviderName !== undefined)
      conn.catalogProviderName = input.catalogProviderName
    if (input.catalogProviderLogoUrl !== undefined) {
      conn.catalogProviderLogoUrl = input.catalogProviderLogoUrl
    }
    if (input.catalogProviderDocUrl !== undefined) {
      conn.catalogProviderDocUrl = input.catalogProviderDocUrl
    }
    if (input.catalogProviderEnvKeys !== undefined) {
      conn.catalogProviderEnvKeys = input.catalogProviderEnvKeys
    }
    if (input.catalogSourcePayload !== undefined)
      conn.catalogSourcePayload = input.catalogSourcePayload
    if (input.model !== undefined) conn.model = input.model
    if (input.isActive !== undefined) conn.isActive = input.isActive
    // apiKey 留空(undefined) = 不变;提供则覆盖加密。
    if (input.apiKey !== undefined) conn.apiKeyEncrypted = this.crypto.encrypt(input.apiKey)
    if (input.models !== undefined) {
      const modelInputs = await this.enrichModelInputs(
        this.normalizeModelInputs(input.models, input.model ?? conn.model),
      )
      conn.model = modelInputs[0].modelName
      const catalogFields = this.connectionCatalogFields(input, modelInputs[0])
      if (input.catalogProviderId === undefined)
        conn.catalogProviderId = catalogFields.catalogProviderId
      if (input.catalogProviderName === undefined) {
        conn.catalogProviderName = catalogFields.catalogProviderName
      }
      if (input.catalogProviderLogoUrl === undefined) {
        conn.catalogProviderLogoUrl = catalogFields.catalogProviderLogoUrl
      }
      if (input.catalogProviderDocUrl === undefined) {
        conn.catalogProviderDocUrl = catalogFields.catalogProviderDocUrl
      }
      if (input.catalogProviderEnvKeys === undefined) {
        conn.catalogProviderEnvKeys = catalogFields.catalogProviderEnvKeys
      }
      if (input.catalogSourcePayload === undefined) {
        conn.catalogSourcePayload = catalogFields.catalogSourcePayload
      }
      conn.catalogSyncedAt = catalogFields.catalogSyncedAt
      await this.replaceModels(conn, modelInputs, orgId)

      // 定价自动预填（2026-10-01）：非阻塞执行，失败绝不影响连接保存；已有手工定价不被覆盖。
      this.scheduleAutoPrefill({
        organizationId: orgId,
        connectionId: Number(conn.id),
        actorUserId: userId,
        requestId: ctx.requestId,
      })
    } else if (input.model !== undefined) {
      await this.upsertLegacyModel(conn, input.model, orgId)
    }
    await conn.save()
    await conn.load('models', (models) => models.orderBy('created_at', 'asc').orderBy('id', 'asc'))
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_UPDATED,
      userId,
      organizationId: orgId,
      entityType: 'ai_connection',
      entityId: id,
      requestId: ctx.requestId ?? null,
    })
    return conn
  }

  async delete(
    id: number,
    actorUserId: NumericId,
    organizationId: NumericId,
    ctx: AuditCtx = {},
  ): Promise<void> {
    const orgId = Number(organizationId)
    const userId = Number(actorUserId)
    const conn = await this.get(id, orgId)
    await conn.delete()
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_DELETED,
      userId,
      organizationId: orgId,
      entityType: 'ai_connection',
      entityId: id,
      requestId: ctx.requestId ?? null,
    })
  }

  /**
   * 测连接(自研直连:按协议实例化 Adapter,对连接下每个启用模型跑一次最小 prompt 生成):
   * 验证可达 + 鉴权 + 模型存在;能力乐观默认(true),运行时若 native/tool 报错由 recovery 层降级。
   * 连接级测试覆盖全部 is_active 模型;传 options.modelName 时只测该模型。
   */
  async testConnection(
    id: number,
    organizationId: NumericId,
    actorUserId: NumericId,
    ctx: AuditCtx = {},
    options: { modelName?: string } = {},
  ): Promise<AiConnectionTestResult> {
    const orgId = Number(organizationId)
    const userId = Number(actorUserId)
    const conn = await this.get(id, orgId)
    const targetModels = await this.resolveTestModels(conn, orgId, options.modelName)
    const firstModel = targetModels[0]
    if (!conn.isActive) {
      return {
        ok: false,
        latencyMs: 0,
        model: firstModel.modelName,
        detectedCapabilities: {},
        errorKind: 'VALIDATION_ERROR',
        errorMessage: '请你先启用之后才可以测试',
      }
    }
    if (!conn.apiKeyEncrypted) {
      return {
        ok: false,
        latencyMs: 0,
        model: firstModel.modelName,
        detectedCapabilities: {},
        errorKind: 'AUTH_REQUIRED',
        errorMessage: '未设置 API key',
      }
    }
    const apiKey = this.crypto.decrypt(conn.apiKeyEncrypted)

    const pingModel = async (model: AiConnectionModel): Promise<AiConnectionModelTestResult> => {
      const adapterOptions: AdapterBuildOptions = {
        apiKey,
        model: model.modelName,
        baseURL: conn.baseUrl,
        providerName:
          conn.protocol === 'openai_compatible' ? 'openai-compatible' : 'anthropic-compatible',
        maxOutputTokensDefault: model.maxOutputTokens ?? undefined,
        maxOutputTokensLimit: model.maxOutputTokens ?? undefined,
      }
      const adapter = this.#testAdapterOverride
        ? this.#testAdapterOverride(conn.protocol, adapterOptions)
        : buildAdapter(conn.protocol, adapterOptions)
      const startedAt = performance.now()
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS)
        const ping = await adapter
          .ping({ signal: controller.signal })
          .finally(() => clearTimeout(timeout))
        const latencyMs = Math.round(performance.now() - startedAt)
        if (!ping.ok) {
          return {
            modelId: String(model.id),
            modelName: model.modelName,
            ok: false,
            latencyMs,
            errorKind: ping.errorKind ?? 'AI_SERVICE_ERROR',
            errorMessage: ping.errorMessage ?? '',
          }
        }
        return {
          modelId: String(model.id),
          modelName: model.modelName,
          ok: true,
          latencyMs,
          usage: ping.usage,
        }
      } catch (err) {
        return {
          modelId: String(model.id),
          modelName: model.modelName,
          ok: false,
          latencyMs: Math.round(performance.now() - startedAt),
          errorKind: 'AI_SERVICE_ERROR',
          errorMessage: (err as Error).message,
        }
      }
    }

    const results = await Promise.all(targetModels.map(pingModel))
    const allOk = results.every((result) => result.ok)
    const latencyMs = Math.max(...results.map((result) => result.latencyMs))
    const testedAt = DateTime.now()
    for (const model of targetModels) {
      if (!results.find((result) => result.modelId === String(model.id))?.ok) continue
      model.lastTestedAt = testedAt
      await model.save()
    }
    // 与既有口径一致：仅当全部模型都通过时才认为「连接测试成功」。
    if (allOk) {
      conn.lastTestedAt = testedAt
      conn.capabilities = OPTIMISTIC_CAPS
      await conn.save()
    }
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_TESTED,
      userId,
      organizationId: orgId,
      entityType: 'ai_connection',
      entityId: id,
      requestId: ctx.requestId ?? null,
      metadata: {
        ok: allOk,
        latencyMs,
        total: results.length,
        passed: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
      },
    })
    const firstFailed = results.find((result) => !result.ok)
    return {
      ok: allOk,
      latencyMs,
      model: (firstFailed ?? firstModel).modelName,
      detectedCapabilities: OPTIMISTIC_CAPS,
      errorKind: firstFailed?.errorKind,
      errorMessage: firstFailed?.errorMessage,
      usage: mergePingUsages(results.map((result) => result.usage)),
      contextLimits: {
        contextWindowTokens: firstModel.contextWindowTokens ?? null,
        maxInputTokens: firstModel.maxInputTokens ?? null,
        maxOutputTokens: firstModel.maxOutputTokens ?? null,
        source: firstModel.tokenLimitSource ?? null,
      },
      pricingSnapshotId:
        firstModel.pricingSnapshotId !== null && firstModel.pricingSnapshotId !== undefined
          ? String(firstModel.pricingSnapshotId)
          : null,
      results,
    }
  }

  private normalizeModelInputs(
    models: ConnectionModelInput[] | undefined,
    legacyModel: string | undefined,
  ): ConnectionModelInput[] {
    const raw =
      models && models.length > 0
        ? models
        : [
            {
              modelName: legacyModel ?? '',
              capabilities: DEFAULT_MODEL_CAPABILITIES,
              isActive: true,
            },
          ]
    const normalized = raw
      .map((model) => ({
        modelName: model.modelName.trim(),
        capabilities:
          model.capabilities && model.capabilities.length > 0
            ? ([...new Set(model.capabilities)] as AiModelCapability[])
            : DEFAULT_MODEL_CAPABILITIES,
        catalogProviderId: model.catalogProviderId ?? null,
        catalogModelId: model.catalogModelId ?? null,
        pricingSnapshotId: model.pricingSnapshotId ?? null,
        catalogMetadata: model.catalogMetadata ?? null,
        contextWindowTokens: model.contextWindowTokens ?? null,
        maxInputTokens: model.maxInputTokens ?? null,
        maxOutputTokens: model.maxOutputTokens ?? null,
        tokenLimitSource: model.tokenLimitSource ?? null,
        rpmLimit: model.rpmLimit ?? null,
        tpmLimit: model.tpmLimit ?? null,
        isActive: model.isActive ?? true,
      }))
      .filter((model) => model.modelName.length > 0)
    if (normalized.length === 0) {
      throw new ValidationException('至少需要配置一个模型')
    }
    return normalized
  }

  private async replaceModels(
    conn: AiConnection,
    models: ConnectionModelInput[],
    organizationId: number,
  ): Promise<void> {
    await AiConnectionModel.query()
      .where('connection_id', conn.id)
      .where('organization_id', organizationId)
      .delete()
    await AiConnectionModel.createMany(
      models.map((model) => ({
        connectionId: conn.id,
        organizationId,
        modelName: model.modelName.trim(),
        capabilities:
          model.capabilities && model.capabilities.length > 0
            ? ([...new Set(model.capabilities)] as AiModelCapability[])
            : DEFAULT_MODEL_CAPABILITIES,
        catalogProviderId: model.catalogProviderId ?? null,
        catalogModelId: model.catalogModelId ?? null,
        pricingSnapshotId: model.pricingSnapshotId ?? null,
        catalogMetadata: model.catalogMetadata ?? null,
        contextWindowTokens: model.contextWindowTokens ?? null,
        maxInputTokens: model.maxInputTokens ?? null,
        maxOutputTokens: model.maxOutputTokens ?? null,
        tokenLimitSource: model.tokenLimitSource ?? null,
        rpmLimit: model.rpmLimit ?? null,
        tpmLimit: model.tpmLimit ?? null,
        isActive: model.isActive ?? true,
      })),
    )
  }

  private async upsertLegacyModel(
    conn: AiConnection,
    modelName: string,
    organizationId: number,
  ): Promise<void> {
    const existing = await AiConnectionModel.query()
      .where('connection_id', conn.id)
      .where('organization_id', organizationId)
      .orderBy('created_at', 'asc')
      .first()
    if (existing) {
      existing.modelName = modelName
      existing.catalogProviderId = null
      existing.catalogModelId = null
      existing.pricingSnapshotId = null
      existing.catalogMetadata = null
      existing.contextWindowTokens = null
      existing.maxInputTokens = null
      existing.maxOutputTokens = null
      existing.tokenLimitSource = null
      await existing.save()
      return
    }
    await AiConnectionModel.create({
      connectionId: conn.id,
      organizationId,
      modelName,
      capabilities: DEFAULT_MODEL_CAPABILITIES,
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
   * 测连接目标模型：指定 modelName 时取该模型（必须是本连接的，否则 422）；
   * 否则取全部启用模型，沿用旧兜底链（无启用模型时回退第一行/由 conn.model 现建）。
   */
  private async resolveTestModels(
    conn: AiConnection,
    organizationId: number,
    modelName?: string,
  ): Promise<AiConnectionModel[]> {
    if (modelName) {
      const model = await AiConnectionModel.query()
        .where('connection_id', conn.id)
        .where('organization_id', organizationId)
        .where('model_name', modelName)
        .first()
      if (!model) throw new ValidationException('模型不存在于该连接')
      return [model]
    }
    const activeModels = await AiConnectionModel.query()
      .where('connection_id', conn.id)
      .where('organization_id', organizationId)
      .where('is_active', true)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
    if (activeModels.length > 0) return activeModels
    return [await this.firstActiveModel(conn, organizationId)]
  }

  private async firstActiveModel(
    conn: AiConnection,
    organizationId: number,
  ): Promise<AiConnectionModel> {
    const model = await AiConnectionModel.query()
      .where('connection_id', conn.id)
      .where('organization_id', organizationId)
      .where('is_active', true)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .first()
    if (model) return model
    const anyModel = await AiConnectionModel.query()
      .where('connection_id', conn.id)
      .where('organization_id', organizationId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .first()
    if (anyModel) return anyModel
    if (conn.model) {
      return AiConnectionModel.create({
        connectionId: conn.id,
        organizationId,
        modelName: conn.model,
        capabilities: DEFAULT_MODEL_CAPABILITIES,
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
    throw new ResourceNotFoundException('AI 模型不存在')
  }

  private async enrichModelInputs(models: ConnectionModelInput[]): Promise<ConnectionModelInput[]> {
    const enriched: ConnectionModelInput[] = []
    for (const model of models) {
      if (!model.catalogProviderId || !model.catalogModelId) {
        enriched.push(model)
        continue
      }

      const catalogModel = await this.#catalog.findModel(
        model.catalogProviderId,
        model.catalogModelId,
      )
      const pricingSnapshot = await this.#catalog.createPricingSnapshot(
        model.catalogProviderId,
        model.catalogModelId,
      )
      const hasProvidedLimit =
        (model.contextWindowTokens !== null && model.contextWindowTokens !== undefined) ||
        (model.maxInputTokens !== null && model.maxInputTokens !== undefined) ||
        (model.maxOutputTokens !== null && model.maxOutputTokens !== undefined)
      const useManualLimit =
        model.tokenLimitSource === 'manual' ||
        (hasProvidedLimit && model.tokenLimitSource !== 'catalog')
      const catalogMetadata: NonNullable<AiConnectionModelDto['catalogMetadata']> = {
        providerName: catalogModel.providerName,
        modelName: catalogModel.name,
        logoUrl: catalogModel.providerLogoUrl,
        docsUrl: catalogModel.providerDocsUrl,
        envKeys: catalogModel.providerEnvKeys,
        protocol: catalogModel.protocol,
        supportLevel: catalogModel.supportLevel,
        baseUrl: catalogModel.baseUrl,
        baseUrlNeedsManualEdit: catalogModel.baseUrlNeedsManualEdit,
        cost: catalogModel.cost,
        limit: catalogModel.limit,
        knowledgeCutoff: catalogModel.knowledgeCutoff,
        releaseDate: catalogModel.releaseDate,
        lastUpdated: catalogModel.lastUpdated,
        status: catalogModel.status,
        modalities: catalogModel.modalities,
        sourceHash: pricingSnapshot.sourceHash,
      }

      enriched.push({
        ...model,
        modelName: model.modelName || catalogModel.id,
        pricingSnapshotId: Number(pricingSnapshot.id),
        catalogMetadata,
        contextWindowTokens: useManualLimit
          ? (model.contextWindowTokens ?? null)
          : catalogModel.limit.context,
        maxInputTokens: useManualLimit ? (model.maxInputTokens ?? null) : catalogModel.limit.input,
        maxOutputTokens: useManualLimit
          ? (model.maxOutputTokens ?? null)
          : catalogModel.limit.output,
        tokenLimitSource: useManualLimit ? 'manual' : 'catalog',
      })
    }
    return enriched
  }

  private connectionCatalogFields(
    input: ConnectionCreateInput | ConnectionUpdateInput,
    firstModel: ConnectionModelInput,
  ): {
    catalogProviderId: string | null
    catalogProviderName: string | null
    catalogProviderLogoUrl: string | null
    catalogProviderDocUrl: string | null
    catalogProviderEnvKeys: string[] | null
    catalogSourcePayload: Record<string, unknown> | null
    catalogSyncedAt: DateTime | null
  } {
    const meta = (firstModel.catalogMetadata ?? {}) as NonNullable<
      AiConnectionModelDto['catalogMetadata']
    >
    return {
      catalogProviderId: input.catalogProviderId ?? firstModel.catalogProviderId ?? null,
      catalogProviderName: input.catalogProviderName ?? meta.providerName ?? null,
      catalogProviderLogoUrl: input.catalogProviderLogoUrl ?? meta.logoUrl ?? null,
      catalogProviderDocUrl: input.catalogProviderDocUrl ?? meta.docsUrl ?? null,
      catalogProviderEnvKeys: input.catalogProviderEnvKeys ?? meta.envKeys ?? null,
      catalogSourcePayload: input.catalogSourcePayload ?? null,
      catalogSyncedAt: firstModel.catalogProviderId ? DateTime.now() : null,
    }
  }
}

/** 各模型 ping 的 token 消耗合计（逐维度累加，取不到的维度忽略）。 */
function mergePingUsages(
  usages: (NonNullable<AiConnectionTestResult['usage']> | undefined)[],
): AiConnectionTestResult['usage'] {
  const merged: NonNullable<AiConnectionTestResult['usage']> = {}
  let any = false
  const numericKeys = [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'inputAudioTokens',
    'outputAudioTokens',
    'reasoningTokens',
  ] as const
  for (const usage of usages) {
    if (!usage) continue
    any = true
    for (const key of numericKeys) {
      const value = (usage as Record<string, unknown>)[key]
      if (typeof value === 'number') {
        merged[key] = (merged[key] ?? 0) + value
      }
    }
  }
  return any ? merged : undefined
}

/**
 * 策略降级器(spec「strict 不可用时降级」):据 connection.capabilities 把请求策略降到端点支持的。
 * caps 为 null(未探测)时不降级,让 recovery 层运行时兜底。
 */
export function resolveStrategy(
  requested: AiM0Strategy,
  caps: AiConnectionCapability | null,
): AiM0Strategy {
  if (!caps) return requested
  if (requested === 'native' && caps.supportsStrictSchema === false) return 'prompt'
  if (requested === 'tool' && caps.supportsToolCalling === false) return 'prompt'
  return requested
}
