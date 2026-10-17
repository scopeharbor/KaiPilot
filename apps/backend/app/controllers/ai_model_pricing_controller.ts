import ModelPricingService from '#services/ai_pricing/model_pricing_service'
import ModelPricingPrefillService from '#services/ai_pricing/model_pricing_prefill_service'
import AiConnectionPolicy from '#policies/ai_connection_policy'
import AuditService, { AuditEvent } from '#services/audit_service'
import AiConnectionModel from '#models/ai_connection_model'
import User from '#models/user'
import { catalogPricingValidator, modelPricingValidator } from '#validators/ai_connection'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

/**
 * 模型定价控制器（2026-10-01）——`/api/v1/ai/connections/:id/models/:modelId/pricing`。
 *
 * 为什么需要它：第三方中转 / 手填模型名在 models.dev 里往往没有可信挂牌价，
 * 成本因此长期无法估算。这里提供三个动作：
 * - `show`：当前定价 + 历史用量回算（改价后立即对照「过去这些用量值多少钱」）；
 * - `update`：人工定价（实际结算单价，任意币种），优先级最高；
 * - `applyCatalog`：绑定 models.dev 条目（`approximate=true` 表示同族近似价，界面需标注）；
 * - `destroy`：解绑，回到「未定价」。
 *
 * 写操作需 `ai:connection:manage`；均为配置类数据，全部落审计。
 */
@inject()
export default class AiModelPricingController {
  constructor(
    private pricing: ModelPricingService,
    private prefillService: ModelPricingPrefillService,
    private policy: AiConnectionPolicy,
    private audit: AuditService,
  ) {}

  private orgIdOf(ctx: HttpContext): number {
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    return Number(orgId)
  }

  private async authorizeManage(user: User, organizationId: number) {
    const allowed = await this.policy.manage(user, organizationId)
    if (!allowed) throw new PermissionDeniedException('无权管理 AI 连接')
  }

  /** 定位连接下的模型，避免跨连接 / 跨组织操作（组织隔离由此保证）。 */
  private async requireModel(
    organizationId: number,
    connectionId: number,
    connectionModelId: number,
  ): Promise<AiConnectionModel> {
    const model = await AiConnectionModel.query()
      .where('id', connectionModelId)
      .where('connection_id', connectionId)
      .where('organization_id', organizationId)
      .first()
    if (!model) throw new ResourceNotFoundException('AI 模型不存在')
    return model
  }

  private parseDate(raw: unknown): Date | undefined {
    const text = String(raw ?? '').trim()
    if (!text) return undefined
    const parsed = DateTime.fromISO(text)
    return parsed.isValid ? parsed.toJSDate() : undefined
  }

  async show(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const model = await this.requireModel(
      organizationId,
      Number(ctx.params.id),
      Number(ctx.params.modelId),
    )
    const pricing = await this.pricing.view(organizationId, Number(model.id))
    const rawIncludeBackCompute = ctx.request.input('includeBackCompute')
    const includeBackCompute = !(
      rawIncludeBackCompute === false ||
      rawIncludeBackCompute === 'false' ||
      rawIncludeBackCompute === 0 ||
      rawIncludeBackCompute === '0'
    )
    const backCompute = includeBackCompute
      ? await this.pricing.backCompute({
          organizationId,
          connectionModelId: Number(model.id),
          from: this.parseDate(ctx.request.input('from')),
          to: this.parseDate(ctx.request.input('to')),
        })
      : null
    return ctx.response.ok({
      data: {
        model: {
          id: String(model.id),
          connectionId: String(model.connectionId),
          modelName: model.modelName,
          isActive: Boolean(model.isActive),
        },
        pricing,
        backCompute,
      },
    })
  }

