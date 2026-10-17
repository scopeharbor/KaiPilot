/**
 * v2-5-webhook-templates-and-stats -- 出站 webhook 模板 HTTP 层（3.3 P0）。
 *
 * 全部方法在 `middleware.auth()` 组内，经 OutgoingWebhookTemplatePolicy 校验
 * `outgoing_webhook:manage` + 组织隔离。Controller 不写业务逻辑，只做 HTTP 解析与响应格式化。
 *
 * 模板只读操作（list/get/prefill）不需要 feature-off 门控（design D5），
 * 模板应用（apply）需要 feature-off 门控。
 *
 * 错误统一 `{error:{code,message,details?}}`。
 */
import OutgoingWebhookTemplateCatalogService, {
  OutgoingWebhookTemplateNotFoundError,
  OutgoingWebhookTemplateFeatureDisabledError,
  webhookTemplateWritesEnabled,
} from '#services/webhooks/outgoing_webhook_template_catalog_service'
import OutgoingWebhookSubscriptionService, {
  OutgoingWebhookFeatureDisabledError,
  OutgoingWebhookSubscriptionNotFoundError,
  OutgoingWebhookEventRejectedError,
} from '#services/webhooks/outgoing_webhook_subscription_service'
import OutgoingWebhookTemplatePolicy from '#policies/outgoing_webhook_template_policy'
import { OutgoingWebhookUrlError } from '#services/webhooks/outgoing_webhook_url_validator'
import User from '#models/user'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  FeatureDisabledException,
  PermissionDeniedException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import { applyOutgoingWebhookTemplateValidator } from '#validators/outgoing_webhook_template'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'

@inject()
export default class OutgoingWebhookTemplatesController {
  constructor(
    private catalog: OutgoingWebhookTemplateCatalogService,
    private subscriptions: OutgoingWebhookSubscriptionService,
    private policy: OutgoingWebhookTemplatePolicy,
    private audit: AuditService,
  ) {}

  private async actor(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail() as User
    const orgId = ctx.tenant?.organizationId
    if (!orgId) throw new PermissionDeniedException('缺少组织上下文')
    const allowed = await this.policy.manage(user, Number(orgId))
    if (!allowed) {
      throw new PermissionDeniedException('无权管理出站 webhook 模板')
    }
    return { userId: Number(user.id), organizationId: Number(orgId) }
  }

  /**
   * GET /api/v1/outgoing-webhook-templates
   * 列出可用模板（只读，不需要 feature-off 门控）。
   */
  async index(ctx: HttpContext) {
    await this.actor(ctx)
    return ctx.response.ok({ data: this.catalog.list() })
  }

  /**
   * GET /api/v1/outgoing-webhook-templates/:id
   * 获取单个模板详情（只读）。
   */
  async show(ctx: HttpContext) {
    await this.actor(ctx)
    const id = ctx.params.id as string
    if (!id || typeof id !== 'string') {
      throw new ValidationException('模板 ID 不能为空')
    }
    try {
      return ctx.response.ok({ data: this.catalog.get(id) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  /**
   * GET /api/v1/outgoing-webhook-templates/:id/prefill
   * 获取模板预填信息（只读）。
   */
  async prefill(ctx: HttpContext) {
    await this.actor(ctx)
    const id = ctx.params.id as string
    if (!id || typeof id !== 'string') {
      throw new ValidationException('模板 ID 不能为空')
    }
    try {
      return ctx.response.ok({ data: this.catalog.prefill(id) })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  /**
   * POST /api/v1/outgoing-webhook-templates/apply
   * 从模板创建订阅（需要 feature-off 门控，design D5）。
   * 写入低敏审计元数据（6.3 P0）：actor、organization、subscription id、template id/version、event types、target host。
   */
  async apply(ctx: HttpContext) {
    const actor = await this.actor(ctx)
    if (!webhookTemplateWritesEnabled()) {
      throw new FeatureDisabledException('出站 webhook 模板功能当前未启用')
    }
    const input = await ctx.request.validateUsing(applyOutgoingWebhookTemplateValidator)
    try {
      // 先验证模板存在
      const template = this.catalog.get(input.templateId)
      // 确定最终 eventTypes：如果用户提交了，取交集；否则用模板的
      let eventTypes = template.eventTypes
      if (input.eventTypes && input.eventTypes.length > 0) {
        const intersection = template.eventTypes.filter((et) =>
          (input.eventTypes as readonly string[]).includes(et),
        )
        if (intersection.length === 0) {
          throw new ValidationException('提交的事件类型与模板不兼容')
        }
        eventTypes = intersection
      }
      // 复用已有的订阅创建边界（design D2）
      const created = await this.subscriptions.create(
        {
          name: input.name,
          targetUrl: input.targetUrl,
          eventTypes: eventTypes as any,
        },
        { userId: actor.userId, organizationId: actor.organizationId },
      )
      // 低敏审计元数据：不含 secret/token/payload/敏感 header（6.3 P0）
      const targetHost = new URL(input.targetUrl).hostname
      await this.audit.log({
        event: AuditEvent.OUTGOING_WEBHOOK_TEMPLATE_APPLIED,
        severity: 'info',
        userId: actor.userId,
        organizationId: actor.organizationId,
        entityType: 'outgoing_webhook_subscription',
        entityId: Number(created.id),
        metadata: {
          templateId: template.id,
          templateVersion: template.version,
          eventTypes: eventTypes,
          targetHost,
        },
      })
      return ctx.response.created({
        data: {
          subscriptionId: created.id,
          templateId: template.id,
          templateVersion: template.version,
        },
      })
    } catch (error) {
      throw this.mapDomainError(error)
    }
  }

  private mapDomainError(error: unknown): Error {
    if (error instanceof OutgoingWebhookTemplateNotFoundError) {
      return new ValidationException(error.message)
    }
    if (error instanceof OutgoingWebhookTemplateFeatureDisabledError) {
      return new FeatureDisabledException(error.message)
    }
    if (error instanceof OutgoingWebhookFeatureDisabledError) {
      return new FeatureDisabledException(error.message)
    }
    if (error instanceof OutgoingWebhookUrlError) {
      return new ValidationException(error.message)
    }
    if (error instanceof OutgoingWebhookEventRejectedError) {
      return new ValidationException(error.message)
    }
    if (error instanceof OutgoingWebhookSubscriptionNotFoundError) {
      return new ResourceNotFoundException('outgoing webhook subscription')
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}
