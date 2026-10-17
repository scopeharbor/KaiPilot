import PwaWebPushPolicy from '#policies/pwa_web_push_policy'
import PwaPushSubscriptionService from '#services/pwa_push_subscription_service'
import { pushSubscribeValidator, pushUnsubscribeValidator } from '#validators/pwa_web_push'
import pwaWebPushConfig from '#config/pwa_web_push'
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import AuditService from '#services/audit_service'
import { AuditEvent } from '#services/audit_service'

/**
 * PWA Web Push 通知 API 控制器（v2-5-pwa-web-push-notifications）。
 *
 * 端点：
 * - GET    /api/v1/push/capability      功能能力状态（公开，无需认证）
 * - GET    /api/v1/push/subscription     当前用户订阅状态
 * - POST   /api/v1/push/subscribe       订阅推送
 * - POST   /api/v1/push/unsubscribe     取消订阅
 *
 * 所有变更操作受 PWA_WEB_PUSH_ENABLED 控制。
 */
@inject()
export default class PwaWebPushController {
  constructor(
    private pushService: PwaPushSubscriptionService,
    private policy: PwaWebPushPolicy,
    private audit: AuditService,
  ) {}

  private currentUser(ctx: HttpContext): User {
    return ctx.auth.getUserOrFail() as User
  }

  /**
   * GET /api/v1/push/capability
   * 返回推送能力状态（公开，无需认证）。
   */
  async capability(ctx: HttpContext) {
    const enabled = pwaWebPushConfig.enabled

    return ctx.response.ok({
      enabled,
      capability: enabled ? 'supported' : 'feature_disabled',
      vapidPublicKey: enabled ? (pwaWebPushConfig.vapidPublicKey ?? null) : null,
    })
  }

  /**
   * GET /api/v1/push/subscription
   * 返回当前用户的订阅状态。
   */
  async subscriptionStatus(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeManage(user, organizationId)

    const state = await this.pushService.getSubscriptionState(organizationId, user.id)
    return ctx.response.ok(state)
  }

  /**
   * POST /api/v1/push/subscribe
   * 订阅推送。
   */
  async subscribe(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeManage(user, organizationId)

    if (!this.pushService.isEnabled()) {
      this.audit.log({
        event: AuditEvent.PWA_WEB_PUSH_SUBSCRIBE,
        severity: 'info',
        userId: user.id,
        organizationId,
        entityType: 'push_subscription',
        metadata: { result: 'feature_disabled' },
      })
      return ctx.response.status(503).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Web Push 功能未启用',
        },
      })
    }

    const body = await ctx.request.validateUsing(pushSubscribeValidator)

    const result = await this.pushService.subscribe(organizationId, user.id, body)

    // 低敏审计：只记结果，不记 endpoint/keys
    this.audit.log({
      event: AuditEvent.PWA_WEB_PUSH_SUBSCRIBE,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'push_subscription',
      metadata: { result: result.success ? 'subscribed' : 'failed' },
    })

    return ctx.response.ok(result)
  }

  /**
   * POST /api/v1/push/unsubscribe
   * 取消订阅。
   */
  async unsubscribe(ctx: HttpContext) {
    const user = this.currentUser(ctx)
    const organizationId = ctx.tenant!.organizationId

    await this.policy.authorizeManage(user, organizationId)

    if (!this.pushService.isEnabled()) {
      return ctx.response.status(503).json({
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Web Push 功能未启用',
        },
      })
    }

    const body = await ctx.request.validateUsing(pushUnsubscribeValidator)

    const result = await this.pushService.unsubscribe(organizationId, user.id, body.endpoint)

    // 低敏审计：只记结果
    this.audit.log({
      event: AuditEvent.PWA_WEB_PUSH_UNSUBSCRIBE,
      severity: 'info',
      userId: user.id,
      organizationId,
      entityType: 'push_subscription',
      metadata: { result: result.success ? 'unsubscribed' : 'not_found' },
    })

    return ctx.response.ok(result)
  }
}