  async update(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const input = await ctx.request.validateUsing(modelPricingValidator)
    const model = await this.requireModel(
      organizationId,
      Number(ctx.params.id),
      Number(ctx.params.modelId),
    )
    const before = await this.pricing.view(organizationId, Number(model.id))
    const pricing = await this.pricing.setManualPricing({
      organizationId,
      connectionModelId: Number(model.id),
      input: { currency: input.currency, cost: input.cost, note: input.note ?? null },
    })
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_UPDATED,
      userId: user.id,
      organizationId,
      entityType: 'ai_connection_model',
      entityId: Number(model.id),
      requestId: ctx.request.id() ?? null,
      changes: {
        before: { pricing: before as unknown as Record<string, unknown> },
        after: { pricing: pricing as unknown as Record<string, unknown> },
      },
      metadata: { reason: 'model_pricing_manual', modelName: model.modelName },
    })
    return ctx.response.ok({ data: pricing })
  }

  async applyCatalog(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const input = await ctx.request.validateUsing(catalogPricingValidator)
    const model = await this.requireModel(
      organizationId,
      Number(ctx.params.id),
      Number(ctx.params.modelId),
    )
    const pricing = await this.pricing.bindCatalogPricing({
      organizationId,
      connectionModelId: Number(model.id),
      catalogProviderId: input.catalogProviderId,
      catalogModelId: input.catalogModelId,
      approximate: input.approximate ?? false,
      reason: input.reason ?? null,
      decidedBy: 'manual',
    })
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_UPDATED,
      userId: user.id,
      organizationId,
      entityType: 'ai_connection_model',
      entityId: Number(model.id),
      requestId: ctx.request.id() ?? null,
      changes: {
        after: {
          catalogProviderId: input.catalogProviderId,
          catalogModelId: input.catalogModelId,
          approximate: input.approximate ?? false,
        },
      },
      metadata: { reason: 'model_pricing_catalog', modelName: model.modelName },
    })
    return ctx.response.ok({ data: pricing })
  }

  /** 列出目录候选（不落库），供人工在界面里挑一条。 */
  async candidates(ctx: HttpContext) {
    const organizationId = this.orgIdOf(ctx)
    const model = await this.requireModel(
      organizationId,
      Number(ctx.params.id),
      Number(ctx.params.modelId),
    )
    const candidates = await this.prefillService.candidatesForModel({
      organizationId,
      connectionModelId: Number(model.id),
    })
    return ctx.response.ok({ data: { candidates } })
  }

  /**
   * 自动预填定价：端点+模型名精确命中则直接套用；否则交给模型挑一条并落库（记理由与近似标记）。
   * 已有手工定价时不覆盖；`useAi=false` 可只看确定性结果（测试与排错用）。
   */
  async prefill(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const model = await this.requireModel(
      organizationId,
      Number(ctx.params.id),
      Number(ctx.params.modelId),
    )
    const raw = ctx.request.input('useAi')
    const useAi = !(raw === false || raw === 'false' || raw === 0 || raw === '0')
    const deterministic = await this.prefillService.prefill({
      organizationId,
      connectionModelId: Number(model.id),
      useAi: false,
      allowFallback: false,
    })
    const requestId = ctx.request.id() ?? null
    if (!useAi) {
      const fallback = deterministic.applied
        ? deterministic
        : await this.prefillService.prefill({
            organizationId,
            connectionModelId: Number(model.id),
            useAi: false,
            allowFallback: true,
          })
      await this.auditPrefill(requestId, user.id, organizationId, model, fallback)
      return ctx.response.ok({ data: fallback })
    }
    if (deterministic.applied || deterministic.candidates.length === 0) {
      await this.auditPrefill(requestId, user.id, organizationId, model, deterministic)
      return ctx.response.ok({ data: deterministic })
    }

    void this.prefillService
      .prefillDeduped({
        organizationId,
        connectionModelId: Number(model.id),
        useAi: true,
      })
      .then((outcome) => this.auditPrefill(requestId, user.id, organizationId, model, outcome))
      .catch((error) =>
        logger.warn(
          { err: error, organizationId, connectionModelId: Number(model.id) },
          '手动触发的模型定价预填失败',
        ),
      )
    await this.auditPrefill(requestId, user.id, organizationId, model, {
      ...deterministic,
      strategy: 'queued',
      reason: '已在后台判断目录候选，无需等待模型调用完成',
    })
    return ctx.response.accepted({
      data: {
        ...deterministic,
        strategy: 'queued',
        reason: '已在后台判断目录候选，无需等待模型调用完成',
      },
    })
  }

  private async auditPrefill(
    requestId: string | null,
    userId: number,
    organizationId: number,
    model: AiConnectionModel,
    outcome: {
      strategy: string
      applied: boolean
      approximate: boolean
      reason: string
    },
  ) {
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_UPDATED,
      userId,
      organizationId,
      entityType: 'ai_connection_model',
      entityId: Number(model.id),
      requestId,
      metadata: {
        reason: 'model_pricing_prefill',
        modelName: model.modelName,
        strategy: outcome.strategy,
        applied: outcome.applied,
        approximate: outcome.approximate,
        rationale: outcome.reason,
      },
    })
  }

  async destroy(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const organizationId = this.orgIdOf(ctx)
    await this.authorizeManage(user, organizationId)
    const model = await this.requireModel(
      organizationId,
      Number(ctx.params.id),
      Number(ctx.params.modelId),
    )
    await this.pricing.unbindPricing(organizationId, Number(model.id))
    await this.audit.log({
      event: AuditEvent.AI_CONNECTION_UPDATED,
      userId: user.id,
      organizationId,
      entityType: 'ai_connection_model',
      entityId: Number(model.id),
      requestId: ctx.request.id() ?? null,
      metadata: { reason: 'model_pricing_unbound', modelName: model.modelName },
    })
    return ctx.response.noContent()
  }
}
